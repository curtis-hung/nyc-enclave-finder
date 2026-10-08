"""Hard data invariants (§13.3, fail the build) and plausibility checks (§13.4, warn only)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import geopandas as gpd
import numpy as np
from shapely.geometry import Point

from pipeline.analysis.stats import CAUTION, RELIABLE, ReliabilityRules, aggregate, compute_level
from pipeline.build.demographics import AcsSnapshot, Denominators, GroupDim
from pipeline.build.geography import Geography, InvariantError
from pipeline.config import Config


# --- invariants ---------------------------------------------------------------------------------


def check_variables_exist(cfg: Config, acs: AcsSnapshot) -> int:
    """Every variable referenced by the crosswalk or as a denominator exists in the snapshot."""
    missing = []
    n = 0
    for dim in cfg.dimensions.values():
        n += 1
        if not acs.has_var(dim.denominator):
            missing.append(("denominator", dim.id, dim.denominator))
    for g in cfg.groups.values():
        for dim_id, m in g.dims.items():
            for v in m.vars:
                n += 1
                if not v.startswith(cfg.dimensions[dim_id].table + "_"):
                    missing.append((g.id, dim_id, f"{v} is not in table {cfg.dimensions[dim_id].table}"))
                elif not acs.has_var(v):
                    missing.append((g.id, dim_id, v))
    if missing:
        raise InvariantError(f"crosswalk references variables missing from the snapshot: {missing[:10]}")
    return n


def check_reconciliation(cfg: Config, acs: AcsSnapshot, geo: Geography, den: Denominators,
                         tolerance: float = 0.02) -> dict[str, Any]:
    """Tract sums reconcile with published borough (county) totals; joins lose nothing."""
    out: dict[str, Any] = {}
    county_order = ["005", "047", "061", "081", "085"]  # Bronx, Brooklyn, Manhattan, Queens, SI
    boro_of_county = {"005": "2", "047": "3", "061": "1", "081": "4", "085": "5"}
    boro_codes = list(geo.boroughs.boro)
    for dim_id, dim in cfg.dimensions.items():
        t = acs.table(dim.denominator.split("_")[0])
        rows = []
        for c in county_order:
            pub = t.county_est[dim.denominator][c]
            got = float(den.est[dim_id]["boro"][boro_codes.index(boro_of_county[c])])
            rel = abs(got - pub) / pub if pub else 0.0
            rows.append({"county": c, "published": pub, "tract_sum": got, "rel_diff": round(rel, 5)})
            tol = 0.005 if dim.denominator == "B01003_001" else tolerance
            if rel > tol:
                raise InvariantError(f"{dim_id}: borough {c} tract sum {got:.0f} vs published {pub:.0f} ({rel:.2%})")
        out[dim_id] = rows
    # joins: every tract counted once at every level
    for dim_id in cfg.dimensions:
        t, n, b = (float(den.est[dim_id][lvl].sum()) for lvl in ("tract", "nta", "boro"))
        if not (abs(t - n) < 0.5 and abs(t - b) < 0.5):
            raise InvariantError(f"{dim_id}: tract/NTA/borough totals differ ({t}, {n}, {b}): a join lost data")
    pop = den.est["race"]["tract"]
    water_only = [i for i, g in enumerate(geo.tracts.geoid) if g in geo.diagnostics["tracts_without_land_geometry"]]
    lost = float(pop[water_only].sum()) if water_only else 0.0
    if lost > 0:
        raise InvariantError(f"water-only tracts without display geometry hold {lost:.0f} residents")
    out["water_only_tract_population"] = lost
    return out


def check_group_outputs(cfg: Config, geo: Geography, gds: dict[str, dict[str, GroupDim]]) -> dict[str, int]:
    """Processed outputs reconcile with the build log: lengths, totals, no cross-dimension sums."""
    n_units = {"tract": geo.n_tracts, "nta": len(geo.ntas), "boro": len(geo.boroughs)}
    checked = 0
    for gid, dims in gds.items():
        if set(dims) != set(cfg.groups[gid].dims):
            raise InvariantError(f"{gid}: built dimensions differ from the crosswalk")
        for dim_id, gd in dims.items():
            table = cfg.dimensions[dim_id].table
            if any(not v.startswith(table + "_") for v in gd.vars):
                raise InvariantError(f"{gid}/{dim_id}: mixes variables from another dimension")
            for lvl, lv in gd.levels.items():
                if len(lv.est) != n_units[lvl]:
                    raise InvariantError(f"{gid}/{dim_id}/{lvl}: {len(lv.est)} values for {n_units[lvl]} units")
            t = float(np.nansum(gd.levels["tract"].est))
            for lvl in ("nta", "boro"):
                s = float(np.nansum(gd.levels[lvl].est))
                if abs(s - t) > 0.5:
                    raise InvariantError(f"{gid}/{dim_id}: {lvl} total {s} != tract total {t}")
            if abs(t - gd.city_est) > 0.5:
                raise InvariantError(f"{gid}/{dim_id}: city total mismatch")
            checked += 1
    return {"group_dimensions_checked": checked}


# --- plausibility (warn only) -------------------------------------------------------------------


@dataclass(frozen=True)
class PlausibilityCheck:
    id: str
    description: str
    dimension: str
    vars: tuple[str, ...]
    place: str
    lon: float
    lat: float


RESIDENTIAL_CHECKS = [
    PlausibilityCheck("russian_brighton", "Russian (language category: Russian, Polish, or other Slavic) around Brighton Beach",
                      "language", ("C16001_012",), "Brighton Beach", -73.9614, 40.5776),
    PlausibilityCheck("russian_ancestry_brighton", "Russian ancestry around Brighton Beach",
                      "ancestry", ("B04006_064",), "Brighton Beach", -73.9614, 40.5776),
    PlausibilityCheck("dominican_wahi", "Dominican origin around Washington Heights",
                      "hispanic", ("B03001_007",), "Washington Heights", -73.9394, 40.8417),
    PlausibilityCheck("chinese_flushing", "Chinese population around Flushing",
                      "asian", ("B02015_002",), "Flushing", -73.8303, 40.7580),
    PlausibilityCheck("yiddish_boro_park", "Yiddish (language category: German or other West Germanic) around Borough Park",
                      "language", ("C16001_009",), "Borough Park", -73.9930, 40.6340),
]


def check_restaurants(diag: dict[str, Any]) -> dict[str, Any]:
    """Processed restaurant counts reconcile with the pipeline log (§13.3)."""
    expect = (diag["unique_camis"] - diag["dropped_missing_or_invalid_coordinates"] - diag["filtered_inactive"]
              - diag["dropped_outside_nyc_tracts"])
    if expect != diag["retained_establishments"]:
        raise InvariantError(f"restaurant counts do not reconcile: expected {expect}, kept {diag['retained_establishments']}")
    rate = 1 - diag["dropped_missing_or_invalid_coordinates"] / diag["unique_camis"]
    if rate < 0.9:
        raise InvariantError(f"only {rate:.1%} of establishments have parseable coordinates")
    return {"coordinate_parse_rate": round(rate, 4), "reconciled": True}


def korean_cuisine_check(cfg: Config, geo: Geography, r: Any, clusters: dict[str, Any]) -> dict[str, Any]:
    """Warn-only (§13.4): Korean-cuisine restaurants concentrated around W 32nd St."""
    from pipeline.analysis.labels import matches_node

    top_n = cfg.analysis["plausibility"]["top_n_ntas"]
    pt = Point(-73.9869, 40.7477)
    df = r.df[r.df.analysis]
    member = np.array([matches_node("korean", p, [(t.label, t.confidence) for t in r.labels[i].tags], cfg.cuisines)
                       for i, p in zip(df.index, df.primary)])
    nta = geo.tract_nta_idx[df.tract.to_numpy()]
    total = np.bincount(nta, minlength=len(geo.ntas))
    kor = np.bincount(nta, weights=member, minlength=len(geo.ntas))
    ref = member.sum() / len(member)
    with np.errstate(divide="ignore", invalid="ignore"):
        lq = (kor / total) / ref
    eligible = total >= 20
    order = [i for i in np.argsort(-np.nan_to_num(lq, nan=-1)) if eligible[i]]
    hit = [i for i, g in enumerate(geo.ntas.geometry) if g is not None and g.contains(pt)]
    target = hit[0] if hit else None
    rank = order.index(target) + 1 if target in order else None
    near = None
    recs = [x for x in clusters.get("korean", []) if x.preset == cfg.presets["default_preset"]]
    if recs:
        p_proj = gpd.GeoSeries([pt], crs="EPSG:4326").to_crs("EPSG:2263").iloc[0]
        near = round(min(x.cluster.footprint.distance(p_proj) for x in recs) / 5280, 2)
    return {
        "id": "korean_cuisine_w32", "description": "Korean-cuisine restaurants around W 32nd St (restaurant data)",
        "place": "W 32nd St (Koreatown)", "nta": geo.ntas.nta.iloc[target] if target is not None else None,
        "nta_name": geo.ntas.name.iloc[target] if target is not None else None,
        "nta_lq": round(float(lq[target]), 2) if target is not None and np.isfinite(lq[target]) else None,
        "nta_rank": rank, "ntas_ranked": len(order),
        "top_3": [{"nta": geo.ntas.name.iloc[i], "lq": round(float(lq[i]), 2)} for i in order[:3]],
        "nearest_default_cluster_mi": near,
        "criterion": f"NTA containing W 32nd St ranks in the top {top_n} NTAs by Korean-cuisine LQ (NTAs with >= 20 restaurants)",
        "passed": rank is not None and rank <= top_n,
    }


def run_plausibility(cfg: Config, acs: AcsSnapshot, geo: Geography, den: Denominators) -> list[dict[str, Any]]:
    rules = ReliabilityRules.from_config(cfg.analysis)
    top_n = cfg.analysis["plausibility"]["top_n_ntas"]
    ntas: gpd.GeoDataFrame = geo.ntas
    results = []
    for chk in RESIDENTIAL_CHECKS:
        ests = [acs.var(v)[0] for v in chk.vars]
        moes = [acs.var(v)[1] for v in chk.vars]
        e = np.sum(np.vstack(ests), axis=0)
        m = np.sqrt(np.sum(np.vstack(moes) ** 2, axis=0))
        city = float(np.nansum(e))
        share = city / den.city[chk.dimension]
        ne, nm = aggregate(e, m, geo.tract_nta_idx, len(ntas))
        lv = compute_level(ne, nm, den.est[chk.dimension]["nta"], share, rules, city)
        usable = np.isin(lv.state, [RELIABLE, CAUTION])
        order = [i for i in np.argsort(-np.nan_to_num(lv.lq, nan=-1)) if usable[i]]
        pt = Point(chk.lon, chk.lat)
        hit = [i for i, g in enumerate(ntas.geometry) if g is not None and g.contains(pt)]
        target = hit[0] if hit else None
        rank = order.index(target) + 1 if target is not None and target in order else None
        passed = rank is not None and rank <= top_n
        results.append({
            "id": chk.id,
            "description": chk.description,
            "place": chk.place,
            "nta": ntas.nta.iloc[target] if target is not None else None,
            "nta_name": ntas.name.iloc[target] if target is not None else None,
            "nta_lq": round(float(lv.lq[target]), 2) if target is not None and not np.isnan(lv.lq[target]) else None,
            "nta_rank": rank,
            "ntas_ranked": len(order),
            "top_3": [{"nta": ntas.name.iloc[i], "lq": round(float(lv.lq[i]), 2)} for i in order[:3]],
            "criterion": f"NTA containing {chk.place} ranks in the top {top_n} NTAs by LQ",
            "passed": passed,
        })
    return results
