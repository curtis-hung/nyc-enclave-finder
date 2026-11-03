"""ACS 5-year detailed tables for NYC tracts and boroughs (§4.1).

Primary path: the Census Data API (needs CENSUS_API_KEY, which the API now requires).
Fallback when no key is set: the ACS table-based Summary File, streamed and filtered to NYC.
Both paths write the same normalized CSV: one row per geography, columns GEOID + <var>E/<var>M.
"""

from __future__ import annotations

import csv
import json
import os
from pathlib import Path
from typing import Any

from pipeline.fetch.common import (
    file_record,
    http_get,
    now_iso,
    session,
    snapshot_dir,
)

SOURCE_ID = "acs5"
API = "https://api.census.gov/data/{year}/acs/acs5"
SUMMARY_FILE = (
    "https://www2.census.gov/programs-surveys/acs/summary_file/{year}/table-based-SF/data/5YRData/"
    "acsdt5y{year}-{table}.dat"
)

STATE = "36"
# Bronx, Kings (Brooklyn), New York (Manhattan), Queens, Richmond (Staten Island)
NYC_COUNTIES = ["005", "047", "061", "081", "085"]

# Candidate tables (§4.1). Availability at tract level is verified at fetch time; a table whose
# tract estimates come back entirely null is recorded as unavailable rather than silently used.
TABLES = {
    "B01003": "Total population",
    "B03002": "Hispanic or Latino origin by race",
    "B03001": "Detailed Hispanic or Latino origin",
    "B02015": "Asian alone by selected groups",
    "B04006": "People reporting ancestry",
    "B05006": "Place of birth for the foreign-born population",
    "C16001": "Language spoken at home (collapsed) for the population 5 years and over",
    "B16001": "Language spoken at home (detailed) for the population 5 years and over",
}


def resolve_latest_year(start: int | None = None) -> int:
    """Latest ACS 5-year vintage published on the API, probing downward from the current year."""
    import datetime as dt

    year = start or dt.date.today().year
    for y in range(year, year - 6, -1):
        r = session().get(API.format(year=y) + ".json", timeout=60)
        if r.status_code == 200:
            return y
    raise RuntimeError("Could not resolve an ACS 5-year vintage from the Census API")


def _variables(year: int, table: str) -> dict[str, Any]:
    """Variable metadata for a table (label, concept, universe). This endpoint needs no key."""
    r = http_get(API.format(year=year) + f"/groups/{table}.json")
    return r.json()["variables"]


def _estimate_vars(meta: dict[str, Any], table: str) -> list[str]:
    """Estimate variable ids in table order (e.g. B03001_001 ... ), without the E/M suffix."""
    ids = sorted({k[:-1] for k in meta if k.startswith(table + "_") and k.endswith("E") and "_" in k})
    return [i for i in ids if i.split("_")[1].isdigit()]


def _fetch_api(year: int, table: str, geo: str, key: str) -> list[dict[str, str]]:
    params = {"get": f"group({table})", "key": key, "for": geo, "in": f"state:{STATE}"}
    if geo.startswith("tract"):
        params["in"] = f"state:{STATE} county:{','.join(NYC_COUNTIES)}"
    else:
        params["for"] = f"county:{','.join(NYC_COUNTIES)}"
    r = http_get(API.format(year=year), params=params)
    rows = r.json()
    header = rows[0]
    out = []
    for row in rows[1:]:
        rec = dict(zip(header, row))
        out.append(rec)
    return out


def _fetch_summary_file(year: int, table: str) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    """Stream the national table-based summary file and keep NYC tracts and counties."""
    url = SUMMARY_FILE.format(year=year, table=table.lower())
    tract_prefixes = tuple(f"1400000US{STATE}{c}" for c in NYC_COUNTIES)
    county_ids = {f"0500000US{STATE}{c}" for c in NYC_COUNTIES}
    r = http_get(url, stream=True)
    r.encoding = "utf-8"
    lines = r.iter_lines(decode_unicode=True)
    header = next(lines).split("|")
    tracts, counties = [], []
    for line in lines:
        if not line:
            continue
        geo = line[: line.index("|")]
        if geo.startswith(tract_prefixes) or geo in county_ids:
            rec = dict(zip(header, line.split("|")))
            # Summary-file names look like B01003_E001 -> normalize to API style B01003_001E
            norm = {"GEO_ID": rec["GEO_ID"]}
            for k, v in rec.items():
                if k == "GEO_ID":
                    continue
                tbl, code = k.split("_")
                norm[f"{tbl}_{code[1:]}{code[0]}"] = v
            (tracts if geo.startswith("1400000US") else counties).append(norm)
    return tracts, counties


