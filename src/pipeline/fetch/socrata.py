"""NYC Open Data (Socrata) snapshots: geography layers (§4.2) and DOHMH inspections (§4.3)."""

from __future__ import annotations

import csv
import datetime as dt
import json
from typing import Any

from pipeline.fetch.common import download, file_record, http_get, now_iso, snapshot_dir

DOMAIN = "https://data.cityofnewyork.us"

GEO_DATASETS = {
    # source_id: (socrata id, description)
    "nyc_tracts_clipped": ("63ge-mke6", "2020 Census Tracts, shoreline-clipped (display geometry)"),
    "nyc_tracts_water": ("imfq-nf3j", "2020 Census Tracts, water areas included (adjacency geometry)"),
    "nyc_ntas": ("9nt8-h7nd", "2020 Neighborhood Tabulation Areas (NTAs), shoreline-clipped"),
    "nyc_boroughs": ("gthc-hcne", "Borough Boundaries, shoreline-clipped"),
    "nyc_tract_nta_equiv": ("hm78-6dwm", "2020 Census Tracts to 2020 NTAs and CDTAs Equivalency"),
}
DOHMH_ID = "43nn-pn8j"


def _view_meta(dataset_id: str) -> dict[str, Any]:
    v = http_get(f"{DOMAIN}/api/views/{dataset_id}.json").json()
    updated = v.get("rowsUpdatedAt") or v.get("viewLastModified")
    return {
        "name": v.get("name"),
        "attribution": v.get("attribution"),
        "license": (v.get("license") or {}).get("name"),
        "rows_updated_at": dt.datetime.fromtimestamp(updated, dt.timezone.utc).isoformat() if updated else None,
    }


def fetch_geo(source_id: str) -> dict[str, Any]:
    dataset_id, desc = GEO_DATASETS[source_id]
    meta = _view_meta(dataset_id)
    version = (meta["rows_updated_at"] or now_iso())[:10]
    out_dir = snapshot_dir(source_id, version)
    is_table = source_id == "nyc_tract_nta_equiv"
    if is_table:
        url = f"{DOMAIN}/resource/{dataset_id}.json"
        path = download(url, out_dir / f"{dataset_id}.json", params={"$limit": 100000})
        rows = len(json.loads(path.read_text(encoding="utf-8")))
    else:
        url = f"{DOMAIN}/resource/{dataset_id}.geojson"
        path = download(url, out_dir / f"{dataset_id}.geojson", params={"$limit": 100000})
        rows = len(json.loads(path.read_text(encoding="utf-8"))["features"])
    print(f"    {source_id} ({dataset_id}): {rows} records, updated {version}")
    return {
        "source_id": source_id,
        "name": meta["name"],
        "description": desc,
        "publisher": "NYC Department of City Planning via NYC Open Data",
        "source_url": f"{DOMAIN}/d/{dataset_id}",
        "socrata_id": dataset_id,
        "vintage": version,
        "rows_updated_at": meta["rows_updated_at"],
        "license": meta["license"],
        "fetched_at": now_iso(),
        "files": [file_record(path, rows)],
    }


def fetch_dohmh() -> dict[str, Any]:
    meta = _view_meta(DOHMH_ID)
    version = dt.date.today().isoformat()
    out_dir = snapshot_dir("dohmh", version)
    url = f"{DOMAIN}/api/views/{DOHMH_ID}/rows.csv"
    path = download(url, out_dir / "dohmh_inspections.csv", params={"accessType": "DOWNLOAD"})
    with open(path, encoding="utf-8", newline="") as f:
        rows = sum(1 for _ in csv.reader(f)) - 1
    print(f"    dohmh ({DOHMH_ID}): {rows} rows, source updated {meta['rows_updated_at']}")
    return {
        "source_id": "dohmh",
        "name": meta["name"],
        "publisher": "NYC Department of Health and Mental Hygiene via NYC Open Data",
        "source_url": f"{DOMAIN}/d/{DOHMH_ID}",
        "socrata_id": DOHMH_ID,
        "vintage": version,
        "rows_updated_at": meta["rows_updated_at"],
        "license": meta["license"],
        "fetched_at": now_iso(),
        "files": [file_record(path, rows)],
    }
