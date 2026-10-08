"""Gap measures between a commercial cluster and a group's residential enclaves (§8).

All geometry is in a projected CRS (EPSG:2263, feet). Distances are polygon-to-polygon and are 0
when the polygons intersect. A group with no qualifying enclave gets `None` distances — never a
made-up large value. Nothing here assigns categories; every output is a continuous measure.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import shapely
from shapely.ops import unary_union

FT_PER_MI = 5280.0
SQFT_PER_SQMI = FT_PER_MI**2
DISTANCE_BANDS_MI = (0.5, 1.0, 2.0, 5.0)


@dataclass
class GapMeasures:
    distances_mi: list[float | None]  # to the 1st, 2nd, 3rd nearest enclave
    nearest: list[int]  # indices of those enclaves (in the input order)
    intersection_sqmi: float  # cluster footprint ∩ all enclaves
    pct_cluster_in_enclaves: float | None  # share of the footprint inside any enclave
    pct_nearest_enclave_in_cluster: float | None  # share of the nearest enclave inside the footprint
    extra: dict[str, Any] = field(default_factory=dict)


def enclave_distances(footprint: Any, enclaves: list[Any], k: int = 3, union: Any = None) -> GapMeasures:
    """`union` may be passed precomputed (the union of `enclaves`) to avoid recomputing it."""
    if not enclaves:
        return GapMeasures([None] * k, [], 0.0, None, None)
    d = np.array([footprint.distance(e) for e in enclaves])
    order = sorted(range(len(enclaves)), key=lambda i: (d[i], i))[:k]
    dist = [float(d[i]) / FT_PER_MI for i in order] + [None] * (k - len(order))
    union = union if union is not None else unary_union(enclaves)
    inter = footprint.intersection(union).area
    nearest = enclaves[order[0]]
    return GapMeasures(
        distances_mi=dist,
        nearest=order,
        intersection_sqmi=inter / SQFT_PER_SQMI,
        pct_cluster_in_enclaves=inter / footprint.area if footprint.area else None,
        pct_nearest_enclave_in_cluster=footprint.intersection(nearest).area / nearest.area if nearest.area else None,
    )


def area_weights(poly: Any, tract_geoms: Any, tree: shapely.STRtree, tract_areas: np.ndarray) -> dict[int, float]:
    """Share of each tract's land area inside `poly` (area-weighted interpolation weights)."""
    w: dict[int, float] = {}
    for i in tree.query(poly, predicate="intersects"):
        a = tract_areas[i]
        if a <= 0:
            continue
        frac = poly.intersection(tract_geoms[i]).area / a
        if frac > 0:
            w[int(i)] = min(1.0, frac)
    return w


def within_distance_shares(footprint: Any, tract_points: np.ndarray, tract_est: np.ndarray, city_est: float,
                           bands_mi: tuple[float, ...] = DISTANCE_BANDS_MI) -> list[float | None]:
    """Share of the group's citywide population living in tracts whose representative point lies
    within each distance band of the cluster footprint."""
    if city_est <= 0:
        return [None] * len(bands_mi)
    d = shapely.distance(footprint, tract_points) / FT_PER_MI
    est = np.nan_to_num(tract_est)
    return [float(est[d <= b].sum() / city_est) for b in bands_mi]


def weighted_group_value(weights: dict[int, float], est: np.ndarray, moe: np.ndarray, denom: np.ndarray) -> tuple[float, float | None, float]:
    """Area-weighted estimate, approximate MOE and denominator over weighted tracts."""
    e = sum(w * float(np.nan_to_num(est[i])) for i, w in weights.items())
    sq, zmax, unknown = 0.0, 0.0, False
    for i, w in weights.items():
        m = moe[i]
        if np.isnan(m):
            unknown = True
        elif np.nan_to_num(est[i]) == 0:
            zmax = max(zmax, w * m)
        else:
            sq += (w * m) ** 2
    d = sum(w * float(np.nan_to_num(denom[i])) for i, w in weights.items())
    return e, (None if unknown else float(np.sqrt(sq + zmax**2))), d
