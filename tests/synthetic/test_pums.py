"""Planted-answer tests for PUMS diaspora detail (§4.6, §13.2)."""

from __future__ import annotations

import numpy as np
import pytest

from pipeline.analysis.pums_stats import (
    SDR_FACTOR,
    born_abroad,
    born_pr_territory,
    born_us50,
    cell,
    ratio,
    se_total,
)


def weights(rows: list[tuple[float, float]]) -> np.ndarray:
    """rows of (full weight, replicate weight used for all 80 replicates)."""
    return np.array([[w] + [r] * 80 for w, r in rows], dtype=float)


def test_replicate_moe_matches_hand_computation():
    # one person, PWGTP 100, replicates alternate 90 / 110
    w = np.array([[100] + [90, 110] * 40], dtype=float)
    c = cell(np.array([True]), w)
    # Var = 4/80 * 80 * 10^2 = 400 -> SE 20 -> MOE 1.645 * 20 = 32.9
    assert se_total(c) == pytest.approx(20.0)
    assert SDR_FACTOR * 80 * 100 == pytest.approx(400)


def test_puerto_rico_born_is_its_own_category_not_us50():
    pobp = np.array([36, 72, 66, 207, 11])  # New York, Puerto Rico, Guam, China, DC
    assert born_us50(pobp).tolist() == [True, False, False, False, True]
    assert born_pr_territory(pobp).tolist() == [False, True, True, False, False]
    assert born_abroad(pobp).tolist() == [False, False, False, True, False]


def test_thin_cells_are_hidden_never_zero():
    w = weights([(100.0, 100.0)] * 10)
    num = cell(np.array([True] * 3 + [False] * 7), w)
    den = cell(np.array([True] * 10), w)
    r = ratio(num, den, cv_max=0.3, min_n=30)
    assert r.shown is False and r.value is None  # hidden, not 0.3 and not 0
    zero = ratio(cell(np.zeros(10, bool), w), den, cv_max=0.3, min_n=1)
    assert zero.value is None  # a zero numerator is hidden too, never rendered as 0


def test_reliable_cells_are_shown():
    rng = np.random.default_rng(1)
    rows = [(100.0, 100.0 + rng.normal(0, 3)) for _ in range(400)]
    w = np.array([[a] + list(a + rng.normal(0, 3, 80)) for a, _ in rows])
    num = cell(np.arange(400) < 200, w)
    den = cell(np.ones(400, bool), w)
    r = ratio(num, den, cv_max=0.3, min_n=30)
    assert r.shown and r.value == pytest.approx(0.5, abs=0.02)


def test_two_pumas_are_combined_from_microdata_not_by_averaging_percentages():
    # PUMA A: 10 of 100 people; PUMA B: 900 of 1000 -> combined 910/1100, not (10% + 90%) / 2
    wa = weights([(1.0, 1.0)] * 100)
    wb = weights([(1.0, 1.0)] * 1000)
    num = cell(np.arange(100) < 10, wa) + cell(np.arange(1000) < 900, wb)
    den = cell(np.ones(100, bool), wa) + cell(np.ones(1000, bool), wb)
    r = ratio(num, den, cv_max=1.0, min_n=1)
    assert r.value == pytest.approx(910 / 1100)
    assert r.value != pytest.approx(0.5)


def test_per_puma_cells_match_direct_computation():
    from types import SimpleNamespace

    from pipeline.build.pums_build import Definition, add_cells, group_cells, group_cells_by_puma

    rng = np.random.default_rng(3)
    n = 500
    col = {
        "AGEP": rng.integers(0, 90, n), "POBP": rng.choice([36, 72, 207, 217], n), "YOEP": rng.integers(1980, 2024, n),
        "LANX": rng.choice([1, 2], n), "LANP": rng.choice([2575, 1200], n), "ENG": rng.choice([1, 2, 3], n),
        "RAC1P": np.ones(n, int), "RAC2P19": np.ones(n, int), "RAC2P24": np.ones(n, int), "HISP": np.ones(n, int),
        "ANC1P": np.ones(n, int), "ANC2P": np.ones(n, int),
    }
    p = SimpleNamespace(col=col, year=rng.integers(2020, 2025, n), w=rng.uniform(10, 50, (n, 81)),
                        puma=rng.choice(["04101", "04102"], n))
    d = Definition("korean", "asian", "", rng.random(n) < 0.6, ["birthplace"], [2575])
    by = group_cells_by_puma(p, d, ["04101", "04102"])
    direct = group_cells(p, d, np.ones(n, bool))
    combined = add_cells(list(by.values()))
    for k in direct:
        assert np.allclose(direct[k], combined[k]), k
