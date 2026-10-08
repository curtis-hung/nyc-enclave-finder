"""Gap measures for every cluster × declared group pairing (§8), scoped per §5.2, per preset."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Any

import numpy as np
import shapely

from pipeline.analysis.gaps import (
    DISTANCE_BANDS_MI,
    area_weights,
    enclave_distances,
    weighted_group_value,
    within_distance_shares,
)
from pipeline.analysis.stats import STATE_NAMES, ReliabilityRules, classify
from pipeline.build.clusters_build import ClusterRecord
from pipeline.build.demographics import GroupDim
from pipeline.build.enclaves_build import EnclaveGeometry, EnclaveRecord, enclave_scope
from pipeline.build.writer import clean, sig_arr, write_json
from pipeline.config import Config
from pipeline.paths import WEB_DATA_DIR


@dataclass
class ClusterGeo:
    weights: dict[int, float]  # catchment area weights over tracts
    tract_dist_mi: np.ndarray  # distance from each tract's representative point to the footprint


def build_gaps(cfg: Config, eg: EnclaveGeometry, gds: dict[str, dict[str, GroupDim]],
               enclaves: dict[str, list[EnclaveRecord]], clusters: dict[str, list[ClusterRecord]]) -> tuple[dict[str, Any], dict[str, Any]]:
    rules = ReliabilityRules.from_config(cfg.analysis)
    tracts = eg.tract_proj.values
    areas = np.array([g.area if g is not None and not g.is_empty else 0.0 for g in tracts])
    safe = [g if g is not None and not g.is_empty else shapely.Point(0, 0).buffer(1) for g in tracts]
    tree = shapely.STRtree(safe)
    rep = shapely.points([(g.representative_point().x, g.representative_point().y) for g in safe])
    cgeo: dict[str, ClusterGeo] = {}

    def geo_of(c: ClusterRecord) -> ClusterGeo:
        if c.id not in cgeo:
            w = area_weights(c.cluster.catchment, safe, tree, areas)
            cgeo[c.id] = ClusterGeo(w, shapely.distance(c.cluster.footprint, rep) / 5280.0)
        return cgeo[c.id]

    enc_by_key: dict[tuple[str, str, str], list[EnclaveRecord]] = {}
    for gid, recs in enclaves.items():
        for r in recs:
            enc_by_key.setdefault((gid, r.dim, r.preset), []).append(r)

    unions: dict[tuple[str, str, str], Any] = {}
    out: dict[str, Any] = {}
    stats = Counter()
    for gid, g in cfg.groups.items():
        pairings = []
        rows: dict[str, dict[str, list[dict[str, Any]]]] = {}
        for node, kind in g.cuisines.items():
            if node not in clusters:
                continue
            owner = cfg.exact_owner.get(node)
            target = gid if kind == "exact" else (owner or gid)
            pairings.append({"node": node, "kind": kind, "enclave_group": target, "owner_found": kind == "exact" or bool(owner)})
            for dim, preset in enclave_scope(cfg, target):
                gd = gds[target][dim]
                tract = gd.levels["tract"]
                encs = enc_by_key.get((target, dim, preset), [])
                egeoms = [e.geom_proj for e in encs]
                key = (target, dim, preset)
                if key not in unions and egeoms:
                    unions[key] = shapely.union_all(egeoms)
                    shapely.prepare(unions[key])
                for c in clusters[node]:
                    if c.preset != preset:
                        continue
                    m = enclave_distances(c.cluster.footprint, egeoms, union=unions.get(key))
                    cg_ = geo_of(c)
                    e, moe, d = weighted_group_value(cg_.weights, tract.est, tract.moe, tract.denom)
                    st = int(classify(np.array([e]), np.array([np.nan if moe is None else moe]), np.array([d]), rules)[0])
                    lq = (e / d) / gd.city_share if d > 0 and gd.city_share and st in (0, 1, 4) else None
                    est_all = np.nan_to_num(tract.est)
                    within = [float(est_all[cg_.tract_dist_mi <= b].sum() / gd.city_est) if gd.city_est else None
                              for b in DISTANCE_BANDS_MI]
                    rows.setdefault(preset, {}).setdefault(dim, []).append({
                        "cluster": c.id,
                        "node": node,
                        "kind": kind,
                        "enclave_group": target,
                        "restaurants": c.stats["restaurants"],
                        "cuisine_lq": c.stats["lq"],
                        "d": [clean(x, 3) for x in m.distances_mi],
                        "edge": clean(m.edge_mi, 3),
                        "edge_enclave": encs[m.edge_enclave].id if m.edge_enclave is not None else None,
                        "nearest": [encs[i].id for i in m.nearest],
                        "inter_sqmi": round(m.intersection_sqmi, 4),
                        "pct_cluster_in_enclaves": clean(m.pct_cluster_in_enclaves, 3),
                        "pct_nearest_enclave_in_cluster": clean(m.pct_nearest_enclave_in_cluster, 4),
                        "catch_count": round(e),
                        "catch_moe": None if moe is None else round(moe),
                        "catch_lq": sig_arr([lq], 3)[0] if lq is not None else None,
                        "catch_state": STATE_NAMES[st],
                        "within": sig_arr(within, 3),
                    })
                    stats["rows"] += 1
                    stats["null_distance"] += m.distances_mi[0] is None
        out[gid] = {"pairings": pairings, "bands_mi": list(DISTANCE_BANDS_MI), "rows": rows}

    # Bucket context (§8.3): for clusters of cuisines used as a *bucket* pairing, the leaf groups
    # under that bucket who live in the cluster's catchment. Display only: it never feeds labels,
    # tags or clustering (§2.3).
    context: dict[str, dict[str, list[dict[str, Any]]]] = {}
    bucket_nodes = {n for g in cfg.groups.values() for n, k in g.cuisines.items() if k == "bucket"}
    for node in sorted(bucket_nodes & set(clusters)):
        groups_ctx = context_groups(cfg, node)
        if not groups_ctx:
            continue
        per: dict[str, list[dict[str, Any]]] = {}
        for c in clusters[node]:
            w = geo_of(c).weights
            rows_c = []
            for gid in groups_ctx:
                dim = cfg.groups[gid].default_dimension
                gd = gds[gid][dim]
                tr = gd.levels["tract"]
                e, moe, d = weighted_group_value(w, tr.est, tr.moe, tr.denom)
                st = int(classify(np.array([e]), np.array([np.nan if moe is None else moe]), np.array([d]), rules)[0])
                lq = (e / d) / gd.city_share if d > 0 and gd.city_share and st in (0, 1, 4) else None
                if e <= 0:
                    continue
                rows_c.append({"group": gid, "dim": dim, "count": round(e), "moe": None if moe is None else round(moe),
                               "lq": sig_arr([lq], 3)[0] if lq is not None else None, "state": STATE_NAMES[st]})
            rows_c.sort(key=lambda r: (-(r["lq"] or -1), -r["count"], r["group"]))
            per[c.id] = rows_c
            stats["context_rows"] += len(rows_c)
        context[node] = per
    return out, dict(stats), context


def context_groups(cfg: Config, node: str) -> list[str]:
    """Leaf groups under the bucket's owning broad group, plus leaf groups pairing it as a bucket.
    Groups whose default dimension is itself a bucket mapping are left out."""
    out: set[str] = set()
    owner = cfg.exact_owner.get(node)

    def leaves(gid: str) -> list[str]:
        g = cfg.groups[gid]
        return [gid] if not g.children else [x for c in g.children for x in leaves(c)]

    if owner and cfg.groups[owner].children:
        out.update(leaves(owner))
    out.update(gid for gid, g in cfg.groups.items() if g.cuisines.get(node) == "bucket" and not g.children)
    return sorted(g for g in out if not cfg.groups[g].dims[cfg.groups[g].default_dimension].is_bucket)


def write_context(context: dict[str, Any]) -> None:
    for node, data in context.items():
        write_json(WEB_DATA_DIR / "context" / f"{node}.json", data)


def write_gaps(gaps: dict[str, Any]) -> None:
    for gid, data in gaps.items():
        write_json(WEB_DATA_DIR / "gaps" / f"{gid}.json", data)
