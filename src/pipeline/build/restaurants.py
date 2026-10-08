"""Restaurants (§4.3, §4.4): DOHMH backbone, multi-location heuristic, enrichment and labels."""

from __future__ import annotations

import datetime as dt
import json
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely import STRtree
from shapely.geometry import Point

from pipeline.analysis.labels import Evidence, Labels, build_labels
from pipeline.analysis.matching import match, name_tokens, normalize_name, strip_accents
from pipeline.build.geography import PROJECTED_CRS, Geography, InvariantError
from pipeline.config import Config, load_yaml
from pipeline.fetch.common import existing_snapshot, load_manifest
from pipeline.paths import REPO_ROOT

FT_PER_M = 3.28084
NYC_BBOX = (-74.27, 40.47, -73.68, 40.93)
PLACEHOLDER_YEAR = 1900


def _snapshot(source: str) -> tuple[str, dict[str, Any]]:
    e = existing_snapshot(load_manifest(), source)
    if not e:
        raise InvariantError(f"missing snapshot {source}; run `uv run pipeline fetch`")
    return str(REPO_ROOT / e["files"][0]["path"]), e


@dataclass
class Restaurants:
    df: pd.DataFrame  # one row per retained CAMIS (index 0..n-1)
    xy: np.ndarray  # projected coordinates (ft)
    labels: list[Labels]
    diagnostics: dict[str, Any] = field(default_factory=dict)


# --- DOHMH backbone -------------------------------------------------------------------------------


