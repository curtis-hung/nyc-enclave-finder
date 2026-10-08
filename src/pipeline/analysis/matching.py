"""Deterministic one-to-one matching of DOHMH establishments to external places (§4.4).

Candidates must lie within `max_dist` (projected units) and have a normalized-name similarity of
at least `min_sim`. Pairs are accepted greedily by (similarity desc, distance asc, ids asc), so
the result does not depend on input order, and each record is used at most once.
"""

from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

import numpy as np
from scipy.spatial import cKDTree

STOPWORDS = {
    "inc", "llc", "corp", "corporation", "co", "ltd", "the", "and", "of", "nyc", "ny", "new", "york",
    "restaurant", "restaurants", "rest", "cafe", "café", "kitchen", "grill", "bar", "food", "foods", "deli", "llc.",
}


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def name_tokens(name: str | None) -> list[str]:
    if not name:
        return []
    s = strip_accents(str(name)).lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return [t for t in s.split() if t and t not in STOPWORDS and not t.isdigit()]


def normalize_name(name: str | None) -> str:
    return " ".join(name_tokens(name))


def similarity(a: str, b: str) -> float:
    """max(sequence ratio, token Jaccard) of two normalized names; 0 if either is empty."""
    if not a or not b:
        return 0.0
    ta, tb = set(a.split()), set(b.split())
    jac = len(ta & tb) / len(ta | tb)
    return max(SequenceMatcher(None, a, b).ratio(), jac)


def match(a_xy: np.ndarray, a_names: list[str], a_ids: list, b_xy: np.ndarray, b_names: list[str], b_ids: list,
          max_dist: float, min_sim: float) -> list[tuple[int, int, float, float]]:
    """Return accepted pairs (i, j, similarity, distance) between A rows and B rows."""
    if len(a_xy) == 0 or len(b_xy) == 0:
        return []
    tree = cKDTree(b_xy)
    cands = []
    for i, nbrs in enumerate(tree.query_ball_point(a_xy, r=max_dist)):
        for j in nbrs:
            s = similarity(a_names[i], b_names[j])
            if s >= min_sim:
                d = float(np.hypot(*(a_xy[i] - b_xy[j])))
                cands.append((-s, d, str(a_ids[i]), str(b_ids[j]), i, j))
    cands.sort()
    used_a, used_b, out = set(), set(), []
    for neg_s, d, _, _, i, j in cands:
        if i in used_a or j in used_b:
            continue
        used_a.add(i)
        used_b.add(j)
        out.append((i, j, -neg_s, d))
    return out
