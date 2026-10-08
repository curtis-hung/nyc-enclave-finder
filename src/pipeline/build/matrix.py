"""Per-dimension tract matrices of candidate estimates and MOEs for client-side radius stats.

Radius focus (§9.3) is arbitrary, so its stats are computed in the browser by area-weighted
interpolation of tract values. The candidates and their order match `whoshere/*.json`.
Also writes tract land areas (for the interpolation weights) and the gazetteer.
"""

from __future__ import annotations

from typing import Any

import geopandas as gpd

from pipeline.build.geography import PROJECTED_CRS, Geography
from pipeline.build.whoshere import Candidate
from pipeline.build.writer import arr, write_json
from pipeline.config import load_yaml
from pipeline.paths import WEB_DATA_DIR

SQFT_PER_SQMI = 5280.0**2


def write_matrices(cands: dict[str, list[Candidate]]) -> None:
    for dim, cl in cands.items():
        write_json(WEB_DATA_DIR / "matrix" / f"{dim}.json", {
            "ids": [c.id for c in cl],
            "e": [arr(c.levels["tract"].est, 0) for c in cl],
            "m": [arr(c.levels["tract"].moe, 0) for c in cl],
        })


def tract_land_areas(geo: Geography) -> list[float]:
    g = gpd.GeoSeries(geo.tracts.geometry, crs="EPSG:4326").to_crs(PROJECTED_CRS)
    return [round(float(x.area) / SQFT_PER_SQMI, 5) if x is not None else 0.0 for x in g]


def write_gazetteer(group_ids: set[str] | None = None) -> list[dict[str, Any]]:
    places = load_yaml("gazetteer.yaml")["places"]
    for p in places:
        if group_ids is not None and p.get("group") and p["group"] not in group_ids:
            raise ValueError(f"gazetteer {p['id']}: unknown group {p['group']}")
        if not 0.1 <= float(p["radius_mi"]) <= 3:
            raise ValueError(f"gazetteer {p['id']}: radius outside 0.1-3 mi")
    write_json(WEB_DATA_DIR / "gazetteer.json", places)
    return places
