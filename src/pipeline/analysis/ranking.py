"""Ranking over-represented groups in an area (§2.1, §2.2, §9.2).

Ranking is for display only: every group meeting the criteria is returned, never just a winner.
"""

from __future__ import annotations

from dataclasses import dataclass

from pipeline.analysis.stats import CAUTION, RELIABLE


@dataclass(frozen=True)
class AreaValue:
    group: str
    count: float
    share: float | None
    lq: float | None
    state: int


def over_represented(values: list[AreaValue], min_lq: float = 1.0, min_count: float = 0.0) -> list[AreaValue]:
    """All groups with a usable value and LQ above `min_lq`, ordered by LQ (desc), then group id.

    A group's local plurality never matters here: an 8% group in an area where it is 1% citywide
    outranks a 40% group that is 35% citywide.
    """
    keep = [
        v for v in values
        if v.state in (RELIABLE, CAUTION) and v.lq is not None and v.lq > min_lq and v.count >= min_count
    ]
    return sorted(keep, key=lambda v: (-v.lq, v.group))