def _normalize(rows: list[dict[str, str]], var_ids: list[str]) -> list[dict[str, str]]:
    out = []
    for rec in rows:
        geoid = rec["GEO_ID"].split("US")[-1]
        row = {"GEOID": geoid}
        for v in var_ids:
            row[v + "E"] = rec.get(v + "E", "")
            row[v + "M"] = rec.get(v + "M", "")
        out.append(row)
    out.sort(key=lambda r: r["GEOID"])
    return out


def _write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        if not rows:
            f.write("")
            return
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def pinned_year(manifest: dict[str, Any]) -> int | None:
    """The ACS vintage end year recorded in the committed manifest, if any (§3.2)."""
    y = manifest.get("sources", {}).get(SOURCE_ID, {}).get("vintage_end_year")
    return int(y) if y else None


def choose_year(manifest: dict[str, Any], upgrade: bool) -> int:
    """Re-fetches keep the pinned vintage; only an explicit upgrade (or a first fetch) moves to
    the latest one, so a scheduled refresh can never silently switch census vintages (§3.2)."""
    pinned = pinned_year(manifest)
    return pinned if pinned and not upgrade else resolve_latest_year()


def fetch(manifest: dict[str, Any], refresh: bool, upgrade: bool = False) -> dict[str, Any]:
    year = choose_year(manifest, upgrade)
    out_dir = snapshot_dir(SOURCE_ID, str(year))
    key = os.environ.get("CENSUS_API_KEY")
    method = "census-data-api" if key else "table-based-summary-file"
    print(f"  ACS 5-year vintage resolved: {year - 4}-{year} (method: {method})")

    files, tables_meta = [], {}
    for table, desc in TABLES.items():
        meta = _variables(year, table)
        var_ids = _estimate_vars(meta, table)
        if key:
            tracts = _fetch_api(year, table, "tract:*", key)
            counties = _fetch_api(year, table, "county", key)
        else:
            tracts, counties = _fetch_summary_file(year, table)
        tracts_n = _normalize(tracts, var_ids)
        counties_n = _normalize(counties, var_ids)

        total_var = f"{table}_001E"
        non_null = sum(1 for r in tracts_n if r.get(total_var) not in ("", None, "null", "None"))
        available = non_null > 0
        print(f"    {table}: {len(var_ids)} vars, {len(tracts_n)} tracts, tract-level available={available}")

        t_path = out_dir / f"{table}_tract.csv"
        c_path = out_dir / f"{table}_county.csv"
        m_path = out_dir / f"{table}_variables.json"
        _write_csv(t_path, tracts_n)
        _write_csv(c_path, counties_n)
        slim = {
            v: {
                "label": meta[v + "E"]["label"],
                "concept": meta[v + "E"].get("concept"),
                "universe": meta[v + "E"].get("universe"),
            }
            for v in var_ids
        }
        m_path.write_text(json.dumps(slim, indent=1, ensure_ascii=False), encoding="utf-8")
        files += [file_record(t_path, len(tracts_n)), file_record(c_path, len(counties_n)), file_record(m_path, len(slim))]
        universe = next(iter(slim.values()))["universe"] if slim else None
        tables_meta[table] = {
            "description": desc,
            "concept": next(iter(slim.values()))["concept"] if slim else None,
            "universe": universe,
            "variables": len(var_ids),
            "tract_level_available": available,
            "tracts_with_values": non_null,
        }

    return {
        "source_id": SOURCE_ID,
        "name": "American Community Survey 5-year estimates (detailed tables)",
        "publisher": "U.S. Census Bureau",
        "source_url": API.format(year=year) if key else SUMMARY_FILE.format(year=year, table="<table>"),
        "vintage": f"{year - 4}-{year}",
        "vintage_end_year": year,
        "fetched_at": now_iso(),
        "method": method,
        "geography": "2020 census tracts and counties, NYC (state 36, counties 005/047/061/081/085)",
        "tables": tables_meta,
        "files": files,
    }

