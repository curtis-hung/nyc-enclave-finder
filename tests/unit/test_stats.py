"""LQ, MOE handling, data states and aggregation (§13.1)."""

from __future__ import annotations

import math

import numpy as np
import pytest

from pipeline.analysis.stats import (
    CAUTION,
    RELIABLE,
    SUPPRESSED,
    UNAVAILABLE,
    ZERO,
    ReliabilityRules,
    aggregate,
    classify,
    combine_moe,
    compute_level,
    location_quotient,
    parse_estimate,
    parse_moe,
)

RULES = ReliabilityRules(z=1.645, cv_reliable_max=0.30, cv_caution_max=0.60, min_denominator=50, min_city_count=200)


def test_lq_is_local_share_over_reference_share():
    lq = location_quotient(np.array([0.08, 0.01, 0.0]), 0.01)
    assert lq.tolist() == pytest.approx([8.0, 1.0, 0.0])


def test_lq_undefined_when_reference_share_is_zero():
    assert np.isnan(location_quotient(np.array([0.1]), 0.0)).all()


def test_parse_acs_annotation_codes():
    est = parse_estimate(["10", "-666666666", "", None, "0"])
    assert est[0] == 10 and est[4] == 0
    assert np.isnan(est[1:4]).all()
    moe = parse_moe(["5", "-555555555", "-999999999", "-222222222"])
    assert moe[0] == 5 and moe[1] == 0  # controlled estimate -> no sampling error
    assert np.isnan(moe[2]) and np.isnan(moe[3])


def test_combine_moe_root_sum_of_squares():
    m = combine_moe([np.array([3.0]), np.array([4.0])])
    assert m[0] == pytest.approx(5.0)


def test_combine_moe_counts_only_largest_zero_estimate_moe():
    ests = [np.array([0.0]), np.array([0.0]), np.array([100.0])]
    moes = [np.array([20.0]), np.array([30.0]), np.array([40.0])]
    m = combine_moe(moes, ests)
    assert m[0] == pytest.approx(math.sqrt(30**2 + 40**2))


def test_combine_moe_unknown_propagates():
    m = combine_moe([np.array([np.nan]), np.array([4.0])], [np.array([5.0]), np.array([5.0])])
    assert np.isnan(m[0])


def test_classify_all_five_states():
    est = np.array([1000, 100, 30, 0, np.nan, 10, 500])
    moe = np.array([100, 80, 60, 15, 10, 5, 50])
    den = np.array([5000, 5000, 5000, 5000, 5000, 20, 0])
    st = classify(est, moe, den, RULES)
    # cv: 0.06 -> reliable; 0.49 -> caution; 1.22 -> suppressed; 0 -> zero; NaN -> unavailable;
    # tiny denominator -> suppressed; no residents in universe -> unavailable
    assert st.tolist() == [RELIABLE, CAUTION, SUPPRESSED, ZERO, UNAVAILABLE, SUPPRESSED, UNAVAILABLE]


def test_noisy_small_estimate_is_never_zero():
    st = classify(np.array([3.0]), np.array([12.0]), np.array([4000.0]), RULES)
    assert st[0] in (CAUTION, SUPPRESSED)
    assert st[0] != ZERO


def test_compute_level_hides_values_for_suppressed_and_unavailable():
    lv = compute_level(
        est=np.array([500.0, 30.0, 0.0, np.nan]),
        moe=np.array([50.0, 60.0, 12.0, np.nan]),
        denom=np.array([5000.0, 5000.0, 5000.0, 5000.0]),
        reference_share=0.01,
        rules=RULES,
        city_count=10_000,
    )
    assert lv.state.tolist() == [RELIABLE, SUPPRESSED, ZERO, UNAVAILABLE]
    assert lv.lq[0] == pytest.approx(10.0)
    assert np.isnan(lv.lq[1]) and np.isnan(lv.share[1])  # suppressed: no value, and not 0
    assert lv.lq[2] == 0.0 and lv.share[2] == 0.0  # zero is a value
    assert np.isnan(lv.lq[3])


def test_tiny_reference_population_cannot_produce_lq():
    lv = compute_level(np.array([50.0]), np.array([5.0]), np.array([100.0]), 0.0001, RULES, city_count=60)
    assert lv.state[0] == SUPPRESSED
    assert np.isnan(lv.lq[0])


def test_aggregate_exact_sums_with_moe():
    est = np.array([10.0, 20.0, 0.0, 0.0, 5.0])
    moe = np.array([3.0, 4.0, 10.0, 12.0, 1.0])
    groups = np.array([0, 0, 0, 0, 1])
    e, m = aggregate(est, moe, groups, 2)
    assert e.tolist() == [30.0, 5.0]
    assert m[0] == pytest.approx(math.sqrt(9 + 16 + 144))
    assert m[1] == pytest.approx(1.0)


def test_aggregate_excludes_units_marked_minus_one():
    e, _ = aggregate(np.array([1.0, 2.0]), np.array([0.0, 0.0]), np.array([0, -1]), 1)
    assert e.tolist() == [1.0]
