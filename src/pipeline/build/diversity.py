"""Diversity layer (§9.6, SHOULD): normalized Shannon entropy of the eight race/Hispanic-origin
categories of B03002 (Hispanic of any race; non-Hispanic White, Black, AIAN, Asian, NHPI, other,
two or more):

    D = −Σ p_k ln p_k / ln 8,  p_k = category count / total

0 = everyone in one category, 1 = all eight equal. It describes mix only and is not framed as
good or bad. Units with fewer residents than the minimum-data rule get no value (unavailable).
"""

from __future__ import annotations

import math

import numpy as np

from pipeline.build.demographics import GroupDim
from pipeline.build.writer import arr, write_json
from pipeline.config import Config
from pipeline.paths import WEB_DATA_DIR


def entropy(counts: np.ndarray, total: np.ndarray, k: int) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        p = counts / total
        terms = np.where(p > 0, -p * np.log(p), 0.0)
    return terms.sum(axis=0) / math.log(k)


def build_diversity(cfg: Config, gds: dict[str, dict[str, GroupDim]]) -> dict[str, int]:
    cats = [gid for gid, g in cfg.groups.items() if "race" in g.dims and not g.dims["race"].derived]
    min_den = float(cfg.analysis["reliability"]["min_denominator"])
    out = {"definition": __doc__.split("\n\n")[0].replace("\n", " ").strip(), "categories": cats}
    stats = {}
    for lvl in ("tract", "nta"):
        counts = np.vstack([np.nan_to_num(gds[g]["race"].levels[lvl].est) for g in cats])
        total = gds[cats[0]]["race"].levels[lvl].denom
        d = entropy(counts, total, len(cats))
        d = np.where(total >= min_den, d, np.nan)
        out[lvl] = arr(d, 3)
        stats[lvl] = int(np.isfinite(d).sum())
    write_json(WEB_DATA_DIR / "diversity.json", out)
    return stats
