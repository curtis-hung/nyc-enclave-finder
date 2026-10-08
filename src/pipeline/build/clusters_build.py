"""Cluster every paired cuisine node under every preset and write restaurant/cluster assets."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Any

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import mapping

from pipeline.analysis.clusters import Cluster, ClusterRule, find_clusters
from pipeline.analysis.labels import CONFIDENCE_ORDER
from pipeline.build.geography import PROJECTED_CRS, Geography
from pipeline.build.restaurants import Restaurants
from pipeline.build.writer import _round_coords, clean, write_json
from pipeline.config import Config, CuisineGraph
from pipeline.paths import WEB_DATA_DIR

CONF_CODE = {"low": 1, "medium": 2, "high": 3}
SQFT_PER_SQMI = 5280.0**2


@dataclass
class NodeMembership:
    node: str
    basis: str  # "primary" (node is a DOHMH value) | "tag" (leaf/intermediate, tags only below it)
    member: np.ndarray  # bool over the analysis population
    via_primary: np.ndarray  # bool: member because of the primary label
    tag_conf: list[str | None]  # best qualifying tag confidence per restaurant (None if via primary only)


@dataclass
class ClusterRecord:
    id: str
    node: str
    preset: str
    basis: str
    cluster: Cluster
    stats: dict[str, Any] = field(default_factory=dict)


def has_dohmh(cg: CuisineGraph, node: str) -> bool:
    return bool(cg.nodes[node].dohmh)


def parent_buckets(cg: CuisineGraph, node: str) -> list[str]:
    """Nearest ancestors that are DOHMH values (the buckets whose restaurants could carry the tag)."""
    anc = [a for a in cg.ancestors[node] if a != "root" and has_dohmh(cg, a)]
    return sorted(a for a in anc if not any(a in cg.ancestors[b] for b in anc if b != a))


def membership(cg: CuisineGraph, node: str, primaries: list[str], tags: list[list[tuple[str, str]]],
               tag_floor: str) -> NodeMembership:
    basis = "primary" if has_dohmh(cg, node) else "tag"
    floor = CONFIDENCE_ORDER["low" if basis == "primary" else tag_floor]
    n = len(primaries)
    member = np.zeros(n, bool)
    via_p = np.zeros(n, bool)
    best: list[str | None] = [None] * n
    for i, (p, tg) in enumerate(zip(primaries, tags)):
        pe = cg.effective(p)
        if pe != "root" and (pe == node or node in cg.ancestors[pe]):
            member[i] = via_p[i] = True
        for lab, conf in tg:
            if CONFIDENCE_ORDER[conf] >= floor and (lab == node or node in cg.ancestors[lab]):
                member[i] = True
                if best[i] is None or CONFIDENCE_ORDER[conf] > CONFIDENCE_ORDER[best[i]]:
                    best[i] = conf
    return NodeMembership(node, basis, member, via_p, best)


def cluster_nodes(cfg: Config) -> list[str]:
    nodes = sorted({c for g in cfg.groups.values() for c in g.cuisines})
    return [n for n in nodes if cfg.cuisines.nodes[n].kind not in ("generic",)]


def build_clusters(cfg: Config, r: Restaurants) -> tuple[dict[str, list[ClusterRecord]], dict[str, Any]]:
    cg = cfg.cuisines
    A = np.flatnonzero(r.df.analysis.to_numpy())
    xy = r.xy[A]
    primaries = list(r.df.primary.iloc[A])
    tags = [[(t.label, t.confidence) for t in r.labels[i].tags] for i in A]
    locations = r.df.locations.to_numpy()[A]
    tag_floor = cfg.presets.get("tag_confidence", "medium")
    out: dict[str, list[ClusterRecord]] = {}
    diag: dict[str, Any] = {}
    for node in cluster_nodes(cfg):
        nm = membership(cg, node, primaries, tags, tag_floor)
        recs: list[ClusterRecord] = []
        buckets = parent_buckets(cg, node) if nm.basis == "tag" else []
        for preset, pdef in cfg.presets["presets"].items():
            rule = ClusterRule.from_preset(pdef)
            for k, c in enumerate(find_clusters(xy, nm.member, rule)):
                mem = c.members
                conf_mix = Counter(nm.tag_conf[i] for i in mem if not nm.via_primary[i])
                stats: dict[str, Any] = {
                    "restaurants": int(len(mem)),
                    "independent": int((locations[mem] == 1).sum()),
                    "catchment_restaurants": int(len(c.catchment_idx)),
                    "cuisine_in_catchment": c.cuisine_in_catchment,
                    "share": clean(c.share, 4),
                    "ref_share": clean(c.ref_share, 5),
                    "lq": clean(c.lq, 2),
                    "share_gap": clean(c.share_gap, 3),
                    "qualified_by": c.qualified_by,
                    "via_primary": int(nm.via_primary[mem].sum()),
                    "via_tags": int((~nm.via_primary[mem]).sum()),
                    "tag_confidence": {k2: v for k2, v in conf_mix.items() if k2},
                    "footprint_sqmi": round(c.footprint.area / SQFT_PER_SQMI, 4),
                }
                if nm.basis == "tag":
                    inb = [i for i in c.catchment_idx if cg.effective(primaries[i]) in buckets]
                    tagged = [i for i in inb if any(CONFIDENCE_ORDER[cf] >= CONFIDENCE_ORDER["medium"] for _, cf in tags[i])]
                    stats["tag_coverage"] = clean(len(tagged) / len(inb), 3) if inb else None
                    stats["tag_coverage_n"] = [len(tagged), len(inb)]
                    stats["parent_buckets"] = buckets
                recs.append(ClusterRecord(f"{node}.{preset}.{k}", node, preset, nm.basis, c, stats))
        out[node] = recs
        diag[node] = {"basis": nm.basis, "points": int(nm.member.sum()),
                      **{p: sum(1 for x in recs if x.preset == p) for p in cfg.presets["presets"]}}
    return out, {"analysis_index": A, "per_node": diag}


# --- outputs ------------------------------------------------------------------------------------


def _geojson_geoms(geoms: list[Any], tol: float) -> list[dict[str, Any]]:
    if not geoms:
        return []
    s = gpd.GeoSeries(geoms, crs=PROJECTED_CRS).simplify(tol).to_crs("EPSG:4326")
    out = []
    for g in s:
        gm = mapping(g)
        out.append({"type": gm["type"], "coordinates": _round_coords(gm["coordinates"], 5)})
    return out


def write_restaurant_assets(cfg: Config, geo: Geography, r: Restaurants, clusters: dict[str, list[ClusterRecord]],
                            analysis_index: np.ndarray) -> dict[str, Any]:
    cg = cfg.cuisines
    node_ids = list(cg.nodes)
    nidx = {n: i for i, n in enumerate(node_ids)}
    df = r.df
    # cuisine hierarchy for the client
    write_json(WEB_DATA_DIR / "cuisines.json", {
        "nodes": [{
            "id": n, "name": cg.nodes[n].name, "kind": cg.nodes[n].kind,
            "parents": [nidx[p] for p in cg.nodes[n].parents],
            "anc": sorted(nidx[a] for a in cg.ancestors[n]),
            "dohmh": cg.nodes[n].dohmh,
        } for n in node_ids],
        "exact_owner": cfg.exact_owner,
        "tag_confidence": cfg.presets.get("tag_confidence", "medium"),
    })
    # compact points: restaurant index = row order
    flags = (df.multi_location.astype(int) * 1 + df.uninspected.astype(int) * 2 + df.analysis.astype(int) * 4).to_numpy()
    tags = {str(i): [[nidx[t.label], CONF_CODE[t.confidence]] for t in lab.tags] for i, lab in enumerate(r.labels) if lab.tags}
    write_json(WEB_DATA_DIR / "restaurants" / "points.json", {
        "n": len(df),
        "lon": [int(round(v * 1e5)) for v in df._lon],
        "lat": [int(round(v * 1e5)) for v in df._lat],
        "tract": [int(x) for x in df.tract],
        "primary": [nidx[p] for p in df.primary],
        "flags": [int(x) for x in flags],
        "tags": tags,
        "flag_bits": {"multi_location": 1, "uninspected": 2, "analysis": 4},
        "conf_codes": CONF_CODE,
    })
    # details per NTA (loaded on demand)
    nta_of = geo.tract_nta_idx[df.tract.to_numpy()]
    for k, code in enumerate(geo.ntas.nta):
        rows = np.flatnonzero(nta_of == k)
        det = {}
        for i in rows:
            row = df.iloc[i]
            lab = r.labels[i]
            det[str(i)] = {
                "name": row.DBA if isinstance(row.DBA, str) else "(unnamed)",
                "address": " ".join(str(x) for x in (row.BUILDING, row.STREET) if isinstance(x, str)).strip(),
                "boro": row.BORO if isinstance(row.BORO, str) else "",
                "zip": row.ZIPCODE if isinstance(row.ZIPCODE, str) else "",
                "cuisine_dohmh": row.cuisine_dohmh if isinstance(row.cuisine_dohmh, str) else None,
                "last_inspection": row.last_inspection.date().isoformat() if pd.notna(row.last_inspection) else None,
                "grade": row.GRADE if isinstance(row.GRADE, str) else None,
                "locations": int(row.locations),
                "camis": row.CAMIS,
                "tags": [{"label": t.label, "confidence": t.confidence,
                          "sources": [{"source": e.source, "evidence": e.evidence} for e in t.sources]} for t in lab.tags],
                "conflicts": [{"label": e.label, "source": e.source, "evidence": e.evidence} for e in lab.conflicts],
            }
        write_json(WEB_DATA_DIR / "restaurants" / "details" / f"{code}.json", det)
    # clusters per cuisine node
    sizes = {}
    for node, recs in clusters.items():
        feats = []
        foot = _geojson_geoms([x.cluster.footprint for x in recs], 15)
        catch = _geojson_geoms([x.cluster.catchment for x in recs], 25)
        stats: dict[str, list[dict[str, Any]]] = {}
        for k, x in enumerate(recs):
            members = [int(analysis_index[m]) for m in x.cluster.members]
            stats.setdefault(x.preset, []).append({"id": x.id, "members": members, **x.stats})
            feats.append({"type": "Feature", "properties": {"id": x.id, "preset": x.preset, "part": "footprint"}, "geometry": foot[k]})
            feats.append({"type": "Feature", "properties": {"id": x.id, "preset": x.preset, "part": "catchment"}, "geometry": catch[k]})
        basis = recs[0].basis if recs else ("primary" if has_dohmh(cg, node) else "tag")
        write_json(WEB_DATA_DIR / "clusters" / f"{node}.json",
                   {"node": node, "basis": basis, "stats": stats, "geojson": {"type": "FeatureCollection", "features": feats}})
        sizes[node] = len(recs)
    return sizes
