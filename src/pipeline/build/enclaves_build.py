"""Compute enclaves for every group (scope per §5.2) and write per-group bundles."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import geopandas as gpd
import numpy as np
from shapely.geometry import mapping
from shapely.ops import unary_union

from pipeline.analysis.enclaves import EnclaveRule, detect_enclaves
from pipeline.build.demographics import GroupDim
from pipeline.build.geography import PROJECTED_CRS, Geography
from pipeline.build.writer import _round_coords, clean, write_json
from pipeline.config import Config
from pipeline.paths import WEB_DATA_DIR

SQFT_PER_SQMI = 5280.0**2


@dataclass
class EnclaveRecord:
    id: str
    group: str
    dim: str
    preset: str
    level: str
    units: list[int]
    population: float
    share_of_city: float
    peak_lq: float
    n_tracts: int
    geom_proj: Any  # shapely geometry in EPSG:2263 (clipped land), used for distances/areas


class EnclaveGeometry:
    """Clipped land geometry per unit, projected once."""

    def __init__(self, geo: Geography):
        self.geo = geo
        tr = geo.tracts.set_geometry(geo.tracts.geometry)
        self.tract_proj = gpd.GeoSeries(tr.geometry, crs="EPSG:4326").to_crs(PROJECTED_CRS).buffer(0)
        self.nta_proj = gpd.GeoSeries(geo.ntas.geometry, crs="EPSG:4326").to_crs(PROJECTED_CRS).buffer(0)
        self.tracts_per_nta = np.bincount(geo.tract_nta_idx, minlength=len(geo.ntas))

    def union(self, level: str, units: list[int]):
        src = self.tract_proj if level == "tract" else self.nta_proj
        parts = [src.iloc[u] for u in units if src.iloc[u] is not None and not src.iloc[u].is_empty]
        # Morphological close (+/- 3 ft) dissolves hairline gaps between clipped neighbours so the
        # enclave is one outline; 3 ft is far below any distance or area that is reported.
        return unary_union([g.buffer(3, join_style="mitre") for g in parts]).buffer(-3, join_style="mitre").buffer(0)

    def n_tracts(self, level: str, units: list[int]) -> int:
        return len(units) if level == "tract" else int(self.tracts_per_nta[units].sum())


def enclave_scope(cfg: Config, gid: str) -> list[tuple[str, str]]:
    """(dimension, preset) pairs: default dimension x all presets (MUST); other dimensions x
    default preset (SHOULD)."""
    g = cfg.groups[gid]
    presets = list(cfg.presets["presets"])
    default = cfg.presets["default_preset"]
    pairs = [(g.default_dimension, p) for p in presets]
    pairs += [(d, default) for d in g.dims if d != g.default_dimension]
    return pairs


def build_enclaves(cfg: Config, geo: Geography, gds: dict[str, dict[str, GroupDim]],
                   eg: EnclaveGeometry) -> dict[str, list[EnclaveRecord]]:
    adjacency = {"tract": geo.tract_adj, "nta": geo.nta_adj}
    out: dict[str, list[EnclaveRecord]] = {}
    for gid in cfg.groups:
        recs: list[EnclaveRecord] = []
        for dim, preset in enclave_scope(cfg, gid):
            gd = gds[gid][dim]
            level = gd.recommended_level
            lv = gd.levels[level]
            rule = EnclaveRule.from_preset(cfg.presets["presets"][preset])
            for k, e in enumerate(detect_enclaves(lv.lq, lv.est, lv.state, adjacency[level], rule)):
                recs.append(EnclaveRecord(
                    id=f"{gid}.{dim}.{preset}.{k}", group=gid, dim=dim, preset=preset, level=level,
                    units=e.units, population=e.population,
                    share_of_city=e.population / gd.city_est if gd.city_est else float("nan"),
                    peak_lq=e.peak_lq, n_tracts=eg.n_tracts(level, e.units), geom_proj=eg.union(level, e.units),
                ))
        out[gid] = recs
    return out


def write_enclaves(enclaves: dict[str, list[EnclaveRecord]]) -> None:
    for gid, recs in enclaves.items():
        stats: dict[str, dict[str, Any]] = {}
        feats = []
        if recs:
            proj = gpd.GeoSeries([r.geom_proj for r in recs], crs=PROJECTED_CRS)
            disp = proj.simplify(20, preserve_topology=True).buffer(0).to_crs("EPSG:4326")
        for i, r in enumerate(recs):
            stats.setdefault(r.dim, {}).setdefault(r.preset, {"level": r.level, "items": []})
            stats[r.dim][r.preset]["items"].append({
                "id": r.id,
                "units": r.units,
                "pop": round(r.population),
                "share": clean(r.share_of_city, 4),
                "peak_lq": clean(r.peak_lq, 2),
                "n_units": len(r.units),
                "n_tracts": r.n_tracts,
                "area_sqmi": round(r.geom_proj.area / SQFT_PER_SQMI, 3),
            })
            gm = mapping(disp.iloc[i])
            feats.append({
                "type": "Feature",
                "properties": {"id": r.id, "dim": r.dim, "preset": r.preset},
                "geometry": {"type": gm["type"], "coordinates": _round_coords(gm["coordinates"], 5)},
            })
        write_json(WEB_DATA_DIR / "enclaves" / f"{gid}.json",
                   {"stats": stats, "geojson": {"type": "FeatureCollection", "features": feats}})
