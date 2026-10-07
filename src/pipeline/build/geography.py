"""Geography: tracts, NTAs, boroughs, validated joins and adjacency (§4.2)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely import STRtree

from pipeline.fetch.common import existing_snapshot, load_manifest

PROJECTED_CRS = "EPSG:2263"  # NY State Plane Long Island, US feet
FT_PER_MILE = 5280.0
# GEOID county code -> DCP borough code
COUNTY_TO_BORO = {"005": "2", "047": "3", "061": "1", "081": "4", "085": "5"}
BORO_NAMES = {"1": "Manhattan", "2": "Bronx", "3": "Brooklyn", "4": "Queens", "5": "Staten Island"}
BORO_ABBR = {"1": "MN", "2": "BX", "3": "BK", "4": "QN", "5": "SI"}


class InvariantError(RuntimeError):
    """A hard data invariant failed (§13.3): the build stops."""


@dataclass
class Geography:
    tracts: gpd.GeoDataFrame  # index order = tract index; columns geoid, nta, boro, has_land, geometry(clipped, 4326)
    tracts_water: gpd.GeoDataFrame  # same order, water-included geometry (4326)
    ntas: gpd.GeoDataFrame  # nta, name, boro, ntatype, geometry (clipped)
    boroughs: gpd.GeoDataFrame  # boro, name, geometry (clipped)
    tract_nta_idx: np.ndarray  # tract -> NTA index
    tract_boro_idx: np.ndarray  # tract -> borough index
    tract_adj: list[list[int]]  # rook adjacency on water-included geometry
    nta_adj: list[list[int]]
    diagnostics: dict[str, Any] = field(default_factory=dict)

    @property
    def n_tracts(self) -> int:
        return len(self.tracts)


def _snapshot_file(manifest: dict, source: str) -> str:
    entry = existing_snapshot(manifest, source)
    if not entry:
        raise InvariantError(f"missing snapshot {source}; run `uv run pipeline fetch`")
    from pipeline.paths import REPO_ROOT

    return str(REPO_ROOT / entry["files"][0]["path"])


def rook_adjacency(geoms: gpd.GeoSeries, min_shared_ft: float = 1.0) -> list[list[int]]:
    """Units sharing a boundary segment longer than `min_shared_ft` (point contacts excluded).

    Computed on projected, *unclipped* geometry so display clipping never changes neighbours.
    """
    g = geoms.to_crs(PROJECTED_CRS).buffer(0).values
    tree = STRtree(g)
    adj: list[set[int]] = [set() for _ in range(len(g))]
    left, right = tree.query(g, predicate="intersects")
    for i, j in zip(left, right):
        if i >= j:
            continue
        inter = g[i].boundary.intersection(g[j].boundary)
        if inter.length > min_shared_ft:
            adj[i].add(int(j))
            adj[j].add(int(i))
    return [sorted(a) for a in adj]


def load_geography(acs_geoids: list[str]) -> Geography:
    manifest = load_manifest()
    clipped = gpd.read_file(_snapshot_file(manifest, "nyc_tracts_clipped"))
    water = gpd.read_file(_snapshot_file(manifest, "nyc_tracts_water"))
    ntas = gpd.read_file(_snapshot_file(manifest, "nyc_ntas"))
    boros = gpd.read_file(_snapshot_file(manifest, "nyc_boroughs"))
    with open(_snapshot_file(manifest, "nyc_tract_nta_equiv"), encoding="utf-8") as f:
        equiv = pd.DataFrame(json.load(f))

    diag: dict[str, Any] = {}

    # --- uniqueness -------------------------------------------------------------------------
    for name, df, col in [("clipped tracts", clipped, "geoid"), ("water tracts", water, "geoid"),
                          ("equivalency", equiv, "geoid"), ("NTAs", ntas, "nta2020"), ("boroughs", boros, "borocode")]:
        dups = df[col][df[col].duplicated()].tolist()
        if dups:
            raise InvariantError(f"{name}: duplicate {col}: {dups[:5]}")
    if len(set(acs_geoids)) != len(acs_geoids):
        raise InvariantError("ACS: duplicate tract GEOIDs")

    # --- the tract universe is the ACS tract list; every tract must have unclipped geometry ----
    acs_set = set(acs_geoids)
    water_set, clipped_set, equiv_set = set(water.geoid), set(clipped.geoid), set(equiv.geoid)
    for name, s in [("water-included geometry", water_set), ("equivalency", equiv_set)]:
        missing = sorted(acs_set - s)
        extra = sorted(s - acs_set)
        if missing or extra:
            raise InvariantError(f"ACS tracts vs {name}: missing {missing[:5]} extra {extra[:5]}")
    no_land = sorted(acs_set - clipped_set)
    diag["tracts_without_land_geometry"] = no_land
    if clipped_set - acs_set:
        raise InvariantError(f"clipped tracts not in ACS: {sorted(clipped_set - acs_set)[:5]}")

    order = sorted(acs_geoids)
    water = water.set_index("geoid").loc[order].reset_index()
    clipped_idx = clipped.set_index("geoid")
    equiv = equiv.set_index("geoid").loc[order].reset_index()

    # --- tract -> borough: GEOID county code must agree with DCP borough code -----------------
    county_boro = [COUNTY_TO_BORO[g[2:5]] for g in order]
    bad_boro = [g for g, cb, eb in zip(order, county_boro, equiv.borocode) if cb != str(eb)]
    if bad_boro:
        raise InvariantError(f"tract borough mismatch (GEOID county vs DCP): {bad_boro[:5]}")

    # --- tract -> NTA: equivalency table, cross-checked spatially ------------------------------
    nta_codes = sorted(ntas.nta2020)
    nta_index = {c: i for i, c in enumerate(nta_codes)}
    unknown_nta = sorted(set(equiv.ntacode) - set(nta_codes))
    if unknown_nta:
        raise InvariantError(f"equivalency references unknown NTAs: {unknown_nta}")
    ntas = ntas.set_index("nta2020").loc[nta_codes].reset_index()
    ntas_p = ntas.to_crs(PROJECTED_CRS)
    water_p = water.to_crs(PROJECTED_CRS)
    tree = STRtree(ntas_p.geometry.values)
    spatial_mismatch = []
    for i, geom in enumerate(water_p.geometry.values):
        g = geom.buffer(0)
        cands = tree.query(g, predicate="intersects")
        best, best_area = None, 0.0
        for c in cands:
            a = g.intersection(ntas_p.geometry.values[c]).area
            if a > best_area:
                best, best_area = c, a
        if best is None:
            continue  # water-only tract outside all (clipped) NTAs: checked via equivalency
        if nta_codes[best] != equiv.ntacode.iloc[i]:
            spatial_mismatch.append((order[i], equiv.ntacode.iloc[i], nta_codes[best]))
    diag["tract_nta_spatial_mismatches"] = spatial_mismatch
    if len(spatial_mismatch) > 0.01 * len(order):
        raise InvariantError(f"tract->NTA equivalency disagrees with geometry for {len(spatial_mismatch)} tracts")

    nta_boro = dict(zip(ntas.nta2020, ntas.borocode.astype(str)))
    # A tract can legally sit in one borough while DCP assigns it to an NTA of another (Marble
    # Hill: New York County, Bronx NTA). Borough stats follow the legal county; NTA stats follow
    # DCP. Such cases are recorded; more than a handful would indicate a broken join.
    cross = [(g, b, n) for g, n, b in zip(order, equiv.ntacode, county_boro) if nta_boro[n] != b]
    diag["tracts_in_nta_of_other_borough"] = cross
    if len(cross) > 5:
        raise InvariantError(f"{len(cross)} tracts are assigned to an NTA in another borough: {cross[:5]}")

    boro_codes = sorted(boros.borocode.astype(str))
    boros["borocode"] = boros.borocode.astype(str)
    boros = boros.set_index("borocode").loc[boro_codes].reset_index()
    boro_index = {c: i for i, c in enumerate(boro_codes)}

    tract_nta_idx = np.array([nta_index[n] for n in equiv.ntacode], dtype=int)
    tract_boro_idx = np.array([boro_index[b] for b in county_boro], dtype=int)

    # display geometry: clipped where land exists, otherwise none (water-only tracts aren't drawn)
    geoms = [clipped_idx.geometry.get(g) if g in clipped_set else None for g in order]
    tracts = gpd.GeoDataFrame(
        {
            "geoid": order,
            "nta": equiv.ntacode.values,
            "boro": county_boro,
            "label": [str(clipped_idx.ctlabel.get(g)) if g in clipped_set else str(equiv.ctlabel.iloc[i])
                      for i, g in enumerate(order)],
            "has_land": [g in clipped_set for g in order],
        },
        geometry=geoms,
        crs="EPSG:4326",
    )

    tract_adj = rook_adjacency(water.geometry)
    nta_adj_sets: list[set[int]] = [set() for _ in nta_codes]
    for i, nbrs in enumerate(tract_adj):
        a = tract_nta_idx[i]
        for j in nbrs:
            b = tract_nta_idx[j]
            if a != b:
                nta_adj_sets[a].add(int(b))
    nta_adj = [sorted(s) for s in nta_adj_sets]
    diag["tract_adjacency_edges"] = sum(len(a) for a in tract_adj) // 2
    diag["tracts_without_neighbours"] = [order[i] for i, a in enumerate(tract_adj) if not a]
    diag["nta_adjacency_edges"] = sum(len(a) for a in nta_adj) // 2

    return Geography(
        tracts=tracts,
        tracts_water=water[["geoid", "geometry"]],
        ntas=ntas[["nta2020", "ntaname", "borocode", "ntatype", "ntaabbrev", "geometry"]].rename(
            columns={"nta2020": "nta", "ntaname": "name", "borocode": "boro"}),
        boroughs=boros[["borocode", "boroname", "geometry"]].rename(columns={"borocode": "boro", "boroname": "name"}),
        tract_nta_idx=tract_nta_idx,
        tract_boro_idx=tract_boro_idx,
        tract_adj=tract_adj,
        nta_adj=nta_adj,
        diagnostics=diag,
    )
