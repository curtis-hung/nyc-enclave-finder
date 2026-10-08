"""PUMS estimation (§4.6): weighted sums, successive-difference-replication standard errors, and
the "hide when too thin" gate.

A *cell* is a vector [n, est, d_1 .. d_80]: the unweighted count, the full-sample weighted sum
(PWGTP) and the 80 replicate deltas (replicate sum − est). Cells add linearly, so combining PUMAs
means summing their cells — computed from the microdata, never by averaging percentages.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

N_REP = 80
SDR_FACTOR = 4.0 / N_REP  # ACS successive difference replication: Var = 4/80 Σ (X_r − X)²
Z90 = 1.645


def cell(mask: np.ndarray, weights: np.ndarray) -> np.ndarray:
    """weights: (rows, 81) = [PWGTP, PWGTP1..80]. Returns [n, est, d_1..d_80]."""
    w = weights[mask]
    sums = w.sum(axis=0).astype(float)
    return np.concatenate([[mask.sum()], [sums[0]], sums[1:] - sums[0]])


def se_total(c: np.ndarray) -> float:
    return float(np.sqrt(SDR_FACTOR * np.sum(c[2:] ** 2)))


@dataclass(frozen=True)
class Ratio:
    value: float | None
    se: float | None
    n_num: int
    n_den: int
    shown: bool


def ratio(num: np.ndarray, den: np.ndarray, cv_max: float, min_n: int) -> Ratio:
    """num/den with a replicate SE; `shown` only when both sides have >= min_n sampled people and
    CV <= cv_max. A hidden value is reported as None — never 0."""
    n_num, n_den = int(num[0]), int(den[0])
    if den[1] <= 0:
        return Ratio(None, None, n_num, n_den, False)
    p = num[1] / den[1]
    rep_den = den[1] + den[2:]
    with np.errstate(divide="ignore", invalid="ignore"):
        rep_p = np.where(rep_den > 0, (num[1] + num[2:]) / rep_den, p)
    se = float(np.sqrt(SDR_FACTOR * np.sum((rep_p - p) ** 2)))
    ok = n_num >= min_n and n_den >= min_n and p > 0 and se / p <= cv_max
    return Ratio(float(p) if ok else None, se if ok else None, n_num, n_den, ok)


# --- birthplace categories (POBP) -----------------------------------------------------------------

def born_us50(pobp: np.ndarray) -> np.ndarray:
    """Born in the 50 states or DC (POBP 1-56)."""
    return (pobp >= 1) & (pobp <= 56)


def born_pr_territory(pobp: np.ndarray) -> np.ndarray:
    """Born in Puerto Rico or a U.S. territory (POBP 60-99). Island-born people are U.S.-born in
    Census data, so they get their own category (§4.6)."""
    return (pobp >= 60) & (pobp <= 99)


def born_abroad(pobp: np.ndarray) -> np.ndarray:
    return pobp >= 100
