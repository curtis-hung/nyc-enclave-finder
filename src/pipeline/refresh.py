"""Scheduled-refresh safety gate and vintage check (SPEC §3.2, §14).

The monthly refresh workflow publishes new data on its own only when this gate says it is a
routine update. Anything unusual (a new census vintage, revised geography, a large swing in
restaurant or tag counts) is routed to a pull request for the owner to review instead.
"""

from __future__ import annotations

import json
import os
import subprocess
from typing import Any

from pipeline.paths import REPO_ROOT

POINTS = "web/public/data/restaurants/points.json"
MANIFEST = "data/manifest.json"

# Month-to-month change beyond these bounds is not routine and needs a human look.
MAX_RESTAURANT_CHANGE = 0.10  # DOHMH openings/closures move the count by ~1-3% a month
MAX_TAGGED_CHANGE = 0.25  # a collapse here usually means an enrichment source failed quietly

# Sources whose vintage must not change without review: census data and geography.
REVIEW_SOURCES = ("acs5", "pums", "nyc_tracts_clipped", "nyc_tracts_water", "nyc_ntas",
                  "nyc_boroughs", "nyc_tract_nta_equiv")


def gate_metrics(points: dict[str, Any]) -> dict[str, int]:
    return {"restaurants": int(points["n"]), "tagged": len(points.get("tags", {}))}


def _change(old: int, new: int) -> float:
    return abs(new - old) / old if old else (0.0 if new == 0 else 1.0)


def evaluate(old_points: dict[str, Any], new_points: dict[str, Any],
             old_manifest: dict[str, Any], new_manifest: dict[str, Any]) -> tuple[bool, list[str]]:
    """Return (safe_to_auto_publish, human-readable reasons)."""
    reasons: list[str] = []
    old_m, new_m = gate_metrics(old_points), gate_metrics(new_points)
    for key, limit in (("restaurants", MAX_RESTAURANT_CHANGE), ("tagged", MAX_TAGGED_CHANGE)):
        ch = _change(old_m[key], new_m[key])
        line = f"{key}: {old_m[key]:,} -> {new_m[key]:,} ({ch:+.1%} abs)"
        if ch > limit:
            reasons.append(f"REVIEW {line}, above the {limit:.0%} routine limit")
        else:
            reasons.append(f"ok {line}")
    old_s, new_s = old_manifest.get("sources", {}), new_manifest.get("sources", {})
    for sid in REVIEW_SOURCES:
        a, b = old_s.get(sid, {}).get("vintage"), new_s.get(sid, {}).get("vintage")
        if a != b:
            reasons.append(f"REVIEW {sid} vintage changed: {a} -> {b}")
    safe = not any(r.startswith("REVIEW") for r in reasons)
    return safe, reasons


def _git_json(ref: str, path: str) -> dict[str, Any]:
    out = subprocess.run(["git", "show", f"{ref}:{path}"], cwd=REPO_ROOT, capture_output=True,
                         text=True, encoding="utf-8", check=True).stdout
    return json.loads(out)


def _work_json(path: str) -> dict[str, Any]:
    return json.loads((REPO_ROOT / path).read_text(encoding="utf-8"))


def _gh_output(**kv: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            for k, v in kv.items():
                f.write(f"{k}={v}\n")


def run_gate(base_ref: str = "HEAD", summary_path: str | None = None) -> int:
    changed = subprocess.run(["git", "status", "--porcelain", "--", "web/public/data", MANIFEST],
                             cwd=REPO_ROOT, capture_output=True, text=True, check=True).stdout.strip()
    if not changed:
        print("No data changes; nothing to publish.")
        _gh_output(changed="false", safe="false")
        return 0
    safe, reasons = evaluate(_git_json(base_ref, POINTS), _work_json(POINTS),
                             _git_json(base_ref, MANIFEST), _work_json(MANIFEST))
    verdict = "routine: safe to publish automatically" if safe else "needs review"
    text = f"Refresh gate: {verdict}\n\n" + "\n".join(f"- {r}" for r in reasons) + "\n"
    print(text)
    if summary_path:
        with open(summary_path, "w", encoding="utf-8") as f:
            f.write(text)
    _gh_output(changed="true", safe="true" if safe else "false")
    return 0


def run_check_vintages() -> int:
    """Report whether the Census has published a newer ACS 5-year vintage than the pinned one."""
    from pipeline.fetch.acs import pinned_year, resolve_latest_year

    pinned = pinned_year(_work_json(MANIFEST))
    latest = resolve_latest_year()
    newer = bool(pinned and latest > pinned)
    print(f"ACS 5-year: pinned {pinned}, latest published {latest}" + (" (newer available)" if newer else ""))
    _gh_output(newer="true" if newer else "false", latest=str(latest), pinned=str(pinned))
    return 0
