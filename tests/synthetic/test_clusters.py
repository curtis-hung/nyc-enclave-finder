"""Planted-answer tests for commercial clusters (§7, §13.2)."""

from __future__ import annotations

import numpy as np
import pytest

from pipeline.analysis.clusters import ClusterRule, find_clusters

RULE = ClusterRule(eps_ft=300, min_samples=4, min_cluster_size=5, catchment_ft=500, lq_min=2.0)
rng = np.random.default_rng(42)


def background(n: int, size_ft: float = 40_000) -> np.ndarray:
    """A city of evenly spread restaurants of mixed cuisines."""
    return rng.uniform(0, size_ft, size=(n, 2))


def blob(n: int, cx: float, cy: float, r: float = 150) -> np.ndarray:
    a = rng.uniform(0, 2 * np.pi, n)
    d = rng.uniform(0, r, n)
    return np.c_[cx + d * np.cos(a), cy + d * np.sin(a)]


def test_concentrated_cuisine_forms_one_cluster():
    bg = background(4000)
    thai = blob(12, 20_000, 20_000)
    xy = np.vstack([bg, thai])
    member = np.r_[np.zeros(len(bg), bool), np.ones(len(thai), bool)]
    cl = find_clusters(xy, member, RULE)
    assert len(cl) == 1
    assert set(cl[0].members) == set(range(len(bg), len(xy)))
    assert cl[0].lq > 2


def test_dense_area_with_ordinary_mix_is_not_a_cuisine_cluster():
    # Restaurant-dense downtown where the cuisine is just its usual citywide share (10%).
    bg = background(3000)
    downtown = blob(1500, 10_000, 10_000, r=800)
    xy = np.vstack([bg, downtown])
    member = np.zeros(len(xy), bool)
    member[::10] = True  # 10% of every place, dense or not
    assert find_clusters(xy, member, RULE) == []


def test_lq_is_measured_against_the_whole_catchment_not_the_cluster():
    # N same-cuisine points in an otherwise ordinary dense area: the share is computed over every
    # restaurant in the catchment, so it is well below 100%.
    others = blob(200, 5_000, 5_000, r=600)
    korean = blob(15, 5_000, 5_000, r=150)
    bg = background(2000)
    xy = np.vstack([bg, others, korean])
    member = np.r_[np.zeros(len(bg) + len(others), bool), np.ones(len(korean), bool)]
    cl = find_clusters(xy, member, RULE)
    assert len(cl) == 1
    c = cl[0]
    assert c.share < 0.5
    assert len(c.catchment_idx) > len(c.members)
    assert c.share == pytest.approx(c.cuisine_in_catchment / len(c.catchment_idx))


def test_multi_tag_restaurant_counts_once_in_every_denominator():
    # The same restaurants appear in two cuisine point sets (Ecuadorian and Colombian tags); the
    # denominators are computed over restaurant rows, so they are identical for both cuisines.
    bg = background(3000)
    both = blob(10, 30_000, 30_000)
    xy = np.vstack([bg, both])
    ecu = np.r_[np.zeros(len(bg), bool), np.ones(len(both), bool)]
    col = ecu.copy()
    c1, c2 = find_clusters(xy, ecu, RULE)[0], find_clusters(xy, col, RULE)[0]
    assert len(c1.catchment_idx) == len(c2.catchment_idx)
    assert len(set(c1.catchment_idx.tolist())) == len(c1.catchment_idx)  # no restaurant twice
    assert c1.ref_share == pytest.approx(len(both) / len(xy))


def test_concentrations_do_not_chain_through_an_ordinary_dense_corridor():
    # Two concentrations joined by a dense corridor where the cuisine has its ordinary 10% share.
    # Plain DBSCAN would chain them into one large, diluted component; seeds only come from
    # neighbourhoods where the cuisine is over-represented, so they stay two clusters.
    bg = background(2000)
    corridor_x = np.linspace(10_000, 16_000, 900)
    corridor = np.c_[corridor_x, 10_000 + rng.uniform(-200, 200, 900)]
    a, b = blob(30, 9_600, 10_000, r=120), blob(30, 16_400, 10_000, r=120)
    xy = np.vstack([bg, corridor, a, b])
    member = np.zeros(len(xy), bool)
    member[: len(bg) + len(corridor) : 10] = True  # the same ordinary 10% share everywhere, corridor included
    member[len(bg) + len(corridor):] = True
    cl = find_clusters(xy, member, RULE)
    ia = set(range(len(bg) + len(corridor), len(bg) + len(corridor) + 30))
    ib = set(range(len(bg) + len(corridor) + 30, len(xy)))
    in_a = [c for c in cl if ia & set(c.members.tolist())]
    in_b = [c for c in cl if ib & set(c.members.tolist())]
    assert in_a and in_b  # both concentrations are found...
    assert not any(ia & set(c.members.tolist()) and ib & set(c.members.tolist()) for c in cl)  # ...never chained
    assert all(c.footprint.bounds[2] - c.footprint.bounds[0] < 3_000 for c in cl)  # no corridor-long cluster


def test_too_few_points_yield_no_cluster():
    bg = background(1000)
    xy = np.vstack([bg, blob(3, 1000, 1000)])
    member = np.r_[np.zeros(len(bg), bool), np.ones(3, bool)]
    assert find_clusters(xy, member, RULE) == []
