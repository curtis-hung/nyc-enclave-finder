"""Residential enclaves (§6): threshold + connected components over unit adjacency.

A unit (tract, or NTA for groups too sparse at tract level) qualifies when its LQ, estimated
count and data state all meet the preset's thresholds. Qualifying units that touch (rook
adjacency on unclipped geometry) form one component; components holding fewer than
`min_enclave_pop` group residents are dropped. Thresholds come only from presets.yaml.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from pipeline.analysis.stats import STATE_CODES


@dataclass(frozen=True)
class EnclaveRule:
    lq_min: float
    count_min: float
    states: tuple[int, ...]
    min_enclave_pop: float

    @classmethod
    def from_preset(cls, preset: dict[str, Any]) -> "EnclaveRule":
        e = preset["enclave"]
        return cls(
            lq_min=float(e["lq_min"]),
            count_min=float(e["count_min"]),
            states=tuple(STATE_CODES[s] for s in e["states"]),
            min_enclave_pop=float(e["min_enclave_pop"]),
        )


@dataclass
class Enclave:
    units: list[int]  # unit indices, sorted
    population: float  # sum of group estimates in the units
    peak_lq: float


def qualifying(lq: np.ndarray, est: np.ndarray, state: np.ndarray, rule: EnclaveRule) -> np.ndarray:
    ok_state = np.isin(state, rule.states)
    lq_ok = np.nan_to_num(lq, nan=-np.inf) >= rule.lq_min
    est_ok = np.nan_to_num(est, nan=-np.inf) >= rule.count_min
    return ok_state & lq_ok & est_ok


def connected_components(mask: np.ndarray, adjacency: list[list[int]]) -> list[list[int]]:
    seen = np.zeros(len(mask), dtype=bool)
    comps: list[list[int]] = []
    for start in np.flatnonzero(mask):
        if seen[start]:
            continue
        stack, comp = [int(start)], []
        seen[start] = True
        while stack:
            u = stack.pop()
            comp.append(u)
            for v in adjacency[u]:
                if mask[v] and not seen[v]:
                    seen[v] = True
                    stack.append(v)
        comps.append(sorted(comp))
    return comps


def detect_enclaves(lq: np.ndarray, est: np.ndarray, state: np.ndarray, adjacency: list[list[int]],
                    rule: EnclaveRule) -> list[Enclave]:
    mask = qualifying(lq, est, state, rule)
    out = []
    for comp in connected_components(mask, adjacency):
        pop = float(np.nansum(est[comp]))
        if pop < rule.min_enclave_pop:
            continue
        out.append(Enclave(units=comp, population=pop, peak_lq=float(np.nanmax(lq[comp]))))
    # deterministic order: largest first, then by first unit index
    out.sort(key=lambda e: (-e.population, e.units[0]))
    return out
