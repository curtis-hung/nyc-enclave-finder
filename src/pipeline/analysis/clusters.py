"""Commercial clusters (§7): density-based clustering of one cuisine's restaurants, qualified by a
non-circular cuisine LQ.

1. DBSCAN on the cuisine's restaurant points in a projected CRS (feet), eps/min_samples from the
   preset. Components smaller than `min_cluster_size` are dropped.
2. Footprint = convex hull of the member points (buffered slightly so 1-2 point hulls have area).
3. Catchment = footprint buffered by `catchment_ft`. It is defined by geometry only, never by
   cuisine membership.
4. cuisine LQ = (cuisine restaurants / ALL restaurants in the catchment)
              / (cuisine restaurants / ALL restaurants citywide).
   Every restaurant counts exactly once in every denominator, however many tags it has.
5. A cluster qualifies only if its cuisine LQ >= `lq_min`; restaurant density alone never does.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import shapely
from shapely.geometry import MultiPoint
from sklearn.cluster import DBSCAN


@dataclass(frozen=True)
class ClusterRule:
    eps_ft: float
    min_samples: int
    min_cluster_size: int
    catchment_ft: float
    lq_min: float

    @classmethod
    def from_preset(cls, preset: dict[str, Any]) -> "ClusterRule":
        c = preset["cluster"]
        return cls(eps_ft=float(c["eps_ft"]), min_samples=int(c["min_samples"]),
                   min_cluster_size=int(c["min_cluster_size"]), catchment_ft=float(c["catchment_ft"]),
                   lq_min=float(c["lq_min"]))


@dataclass
class Cluster:
    members: np.ndarray  # indices into the full restaurant arrays
    footprint: Any  # shapely polygon (projected)
    catchment: Any  # shapely polygon (projected)
    catchment_idx: np.ndarray  # all restaurants inside the catchment
    cuisine_in_catchment: int
    share: float
    ref_share: float
    lq: float


FOOTPRINT_PAD_FT = 60.0


def catchment_of(points: np.ndarray, catchment_ft: float) -> tuple[Any, Any]:
    hull = MultiPoint([tuple(p) for p in points]).convex_hull.buffer(FOOTPRINT_PAD_FT)
    return hull, hull.buffer(catchment_ft)


def in_polygon(poly: Any, xy: np.ndarray) -> np.ndarray:
    return shapely.contains_xy(poly, xy[:, 0], xy[:, 1])


def find_clusters(xy: np.ndarray, member: np.ndarray, rule: ClusterRule) -> list[Cluster]:
    """All qualifying clusters of the restaurants flagged by `member` (bool array over xy)."""
    n_all = len(xy)
    idx = np.flatnonzero(member)
    if n_all == 0 or len(idx) < max(rule.min_samples, rule.min_cluster_size):
        return []
    ref_share = len(idx) / n_all
    labels = DBSCAN(eps=rule.eps_ft, min_samples=rule.min_samples).fit(xy[idx]).labels_
    out: list[Cluster] = []
    for lab in sorted(set(labels) - {-1}):
        mem = idx[labels == lab]
        if len(mem) < rule.min_cluster_size:
            continue
        foot, catch = catchment_of(xy[mem], rule.catchment_ft)
        inside = np.flatnonzero(in_polygon(catch, xy))
        cuisine_n = int(member[inside].sum())
        share = cuisine_n / len(inside) if len(inside) else 0.0
        lq = share / ref_share if ref_share else float("nan")
        if lq < rule.lq_min:
            continue
        out.append(Cluster(members=mem, footprint=foot, catchment=catch, catchment_idx=inside,
                           cuisine_in_catchment=cuisine_n, share=share, ref_share=ref_share, lq=lq))
    out.sort(key=lambda c: (-len(c.members), int(c.members[0])))
    return out
