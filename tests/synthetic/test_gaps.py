"""Planted-answer tests for gap measures (§8, §13.2). Geometry in feet (EPSG:2263-like)."""

from __future__ import annotations

import numpy as np
import pytest
import shapely
from shapely.geometry import Point, box

from pipeline.analysis.gaps import (
    FT_PER_MI,
    area_weights,
    enclave_distances,
    weighted_group_value,
    within_distance_shares,
)

MI = FT_PER_MI


def test_cluster_overlapping_an_enclave_has_distance_zero_and_positive_overlap():
    cluster = box(0, 0, 1000, 1000)
    enclave = box(500, 500, 3000, 3000)
    g = enclave_distances(cluster, [enclave])
    assert g.distances_mi[0] == 0
    assert g.intersection_sqmi > 0
    assert g.pct_cluster_in_enclaves == pytest.approx(0.25)
    assert g.pct_nearest_enclave_in_cluster == pytest.approx(500 * 500 / 2500**2)


def test_cluster_five_miles_from_an_enclave():
    cluster = box(0, 0, 500, 500)
    enclave = box(500 + 5 * MI, 0, 1000 + 5 * MI, 500)
    g = enclave_distances(cluster, [enclave])
    assert g.distances_mi[0] == pytest.approx(5.0, abs=1e-6)
    assert g.intersection_sqmi == 0 and g.pct_cluster_in_enclaves == 0


def test_group_with_two_enclaves_selects_the_nearer():
    cluster = box(0, 0, 500, 500)
    far = box(10 * MI, 0, 10 * MI + 500, 500)
    near = box(2 * MI, 0, 2 * MI + 500, 500)
    g = enclave_distances(cluster, [far, near])
    assert g.nearest == [1, 0]
    assert g.distances_mi[0] < g.distances_mi[1]
    assert g.distances_mi[2] is None  # only two enclaves


def test_group_with_no_enclave_has_null_distance():
    g = enclave_distances(box(0, 0, 10, 10), [])
    assert g.distances_mi == [None, None, None]
    assert g.pct_cluster_in_enclaves is None


def test_area_weights_and_weighted_values():
    tracts = [box(0, 0, 100, 100), box(100, 0, 200, 100)]
    tree = shapely.STRtree(tracts)
    areas = np.array([t.area for t in tracts])
    w = area_weights(box(50, 0, 150, 100), tracts, tree, areas)
    assert w == {0: pytest.approx(0.5), 1: pytest.approx(0.5)}
    e, m, d = weighted_group_value(w, np.array([100.0, 0.0]), np.array([10.0, 20.0]), np.array([1000.0, 1000.0]))
    assert e == pytest.approx(50) and d == pytest.approx(1000)
    assert m == pytest.approx(np.sqrt(5**2 + 10**2))


def test_within_distance_shares_are_cumulative():
    pts = shapely.points([(0.3 * MI, 0), (1.5 * MI, 0), (4 * MI, 0), (9 * MI, 0)])
    shares = within_distance_shares(Point(0, 0).buffer(1), pts, np.array([10.0, 20.0, 30.0, 40.0]), 100.0)
    assert shares == pytest.approx([0.1, 0.1, 0.3, 0.6])
    assert all(a <= b for a, b in zip(shares, shares[1:]))