def chain_key(name: str | None) -> str:
    """Normalized business name for the multi-location heuristic (store numbers etc. removed)."""
    if not isinstance(name, str):
        return ""
    s = strip_accents(name).lower().replace("&", " and ")
    s = re.sub(r"#\s*\d+", " ", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    drop = {"inc", "llc", "corp", "corporation", "co", "ltd", "the", "nyc", "ny"}
    return " ".join(t for t in s.split() if t not in drop and not t.isdigit())


def load_dohmh(cfg_r: dict[str, Any], geo: Geography, cuisine_map: dict[str, str]) -> tuple[pd.DataFrame, dict[str, Any]]:
    path, entry = _snapshot("dohmh")
    raw = pd.read_csv(path, dtype=str, keep_default_na=False, na_values=[""])
    snap_date = pd.Timestamp(entry["vintage"])
    diag: dict[str, Any] = {"raw_rows": len(raw), "unique_camis": int(raw.CAMIS.nunique()), "snapshot_date": entry["vintage"]}

    raw["_date"] = pd.to_datetime(raw["INSPECTION DATE"], format="%m/%d/%Y", errors="coerce")
    raw["_lat"] = pd.to_numeric(raw["Latitude"], errors="coerce")
    raw["_lon"] = pd.to_numeric(raw["Longitude"], errors="coerce")
    x0, y0, x1, y1 = NYC_BBOX
    raw["_coord_ok"] = raw._lat.between(y0, y1) & raw._lon.between(x0, x1)
    raw["_real"] = raw._date.dt.year > PLACEHOLDER_YEAR
    # deterministic order: newest real inspection first; ties broken by every other column
    raw = raw.sort_values(["CAMIS", "_real", "_date", "INSPECTION TYPE", "ACTION", "VIOLATION CODE"],
                          ascending=[True, False, False, True, True, True], na_position="last", kind="mergesort")

    def first_non_null(col: str) -> pd.Series:
        return raw.dropna(subset=[col]).groupby("CAMIS", sort=True)[col].first()

    g = raw.groupby("CAMIS", sort=True)
    out = pd.DataFrame(index=g.size().index)
    for col in ("DBA", "BORO", "BUILDING", "STREET", "ZIPCODE", "CUISINE DESCRIPTION", "GRADE"):
        out[col] = first_non_null(col)
    out["last_inspection"] = raw[raw._real].groupby("CAMIS")["_date"].max()
    coords = raw[raw._coord_ok].groupby("CAMIS")[["_lat", "_lon"]].first()
    out = out.join(coords)
    out = out.reset_index().rename(columns={"CUISINE DESCRIPTION": "cuisine_dohmh"})

    # every distinct cuisine value, enumerated (§4.3)
    diag["cuisine_values"] = dict(Counter(out.cuisine_dohmh.fillna("(blank)")).most_common())
    unmapped = sorted(v for v in out.cuisine_dohmh.dropna().unique() if v not in cuisine_map)
    if unmapped:
        raise InvariantError(f"DOHMH cuisine values missing from cuisines.yaml: {unmapped}")

    no_coord = out._lat.isna()
    diag["dropped_missing_or_invalid_coordinates"] = int(no_coord.sum())
    out = out[~no_coord].copy()
    if len(out) / diag["unique_camis"] < 0.8:
        raise InvariantError(f"only {len(out)} of {diag['unique_camis']} establishments have usable coordinates")

    cutoff = snap_date - pd.DateOffset(years=int(cfg_r["active"]["max_years_since_inspection"]))
    out["uninspected"] = out.last_inspection.isna()
    inactive = ~out.uninspected & (out.last_inspection < cutoff)
    if not cfg_r["active"]["include_uninspected"]:
        inactive |= out.uninspected
    diag["filtered_inactive"] = int(inactive.sum())
    diag["inactive_rule"] = f"latest inspection before {cutoff.date()} (more than {cfg_r['active']['max_years_since_inspection']} years before the snapshot)"
    out = out[~inactive].copy()

    # tract assignment (water-included tracts so shoreline points are not lost)
    pts = gpd.GeoSeries([Point(xy) for xy in zip(out._lon, out._lat)], crs="EPSG:4326").to_crs(PROJECTED_CRS)
    tracts_p = geo.tracts_water.to_crs(PROJECTED_CRS).geometry.values
    tree = STRtree(tracts_p)
    hit_pt, hit_tr = tree.query(pts.values, predicate="within")
    tract_idx = np.full(len(out), -1)
    tract_idx[hit_pt] = hit_tr
    outside = tract_idx < 0
    diag["dropped_outside_nyc_tracts"] = int(outside.sum())
    out["tract"] = tract_idx
    out["_x"] = pts.x.values
    out["_y"] = pts.y.values
    out = out[~outside].reset_index(drop=True)

    # multi-location heuristic
    over = load_yaml("multilocation_overrides.yaml") or {}
    force_multi = {chain_key(n) for n in over.get("force_multi_location") or []}
    force_ind = {chain_key(n) for n in over.get("force_independent") or []}
    out["chain_key"] = out.DBA.map(chain_key)
    counts = out.groupby("chain_key").CAMIS.transform("count")
    out["locations"] = np.where(out.chain_key == "", 1, counts)
    thr = int(cfg_r["multi_location"]["min_locations"])
    out["multi_location"] = ((out.locations >= thr) | out.chain_key.isin(force_multi)) & ~out.chain_key.isin(force_ind)
    out["primary"] = out.cuisine_dohmh.map(cuisine_map).fillna("root")
    out["analysis"] = ~out.uninspected & ~out.multi_location
    diag["retained_establishments"] = len(out)
    diag["uninspected_retained"] = int(out.uninspected.sum())
    diag["multi_location_flagged"] = int(out.multi_location.sum())
    diag["multi_location_businesses"] = int(out[out.multi_location].chain_key.nunique())
    diag["analysis_population"] = int(out.analysis.sum())
    diag["top_multi_location"] = out[out.multi_location].chain_key.value_counts().head(25).to_dict()
    return out, diag


# --- enrichment ---------------------------------------------------------------------------------


def _source_map(section: dict[str, list[str]]) -> dict[str, str]:
    m: dict[str, str] = {}
    for node, values in section.items():
        for v in values or []:
            key = str(v).strip().lower()
            if key in m and m[key] != node:
                raise InvariantError(f"external label {key!r} mapped to both {m[key]} and {node}")
            m[key] = "generic_format" if node == "generic" else node
    return m


def load_osm(geo_crs_tree: tuple[Any, Any]) -> pd.DataFrame:
    path, _ = _snapshot("osm")
    data = json.loads(open(path, encoding="utf-8").read())
    rows = []
    for e in data["elements"]:
        t = e.get("tags", {})
        if t.get("amenity") not in ("restaurant", "fast_food", "cafe"):
            continue
        lat = e.get("lat", e.get("center", {}).get("lat"))
        lon = e.get("lon", e.get("center", {}).get("lon"))
        if lat is None or lon is None:
            continue
        rows.append({"id": f"{e['type']}/{e['id']}", "name": t.get("name"), "cuisine": t.get("cuisine"), "lat": lat, "lon": lon})
    return pd.DataFrame(rows)


def load_overture() -> pd.DataFrame:
    path, _ = _snapshot("overture")
    df = pd.read_parquet(path)
    df["alternates"] = df.category_alternates.map(lambda a: list(a) if a is not None else [])
    return df[["id", "name", "category_primary", "alternates", "lat", "lon"]]


def _project(lon: pd.Series, lat: pd.Series) -> np.ndarray:
    g = gpd.GeoSeries(gpd.points_from_xy(lon, lat), crs="EPSG:4326").to_crs(PROJECTED_CRS)
    return np.c_[g.x.values, g.y.values]


def build_restaurants(cfg: Config, geo: Geography) -> Restaurants:
    cfg_r = load_yaml("restaurants.yaml")
    cg = cfg.cuisines
    df, diag = load_dohmh(cfg_r, geo, cg.dohmh_map())
    xy = df[["_x", "_y"]].to_numpy()
    names = [normalize_name(n) for n in df.DBA]
    evidence: list[list[Evidence]] = [[] for _ in range(len(df))]

    src = load_yaml("cuisine_sources.yaml")
    unmapped: dict[str, Counter] = {"osm": Counter(), "overture": Counter()}
    max_ft = float(cfg_r["matching"]["max_distance_m"]) * FT_PER_M
    min_sim = float(cfg_r["matching"]["min_name_similarity"])
    match_stats: dict[str, Any] = {}

    def node_of(source: str, value: str, m: dict[str, str]) -> str:
        v = value.strip().lower()
        if v in m:
            return m[v]
        unmapped[source][v] += 1
        return "root"

    # OSM
    try:
        osm = load_osm((None, None))
        osm_map = _source_map(src["osm"])
        oxy = _project(osm.lon, osm.lat)
        pairs = match(xy, names, list(df.CAMIS), oxy, [normalize_name(n) for n in osm.name], list(osm.id), max_ft, min_sim)
        for i, j, s, d in pairs:
            cuis = osm.cuisine.iloc[j]
            if not isinstance(cuis, str):
                continue
            for v in cuis.split(";"):
                if v.strip():
                    evidence[i].append(Evidence(node_of("osm", v, osm_map), "osm", f"OSM {osm.id.iloc[j]} cuisine={v.strip()}"))
        match_stats["osm"] = {"external_places": len(osm), "with_cuisine": int(osm.cuisine.notna().sum()), "matched": len(pairs)}
        osm_matched = {i for i, *_ in pairs}
    except InvariantError as e:
        diag["osm_error"] = str(e)
        osm_matched = set()

    # Overture
    try:
        ov = load_overture()
        ov_map = _source_map(src["overture"])
        vxy = _project(ov.lon, ov.lat)
        pairs = match(xy, names, list(df.CAMIS), vxy, [normalize_name(n) for n in ov.name], list(ov.id), max_ft, min_sim)
        for i, j, s, d in pairs:
            cats = [ov.category_primary.iloc[j], *ov.alternates.iloc[j]]
            for c in dict.fromkeys(x for x in cats if isinstance(x, str)):
                evidence[i].append(Evidence(node_of("overture", c, ov_map), "overture", f"Overture {ov.id.iloc[j][:16]}… category={c}"))
        match_stats["overture"] = {"external_places": len(ov), "matched": len(pairs)}
        ov_matched = {i for i, *_ in pairs}
    except InvariantError as e:
        diag["overture_error"] = str(e)
        ov_matched = set()

    # name keywords
    kw = {strip_accents(k).lower(): v for k, v in (load_yaml("cuisine_keywords.yaml")["keywords"] or {}).items()}
    for k, v in kw.items():
        if v not in cg.nodes:
            raise InvariantError(f"keyword {k!r} maps to unknown node {v}")
    kw_hits = 0
    for i, name in enumerate(df.DBA):
        toks = name_tokens(name)
        joined = " " + " ".join(toks) + " "
        for k, node in kw.items():
            if f" {k} " in joined:
                evidence[i].append(Evidence(node, "keyword", f'name keyword "{k}"'))
                kw_hits += 1
    match_stats["keyword"] = {"keyword_hits": kw_hits}

    labels = [build_labels(p, ev, cg) for p, ev in zip(df.primary, evidence)]

    # match rates per source and per primary bucket (§4.4)
    df["_osm"] = [i in osm_matched for i in range(len(df))]
    df["_ov"] = [i in ov_matched for i in range(len(df))]
    by_bucket = (df.groupby("primary")[["_osm", "_ov"]].mean().round(3)
                 .join(df.groupby("primary").size().rename("n"))).sort_values("n", ascending=False)
    match_stats["rate_by_primary"] = by_bucket.head(40).reset_index().to_dict("records")
    for s, flag in (("osm", "_osm"), ("overture", "_ov")):
        if s in match_stats:
            match_stats[s]["match_rate"] = round(float(df[flag].mean()), 4)
    diag["matching"] = match_stats
    diag["unmapped_external_labels"] = {k: dict(v.most_common(40)) for k, v in unmapped.items()}
    conf = Counter(t.confidence for lab in labels for t in lab.tags)
    diag["tags_by_confidence"] = dict(conf)
    diag["restaurants_with_tags"] = sum(1 for lab in labels if lab.tags)
    diag["conflicts"] = sum(len(lab.conflicts) for lab in labels)
    diag["restaurants_with_conflicts"] = sum(1 for lab in labels if lab.conflicts)
    diag["built_at_snapshot"] = dt.date.fromisoformat(diag["snapshot_date"]).isoformat()
    return Restaurants(df=df, xy=xy, labels=labels, diagnostics=diag)
