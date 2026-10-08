"""ACS 5-year PUMS person records for NYC PUMAs (§4.6), plus the data dictionary and the 2020
tract-to-PUMA relationship file. Same vintage as the tract tables (§3.2)."""

from __future__ import annotations

import csv
import io
import zipfile
from typing import Any

import pandas as pd

from pipeline.fetch.common import download, file_record, now_iso, snapshot_dir

BASE = "https://www2.census.gov/programs-surveys/acs"
PERSON_ZIP = BASE + "/data/pums/{year}/5-Year/csv_pny.zip"
DICT_CSV = BASE + "/tech_docs/pums/data_dict/PUMS_Data_Dictionary_{y0}-{year}.csv"
TRACT_PUMA = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/2020_Census_Tract_to_2020_PUMA.txt"
NYC_COUNTIES = {"005", "047", "061", "081", "085"}

COLUMNS = ["SERIALNO", "SPORDER", "PUMA", "STATE", "AGEP", "PWGTP", "RAC1P", "RAC2P19", "RAC2P24", "HISP", "ANC1P", "ANC2P",
           "POBP", "NATIVITY", "YOEP", "LANX", "LANP", "ENG"] + [f"PWGTP{i}" for i in range(1, 81)]


def fetch(year: int) -> dict[str, Any]:
    out = snapshot_dir("pums", f"{year - 4}-{year}")
    out.mkdir(parents=True, exist_ok=True)
    rel = download(TRACT_PUMA, out / "tract_to_puma_2020.txt")
    with open(rel, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    nyc = sorted({r["PUMA5CE"] for r in rows if r["STATEFP"] == "36" and r["COUNTYFP"] in NYC_COUNTIES})
    dct = download(DICT_CSV.format(y0=year - 4, year=year), out / "pums_data_dictionary.csv")
    zpath = download(PERSON_ZIP.format(year=year), out / "csv_pny.zip")
    with zipfile.ZipFile(zpath) as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
        with z.open(name) as fh:
            header = io.TextIOWrapper(fh, encoding="utf-8").readline().strip().split(",")
        missing = [c for c in COLUMNS if c not in header]
        if missing:
            raise RuntimeError(f"PUMS file lacks expected columns: {missing}")
        with z.open(name) as fh:
            df = pd.read_csv(fh, usecols=COLUMNS, dtype=str)
    total_rows = len(df)
    df = df[df.PUMA.str.zfill(5).isin(nyc)].copy()
    for c in COLUMNS:
        if c not in ("SERIALNO",):
            df[c] = pd.to_numeric(df[c], errors="coerce").astype("Int32")
    parquet = out / "pums_persons_nyc.parquet"
    df.to_parquet(parquet, index=False)
    print(f"    pums {year - 4}-{year}: {total_rows:,} NY person records -> {len(df):,} in {len(nyc)} NYC PUMAs")
    return {
        "source_id": "pums",
        "name": "ACS 5-year Public Use Microdata Sample, person records (NYC PUMAs)",
        "publisher": "U.S. Census Bureau",
        "source_url": PERSON_ZIP.format(year=year),
        "vintage": f"{year - 4}-{year}",
        "fetched_at": now_iso(),
        "puma_vintage": "2020 PUMAs (codes checked against the 2020 tract-to-PUMA relationship file)",
        "nyc_pumas": nyc,
        "ny_person_records": total_rows,
        "files": [file_record(parquet, len(df)), file_record(dct, None), file_record(rel, len(rows))],
    }
