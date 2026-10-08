"""Core statistics: ACS codes, MOE aggregation, data states (§2.7) and location quotients (§2.1).

Everything is vectorised over numpy arrays: one element per geographic unit.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

import numpy as np

# Data states (§2.7). Small integers so they serialise compactly; the frontend shares this table.
RELIABLE, CAUTION, SUPPRESSED, UNAVAILABLE, ZERO = 0, 1, 2, 3, 4
STATE_NAMES = {RELIABLE: "reliable", CAUTION: "caution", SUPPRESSED: "suppressed", UNAVAILABLE: "unavailable", ZERO: "zero"}
STATE_CODES = {v: k for k, v in STATE_NAMES.items()}


@dataclass(frozen=True)
class ReliabilityRules:
    z: float = 1.645
    cv_reliable_max: float = 0.30
    cv_caution_max: float = 0.60
    min_denominator: float = 50
    min_city_count: float = 200
    cv_caution_max_tract: float | None = None  # tract-level display relaxation (analysis.yaml)

    def for_level(self, level: str) -> "ReliabilityRules":
        """Rules used to classify values at `level` (tracts may use a relaxed caution band)."""
        if level == "tract" and self.cv_caution_max_tract is not None:
            from dataclasses import replace

            return replace(self, cv_caution_max=self.cv_caution_max_tract, cv_caution_max_tract=None)
        return self

    @classmethod
    def from_config(cls, analysis: dict[str, Any]) -> "ReliabilityRules":
        r = analysis["reliability"]
        return cls(
            z=r["z"],
            cv_reliable_max=r["cv_reliable_max"],
            cv_caution_max=r["cv_caution_max"],
            min_denominator=r["min_denominator"],
            min_city_count=r["min_city_count"],
            cv_caution_max_tract=r.get("cv_caution_max_tract"),
        )


MOE_ZERO_CODES = {-555555555}
MOE_UNKNOWN_CODES = {-222222222, -333333333, -888888888, -999999999}
EST_UNAVAILABLE_CODES = {-666666666, -999999999, -888888888, -222222222, -333333333}


def parse_estimate(values: Iterable[Any]) -> np.ndarray:
    """ACS estimate strings -> float array; annotation codes and blanks become NaN."""
    out = np.array([_num(v) for v in values], dtype=float)
    out[np.isin(out, list(EST_UNAVAILABLE_CODES))] = np.nan
    out[out < 0] = np.nan
    return out


def parse_moe(values: Iterable[Any]) -> np.ndarray:
    """ACS MOE strings -> float array; 'controlled' codes become 0, uncomputable ones NaN."""
    out = np.array([_num(v) for v in values], dtype=float)
    out[np.isin(out, list(MOE_ZERO_CODES))] = 0.0
    out[np.isin(out, list(MOE_UNKNOWN_CODES))] = np.nan
    out[out < 0] = np.nan
    return out


def _num(v: Any) -> float:
    if v is None:
        return np.nan
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if s in ("", "null", "None", "NaN", "nan"):
        return np.nan
    return float(s)


def sum_estimates(ests: list[np.ndarray]) -> np.ndarray:
    """Sum categories within one dimension. NaN in any part -> NaN (never silently drop)."""
    return np.sum(np.vstack(ests), axis=0)


def combine_moe(moes: list[np.ndarray], ests: list[np.ndarray] | None = None) -> np.ndarray:
    """Standard ACS approximation for a sum: sqrt(sum of squared MOEs).

    Census guidance for sums that include several zero estimates: only the largest MOE among the
    zero estimates is included, otherwise the MOE balloons. Applied when `ests` is given.
    """
    m = np.vstack(moes)
    if ests is None:
        return np.sqrt(np.sum(m**2, axis=0))
    e = np.vstack(ests)
    zero = e == 0
    nonzero_sq = np.where(~zero, m**2, 0.0).sum(axis=0)
    zero_max = np.where(zero, m, 0.0).max(axis=0)
    out = np.sqrt(nonzero_sq + zero_max**2)
    # an unknown MOE on a contributing estimate makes the combined MOE unknown
    unknown = np.isnan(m).any(axis=0)
    out[unknown] = np.nan
    return out


def aggregate(est: np.ndarray, moe: np.ndarray, groups: np.ndarray, n_groups: int) -> tuple[np.ndarray, np.ndarray]:
    """Exact sums of unit estimates into larger units (tract -> NTA/borough), with MOE.

    `groups[i]` is the target index of unit i (or -1 to exclude). Zero estimates contribute only
    their single largest MOE per target, per Census guidance.
    """
    e_out = np.zeros(n_groups)
    nz_sq = np.zeros(n_groups)
    z_max = np.zeros(n_groups)
    unknown = np.zeros(n_groups, dtype=bool)
    nan_est = np.zeros(n_groups, dtype=bool)
    for i in range(len(est)):
        g = groups[i]
        if g < 0:
            continue
        if np.isnan(est[i]):
            nan_est[g] = True
            continue
        e_out[g] += est[i]
        if np.isnan(moe[i]):
            unknown[g] = True
        elif est[i] == 0:
            z_max[g] = max(z_max[g], moe[i])
        else:
            nz_sq[g] += moe[i] ** 2
    m_out = np.sqrt(nz_sq + z_max**2)
    m_out[unknown] = np.nan
    return e_out, m_out


def coefficient_of_variation(est: np.ndarray, moe: np.ndarray, z: float = 1.645) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        return (moe / z) / est


def classify(est: np.ndarray, moe: np.ndarray, denom: np.ndarray, rules: ReliabilityRules) -> np.ndarray:
    """Assign every value a data state (§2.7).

    Order matters:
      unavailable  estimate missing, or nobody in the universe (denominator 0 or missing)
      zero         estimate is exactly 0 (a true or estimated zero, never 'missing')
      suppressed   denominator below the minimum-data rule, or CV above the caution limit
      caution      CV above the reliable limit, or MOE unknown
      reliable     otherwise
    """
    st = np.full(est.shape, RELIABLE, dtype=np.int8)
    cv = coefficient_of_variation(est, moe, rules.z)
    unavailable = np.isnan(est) | np.isnan(denom) | (denom <= 0)
    zero = ~unavailable & (est == 0)
    rest = ~unavailable & ~zero
    small_denom = rest & (denom < rules.min_denominator)
    moe_unknown = rest & np.isnan(moe)
    st[rest & ~moe_unknown & (cv > rules.cv_reliable_max)] = CAUTION
    st[moe_unknown] = CAUTION
    st[rest & ~moe_unknown & (cv > rules.cv_caution_max)] = SUPPRESSED
    st[small_denom] = SUPPRESSED
    st[zero] = ZERO
    st[unavailable] = UNAVAILABLE
    return st


def location_quotient(local_share: np.ndarray, reference_share: float) -> np.ndarray:
    """LQ = local group share / reference group share (§2.1). NaN if the reference is 0."""
    if not reference_share or np.isnan(reference_share):
        return np.full(local_share.shape, np.nan)
    return local_share / reference_share


@dataclass
class LevelValues:
    """Values of one group in one dimension at one geographic level."""

    est: np.ndarray
    moe: np.ndarray
    denom: np.ndarray
    share: np.ndarray  # fraction; NaN where not shown
    lq: np.ndarray  # NaN where not shown
    state: np.ndarray
    cv: np.ndarray | None = None  # coefficient of variation of the estimate (NaN where undefined)


def compute_level(
    est: np.ndarray,
    moe: np.ndarray,
    denom: np.ndarray,
    reference_share: float,
    rules: ReliabilityRules,
    city_count: float,
) -> LevelValues:
    """Shares, LQs and states for one level. Shares/LQs are blanked where the state hides them."""
    state = classify(est, moe, denom, rules)
    if city_count < rules.min_city_count:
        # tiny reference population: no LQ can be trusted anywhere (§2.7 minimum-data rule)
        state = np.where(np.isin(state, [RELIABLE, CAUTION]), SUPPRESSED, state).astype(np.int8)
    with np.errstate(divide="ignore", invalid="ignore"):
        share = est / denom
    lq = location_quotient(share, reference_share)
    hidden = np.isin(state, [SUPPRESSED, UNAVAILABLE])
    share = np.where(hidden, np.nan, share)
    lq = np.where(hidden, np.nan, lq)
    zero = state == ZERO
    share = np.where(zero, 0.0, share)
    lq = np.where(zero, 0.0, lq)
    cv = coefficient_of_variation(est, moe, rules.z)
    return LevelValues(est=est, moe=moe, denom=denom, share=share, lq=lq, state=state, cv=cv)
