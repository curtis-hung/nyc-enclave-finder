"""Planted-answer tests for over-representation ranking (§13.2)."""

from __future__ import annotations

from pipeline.analysis.ranking import AreaValue, over_represented
from pipeline.analysis.stats import CAUTION, RELIABLE, SUPPRESSED, ZERO


def test_eight_percent_group_outranks_the_plurality():
    # Area: group A is 8% here vs 1% citywide (LQ 8); group B is 40% here vs 35% citywide.
    vals = [
        AreaValue("b_plurality", count=4000, share=0.40, lq=0.40 / 0.35, state=RELIABLE),
        AreaValue("a_small", count=800, share=0.08, lq=0.08 / 0.01, state=RELIABLE),
    ]
    ranked = over_represented(vals)
    assert ranked[0].group == "a_small"


def test_two_over_represented_groups_both_appear():
    vals = [
        AreaValue("x", count=500, share=0.05, lq=5.0, state=RELIABLE),
        AreaValue("y", count=300, share=0.03, lq=3.0, state=CAUTION),
        AreaValue("z", count=9000, share=0.5, lq=0.9, state=RELIABLE),
    ]
    assert [v.group for v in over_represented(vals)] == ["x", "y"]


def test_suppressed_or_zero_values_are_not_ranked():
    vals = [
        AreaValue("noisy", count=20, share=None, lq=None, state=SUPPRESSED),
        AreaValue("none", count=0, share=0.0, lq=0.0, state=ZERO),
    ]
    assert over_represented(vals) == []
