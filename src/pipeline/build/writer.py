"""Deterministic writers for frontend assets, plus the payload size report (§12)."""

from __future__ import annotations

import gzip
import json
import math
from pathlib import Path
from typing import Any, Iterable

import geopandas as gpd
import numpy as np
from shapely.geometry import mapping

from pipeline.paths import REPO_ROOT, WEB_DATA_DIR


def clean(v: Any, nd: int | None = None) -> Any:
    """JSON-safe scalar: NaN -> None, numpy -> python, optional rounding."""
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (float, np.floating)):
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        if nd is not None:
            r = round(f, nd)
            return int(r) if nd == 0 else r
        return f
    return v


def arr(a: Iterable[Any], nd: int | None = None) -> list[Any]:
    return [clean(x, nd) for x in a]


def sig_arr(a: Iterable[Any], sig: int = 3) -> list[Any]:
    """Round to significant digits (good for shares/LQs spanning orders of magnitude)."""
    out = []
    for x in a:
        x = clean(x)
        if x is None or x == 0:
            out.append(x)
            continue
        nd = max(0, sig - 1 - int(math.floor(math.log10(abs(x)))))
        out.append(round(x, nd))
    return out


def write_json(path: Path, obj: Any) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    path.write_text(text, encoding="utf-8", newline="\n")
    return path


def _round_coords(obj: Any, nd: int) -> Any:
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(float(c), nd) for c in obj]
        return [_round_coords(o, nd) for o in obj]
    return obj


def write_geojson(path: Path, gdf: gpd.GeoDataFrame, props: list[str], nd: int = 5) -> Path:
    feats = []
    for _, row in gdf.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        gm = mapping(geom)
        feats.append({
            "type": "Feature",
            "properties": {p: clean(row[p]) for p in props},
            "geometry": {"type": gm["type"], "coordinates": _round_coords(gm["coordinates"], nd)},
        })
    return write_json(path, {"type": "FeatureCollection", "features": feats})


def simplify_for_display(gdf: gpd.GeoDataFrame, tolerance_ft: float) -> gpd.GeoDataFrame:
    """Simplify in a projected CRS for display only (analysis never uses this geometry)."""
    out = gdf.copy()
    has = out.geometry.notna()
    proj = out.loc[has].to_crs("EPSG:2263")
    proj["geometry"] = proj.geometry.simplify(tolerance_ft, preserve_topology=True).buffer(0)
    out.loc[has, "geometry"] = proj.to_crs("EPSG:4326").geometry
    return out


def size_report(root: Path = WEB_DATA_DIR) -> dict[str, Any]:
    files = []
    for p in sorted(root.rglob("*")):
        if p.is_file() and p.name != ".gitkeep":
            raw = p.read_bytes()
            files.append({
                "path": p.relative_to(REPO_ROOT).as_posix(),
                "bytes": len(raw),
                "gzip": len(gzip.compress(raw, compresslevel=9, mtime=0)),
            })
    return {"files": files, "total_bytes": sum(f["bytes"] for f in files), "total_gzip": sum(f["gzip"] for f in files)}


def fmt_kb(n: int) -> str:
    return f"{n / 1024:,.1f} KB" if n < 1024 * 1024 else f"{n / 1024 / 1024:,.2f} MB"
