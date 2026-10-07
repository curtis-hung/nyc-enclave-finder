"""Shared fetch helpers: HTTP with retries, hashing, and the provenance manifest (§3.1)."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import time
from pathlib import Path
from typing import Any

import requests

from pipeline.paths import MANIFEST_PATH, RAW_DIR, REPO_ROOT

USER_AGENT = "nyc-enclave-finder/0.1 (build-time data snapshot; non-commercial)"

_session: requests.Session | None = None


def session() -> requests.Session:
    global _session
    if _session is None:
        _session = requests.Session()
        _session.headers["User-Agent"] = USER_AGENT
    return _session


def http_get(url: str, *, params: dict | None = None, retries: int = 4, timeout: float = 300, **kw) -> requests.Response:
    """GET with exponential backoff. Raises on final failure."""
    last: Exception | None = None
    for attempt in range(retries):
        try:
            r = session().get(url, params=params, timeout=timeout, **kw)
            if r.status_code in (429, 500, 502, 503, 504):
                raise requests.HTTPError(f"HTTP {r.status_code}", response=r)
            r.raise_for_status()
            return r
        except requests.RequestException as e:  # noqa: PERF203
            last = e
            wait = 2 ** attempt * 3
            print(f"    retry {attempt + 1}/{retries} after error: {_redact(str(e))} (waiting {wait}s)")
            time.sleep(wait)
    raise RuntimeError(f"GET failed after {retries} attempts: {_redact(url)}: {_redact(str(last))}")


def http_post(url: str, *, data: dict, retries: int = 4, timeout: float = 600) -> requests.Response:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            r = session().post(url, data=data, timeout=timeout)
            if r.status_code in (429, 500, 502, 503, 504):
                raise requests.HTTPError(f"HTTP {r.status_code}", response=r)
            r.raise_for_status()
            return r
        except requests.RequestException as e:  # noqa: PERF203
            last = e
            wait = 2 ** attempt * 10
            print(f"    retry {attempt + 1}/{retries} after error: {e} (waiting {wait}s)")
            time.sleep(wait)
    raise RuntimeError(f"POST failed after {retries} attempts: {url}: {last}")


def download(url: str, dest: Path, *, params: dict | None = None, chunk: int = 1 << 20) -> Path:
    """Stream a URL to disk atomically (writes to .part then renames)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    r = http_get(url, params=params, stream=True)
    with open(tmp, "wb") as f:
        for block in r.iter_content(chunk):
            f.write(block)
    tmp.replace(dest)
    return dest


def _redact(s: str) -> str:
    """Never let an API key reach logs or the manifest."""
    import os
    import re

    key = os.environ.get("CENSUS_API_KEY")
    if key:
        s = s.replace(key, "REDACTED")
    return re.sub(r"key=[^&\s]+", "key=REDACTED", s)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def today() -> str:
    return dt.date.today().isoformat()


def snapshot_dir(source_id: str, version: str) -> Path:
    return RAW_DIR / source_id / version


# --- manifest -----------------------------------------------------------------------------------


def load_manifest() -> dict[str, Any]:
    if MANIFEST_PATH.exists():
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    return {"sources": {}}


def save_manifest(manifest: dict[str, Any]) -> None:
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    manifest["sources"] = dict(sorted(manifest["sources"].items()))
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def file_record(path: Path, rows: int | None) -> dict[str, Any]:
    return {
        "path": path.relative_to(REPO_ROOT).as_posix(),
        "rows": rows,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def existing_snapshot(manifest: dict[str, Any], source_id: str) -> dict[str, Any] | None:
    """Return the manifest entry if every recorded file is still on disk."""
    entry = manifest["sources"].get(source_id)
    if not entry:
        return None
    for f in entry.get("files", []):
        if not (REPO_ROOT / f["path"]).exists():
            return None
    return entry


def snapshot_path(entry: dict[str, Any], name: str) -> Path:
    """Resolve one file of a manifest entry by its basename."""
    for f in entry["files"]:
        if Path(f["path"]).name == name:
            return REPO_ROOT / f["path"]
    raise KeyError(f"{name} not in snapshot {entry.get('source_id')}")
