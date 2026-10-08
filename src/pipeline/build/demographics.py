"""Group x dimension values at tract, NTA, borough and city level (§2.5-2.7, §5).

Shares are always numerator / the dimension's own denominator, and LQs always compare shares
from the same dimension and denominator (§2.5). Values are never added across dimensions (§2.6).
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from pipeline.analysis.stats import (
    CAUTION,
    RELIABLE,
    classify,
    LevelValues,
    ReliabilityRules,
    aggregate,
    combine_moe,
    compute_level,
    parse_estimate,
    parse_moe,
    sum_estimates,
)
from pipeline.build.geography import Geography, InvariantError
from pipeline.config import Config
from pipeline.fetch.common import existing_snapshot, load_manifest
from pipeline.paths import REPO_ROOT

LEVELS = ("tract", "nta", "boro")


@dataclass
class AcsTable:
    table: str
    geoids: list[str]  # tract order (sorted GEOID)
    est: dict[str, np.ndarray]
    moe: dict[str, np.ndarray]
    county_est: dict[str, dict[str, float]]  # var -> county fips -> estimate
    labels: dict[str, str]
    universe: str | None


class AcsSnapshot:
    """Lazy loader of the pinned ACS snapshot (§3.2)."""

    def __init__(self) -> None:
        manifest = load_manifest()
        entry = existing_snapshot(manifest, "acs5")
        if not entry:
            raise InvariantError("missing ACS snapshot; run `uv run pipeline fetch`")
        self.entry = entry
        self.dir = REPO_ROOT / Path(entry["files"][0]["path"]).parent
        self._cache: dict[str, AcsTable] = {}

    @property
    def vintage(self) -> str:
        return self.entry["vintage"]

    def table(self, table: str) -> AcsTable:
        if table in self._cache:
            return self._cache[table]
        with open(self.dir / f"{table}_tract.csv", encoding="utf-8", newline="") as f:
            rows = sorted(csv.DictReader(f), key=lambda r: r["GEOID"])
        with open(self.dir / f"{table}_county.csv", encoding="utf-8", newline="") as f:
            crow = list(csv.DictReader(f))
        meta = json.loads((self.dir / f"{table}_variables.json").read_text(encoding="utf-8"))
        cols = [c for c in rows[0] if c != "GEOID"]
        est = {c[:-1]: parse_estimate(r[c] for r in rows) for c in cols if c.endswith("E")}
        moe = {c[:-1]: parse_moe(r[c] for r in rows) for c in cols if c.endswith("M")}
        county = {c[:-1]: {r["GEOID"][2:]: float(r[c]) for r in crow} for c in cols if c.endswith("E")}
        t = AcsTable(
            table=table,
            geoids=[r["GEOID"] for r in rows],
            est=est,
            moe=moe,
            county_est=county,
            labels={k: v["label"] for k, v in meta.items()},
            universe=next(iter(meta.values()))["universe"] if meta else None,
        )
        self._cache[table] = t
        return t

    def var(self, var: str) -> tuple[np.ndarray, np.ndarray]:
        t = self.table(var.split("_")[0])
        if var not in t.est:
            raise InvariantError(f"variable {var} not in snapshot")
        return t.est[var], t.moe[var]

    def has_var(self, var: str) -> bool:
        t = self.table(var.split("_")[0])
        return var in t.est


@dataclass
class GroupDim:
    """One group in one dimension, all levels."""

    group: str
    dim: str
    vars: list[str]
    bucket: str | None
    derived: bool
    missing_from_sum: list[str]
    city_est: float
    city_moe: float
    city_denom: float
    city_share: float
    levels: dict[str, LevelValues] = field(default_factory=dict)
    usable_share_tract: float = 0.0  # share of citywide estimate in reliable/caution tracts
    recommended_level: str = "tract"
    sparse_citywide: bool = False


@dataclass
class Denominators:
    """Per-dimension denominators at every level."""

    est: dict[str, dict[str, np.ndarray]]  # dim -> level -> estimates
    city: dict[str, float]


def unit_sums(geo: Geography, values: np.ndarray, moe: np.ndarray) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """Tract arrays -> {level: (est, moe)} using exact sums (§9.3: NTA/borough = tract sums)."""
    return {
        "tract": (values, moe),
        "nta": aggregate(values, moe, geo.tract_nta_idx, len(geo.ntas)),
        "boro": aggregate(values, moe, geo.tract_boro_idx, len(geo.boroughs)),
    }


def build_denominators(cfg: Config, acs: AcsSnapshot, geo: Geography) -> Denominators:
    est: dict[str, dict[str, np.ndarray]] = {}
    city: dict[str, float] = {}
    for dim_id, dim in cfg.dimensions.items():
        e, m = acs.var(dim.denominator)
        sums = unit_sums(geo, np.nan_to_num(e), np.nan_to_num(m))
        est[dim_id] = {lvl: sums[lvl][0] for lvl in LEVELS}
        city[dim_id] = float(np.nansum(e))
    return Denominators(est=est, city=city)


def build_group_dims(cfg: Config, acs: AcsSnapshot, geo: Geography, den: Denominators) -> dict[str, dict[str, GroupDim]]:
    rules = ReliabilityRules.from_config(cfg.analysis)
    min_usable = cfg.analysis["sparse_level"]["min_share_in_usable_tracts"]
    out: dict[str, dict[str, GroupDim]] = {}
    for gid, g in cfg.groups.items():
        out[gid] = {}
        for dim_id, mapping in g.dims.items():
            parts = [acs.var(v) for v in mapping.vars]
            ests = [p[0] for p in parts]
            moes = [p[1] for p in parts]
            e = sum_estimates(ests)
            m = combine_moe(moes, ests)
            city_est = float(np.nansum(e))
            _, city_moe = aggregate(e, m, np.zeros(len(e), dtype=int), 1)
            city_denom = den.city[dim_id]
            city_share = city_est / city_denom if city_denom else float("nan")
            gd = GroupDim(
                group=gid, dim=dim_id, vars=mapping.vars, bucket=mapping.bucket, derived=mapping.derived,
                missing_from_sum=mapping.missing_from_sum, city_est=city_est, city_moe=float(city_moe[0]),
                city_denom=city_denom, city_share=city_share,
            )
            sums = unit_sums(geo, e, m)
            for lvl in LEVELS:
                le, lm = sums[lvl]
                gd.levels[lvl] = compute_level(le, lm, den.est[dim_id][lvl], city_share, rules.for_level(lvl), city_est)
            tract = gd.levels["tract"]
            # The NTA-fallback decision uses the standard (unrelaxed) rules (analysis.yaml).
            std_state = classify(tract.est, tract.moe, tract.denom, rules)
            usable = np.isin(std_state, [RELIABLE, CAUTION])
            gd.usable_share_tract = float(np.nansum(np.where(usable, tract.est, 0)) / city_est) if city_est > 0 else 0.0
            gd.sparse_citywide = city_est < rules.min_city_count
            gd.recommended_level = "tract" if gd.usable_share_tract >= min_usable else "nta"
            out[gid][dim_id] = gd
    return out
