"""Adjacency and tract/NTA/borough joins (§4.2, §13.1)."""

from __future__ import annotations

import geopandas as gpd
import numpy as np
from shapely.geometry import box

from pipeline.analysis.stats import aggregate
from pipeline.build.geography import rook_adjacency


def _grid():
    # 2x2 grid of 1000 ft squares in EPSG:2263 plus a square touching only at a corner
    sq = [box(0, 0, 1000, 1000), box(1000, 0, 2000, 1000), box(0, 1000, 1000, 2000),
          box(1000, 1000, 2000, 2000), box(2000, 2000, 3000, 3000)]
    return gpd.GeoSeries(sq, crs="EPSG:2263").to_crs("EPSG:4326")


def test_rook_adjacency_shares_edges_not_corners():
    adj = rook_adjacency(_grid())
    assert adj[0] == [1, 2]
    assert adj[3] == [1, 2]
    assert adj[4] == []  # touches square 3 at a single point only


def test_display_clipping_does_not_change_neighbours():
    g = _grid()
    clipped = g.to_crs("EPSG:2263").buffer(-30).to_crs("EPSG:4326")  # shrunken "shoreline" display
    assert rook_adjacency(g)[0] == [1, 2]
    assert rook_adjacency(clipped)[0] == []  # why adjacency must use the unclipped geometry


def test_tract_to_nta_to_borough_sums_are_exact():
    tract_est = np.array([5.0, 7.0, 11.0, 13.0])
    moe = np.zeros(4)
    tract_nta = np.array([0, 0, 1, 2])
    nta_boro = np.array([0, 0, 1])
    nta, _ = aggregate(tract_est, moe, tract_nta, 3)
    boro_from_nta, _ = aggregate(nta, np.zeros(3), nta_boro, 2)
    boro_from_tract, _ = aggregate(tract_est, moe, nta_boro[tract_nta], 2)
    assert nta.tolist() == [12.0, 11.0, 13.0]
    assert boro_from_nta.tolist() == boro_from_tract.tolist() == [23.0, 13.0]
