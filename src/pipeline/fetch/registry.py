"""Source registry and the idempotent fetch driver (§3.1)."""

from __future__ import annotations

from typing import Any, Callable

from pipeline.fetch import acs, osm_overture, socrata
from pipeline.fetch.common import existing_snapshot, load_manifest, save_manifest

# Order matters only for log readability. MUST sources first, SHOULD enrichment last.
SOURCES: dict[str, Callable[[dict[str, Any], bool], dict[str, Any]]] = {
    "acs5": lambda m, r: acs.fetch(m, r),
    **{sid: (lambda m, r, sid=sid: socrata.fetch_geo(sid)) for sid in socrata.GEO_DATASETS},
    "dohmh": lambda m, r: socrata.fetch_dohmh(),
    "osm": lambda m, r: osm_overture.fetch_osm(),
    "overture": lambda m, r: osm_overture.fetch_overture(),
}

OPTIONAL = {"osm", "overture"}  # enrichment (SHOULD): failure is logged, not fatal


def run_fetch(refresh: bool = False, only: list[str] | None = None) -> int:
    manifest = load_manifest()
    failures = []
    for sid, fn in SOURCES.items():
        if only and sid not in only:
            continue
        if not refresh and existing_snapshot(manifest, sid):
            print(f"[skip] {sid}: snapshot {manifest['sources'][sid]['vintage']} already present (use --refresh)")
            continue
        print(f"[fetch] {sid}")
        try:
            manifest["sources"][sid] = fn(manifest, refresh)
            save_manifest(manifest)  # persist after every source so partial runs keep provenance
        except Exception as e:  # noqa: BLE001
            print(f"[error] {sid}: {e}")
            failures.append(sid)
    save_manifest(manifest)
    hard = [f for f in failures if f not in OPTIONAL]
    if failures:
        print(f"Fetch finished with failures: {failures}")
    return 1 if hard else 0
