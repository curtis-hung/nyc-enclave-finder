""""Who's here?" (§9.2): over-represented groups per dimension for every tract, NTA and borough.

Candidates per dimension are the *finest* groups with an exact (non-bucket) mapping in that
dimension: a group is skipped when one of its descendants also has an exact mapping there, so a
list never shows both "Central American" and "Salvadoran". Language is the exception: almost
every language mapping is a bucket, so its own categories are ranked directly (labelled as
language categories, never as ethnic groups).

Rankings use LQ (§2.1) and keep every over-represented candidate up to a display cap (§2.2).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from pipeline.analysis.ranking import AreaValue, over_represented
from pipeline.analysis.stats import ReliabilityRules, combine_moe, compute_level, sum_estimates
from pipeline.build.demographics import LEVELS, AcsSnapshot, Denominators, GroupDim, unit_sums
from pipeline.build.geography import Geography
from pipeline.build.writer import clean, sig_arr, write_json
from pipeline.config import Config
from pipeline.paths import WEB_DATA_DIR

TOP_N = 10
TOP_SHARE_N = 6
LANGUAGE_LINES = [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36]


@dataclass
class Candidate:
    id: str  # group id, or "lang:<var>"
    label: str
    dim: str
    kind: str  # "group" | "language"
    levels: dict[str, Any]  # level -> LevelValues
    city_share: float


def candidate_groups(cfg: Config, dim: str) -> list[str]:
    def exact(gid: str) -> bool:
        m = cfg.groups[gid].dims.get(dim)
        return m is not None and not m.is_bucket

    def has_exact_descendant(gid: str) -> bool:
        return any(exact(c) or has_exact_descendant(c) for c in cfg.groups[gid].children)

    return [gid for gid in cfg.groups if exact(gid) and not has_exact_descendant(gid)]


def build_candidates(cfg: Config, acs: AcsSnapshot, geo: Geography, den: Denominators,
                     gds: dict[str, dict[str, GroupDim]]) -> dict[str, list[Candidate]]:
    rules = ReliabilityRules.from_config(cfg.analysis)
    out: dict[str, list[Candidate]] = {}
    for dim in cfg.dimensions:
        cands: list[Candidate] = []
        if dim == "language":
            table = acs.table("C16001")
            for line in LANGUAGE_LINES:
                var = f"C16001_{line:03d}"
                e, m = acs.var(var)
                ee = sum_estimates([e])
                mm = combine_moe([m], [e])
                city = float(np.nansum(ee))
                share = city / den.city[dim]
                sums = unit_sums(geo, ee, mm)
                levels = {lvl: compute_level(*sums[lvl], den.est[dim][lvl], share, rules, city) for lvl in LEVELS}
                label = table.labels[var].split("!!")[-1].rstrip(":")
                cands.append(Candidate(f"lang:{var}", label, dim, "language", levels, share))
        else:
            for gid in candidate_groups(cfg, dim):
                gd = gds[gid][dim]
                cands.append(Candidate(gid, cfg.groups[gid].name, dim, "group", gd.levels, gd.city_share))
        out[dim] = cands
    return out


def rank_unit(cands: list[Candidate], level: str, i: int) -> tuple[list[list[Any]], list[list[Any]]]:
    vals = []
    for k, c in enumerate(cands):
        lv = c.levels[level]
        vals.append(AreaValue(group=str(k), count=float(np.nan_to_num(lv.est[i])),
                              share=None if np.isnan(lv.share[i]) else float(lv.share[i]),
                              lq=None if np.isnan(lv.lq[i]) else float(lv.lq[i]), state=int(lv.state[i])))
    by_lq = over_represented(vals)[:TOP_N]
    usable = [v for v in vals if v.state in (0, 1) and v.share is not None]
    by_share = sorted(usable, key=lambda v: (-(v.share or 0), v.group))[:TOP_SHARE_N]

    def row(v: AreaValue) -> list[Any]:
        k = int(v.group)
        lv = cands[k].levels[level]
        return [k, sig_arr([v.lq], 3)[0], sig_arr([v.share], 3)[0], clean(lv.est[i], 0), clean(lv.moe[i], 0), v.state]

    return [row(v) for v in by_lq], [row(v) for v in by_share]


def write_whoshere(cfg: Config, geo: Geography, cands: dict[str, list[Candidate]]) -> dict[str, int]:
    n = {"tract": geo.n_tracts, "nta": len(geo.ntas), "boro": len(geo.boroughs)}
    stats = {}
    for level in LEVELS:
        units = []
        for i in range(n[level]):
            u: dict[str, Any] = {}
            for dim, cl in cands.items():
                lq_rows, share_rows = rank_unit(cl, level, i)
                u[dim] = {"lq": lq_rows, "share": share_rows}
            units.append(u)
        payload = {
            "columns": ["candidate", "lq", "share", "count", "moe", "state"],
            "candidates": {dim: [{"id": c.id, "label": c.label, "kind": c.kind, "city_share": sig_arr([c.city_share], 3)[0]}
                                 for c in cl] for dim, cl in cands.items()},
            "units": units,
        }
        write_json(WEB_DATA_DIR / "whoshere" / f"{level}.json", payload)
        stats[level] = sum(len(u[d]["lq"]) for u in units for d in u)
    return stats
