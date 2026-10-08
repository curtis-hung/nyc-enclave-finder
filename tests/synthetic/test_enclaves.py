"""Planted-answer tests for enclave detection (§6, §13.2)."""

from __future__ import annotations

import numpy as np

from pipeline.analysis.enclaves import EnclaveRule, detect_enclaves
from pipeline.analysis.stats import CAUTION, RELIABLE, SUPPRESSED

RULE = EnclaveRule(lq_min=2.0, count_min=50, states=(RELIABLE, CAUTION), min_enclave_pop=200)


def grid_adjacency(w: int, h: int) -> list[list[int]]:
    adj = []
    for y in range(h):
        for x in range(w):
            n = []
            if x > 0:
                n.append(y * w + x - 1)
            if x < w - 1:
                n.append(y * w + x + 1)
            if y > 0:
                n.append((y - 1) * w + x)
            if y < h - 1:
                n.append((y + 1) * w + x)
            adj.append(sorted(n))
    return adj


def city(w=6, h=6):
    n = w * h
    return np.ones(n), np.full(n, 10.0), np.full(n, RELIABLE, dtype=np.int8), grid_adjacency(w, h)


def test_two_separate_concentrations_are_two_enclaves():
    lq, est, st, adj = city()
    for i in (0, 1, 6):  # top-left block
        lq[i], est[i] = 5, 100
    for i in (34, 35, 29):  # bottom-right block
        lq[i], est[i] = 3, 120
    enc = detect_enclaves(lq, est, st, adj, RULE)
    assert [e.units for e in enc] == [[29, 34, 35], [0, 1, 6]]
    assert enc[0].population == 360 and enc[1].peak_lq == 5


def test_density_without_overrepresentation_is_not_an_enclave():
    lq, est, st, adj = city()
    est[:] = 5000  # lots of people, LQ 1 everywhere
    assert detect_enclaves(lq, est, st, adj, RULE) == []


def test_suppressed_values_never_qualify():
    lq, est, st, adj = city()
    for i in (0, 1, 6):
        lq[i], est[i], st[i] = 8, 300, SUPPRESSED
    assert detect_enclaves(lq, est, st, adj, RULE) == []


def test_enclaves_ignore_values_noisier_than_the_preset_cv_cap():
    lq, est, st, adj = city()
    for i in (0, 1, 6):
        lq[i], est[i], st[i] = 6, 300, CAUTION
    cv = np.full(len(lq), 0.1)
    rule = EnclaveRule(lq_min=2.0, count_min=50, states=(RELIABLE, CAUTION), min_enclave_pop=200, cv_max=0.6)
    assert len(detect_enclaves(lq, est, st, adj, rule, cv)) == 1
    cv[[0, 1, 6]] = 0.7  # shown as caution on a tract map, but too noisy to qualify
    assert detect_enclaves(lq, est, st, adj, rule, cv) == []


def test_small_components_are_dropped_by_population_floor():
    lq, est, st, adj = city()
    lq[14], est[14] = 9, 150  # single unit below min_enclave_pop
    assert detect_enclaves(lq, est, st, adj, RULE) == []


def test_diagonal_contact_does_not_join_components():
    lq, est, st, adj = city()
    for i in (0, 7):  # touch only at a corner on a rook grid
        lq[i], est[i] = 4, 250
    enc = detect_enclaves(lq, est, st, adj, RULE)
    assert sorted(e.units for e in enc) == [[0], [7]]
