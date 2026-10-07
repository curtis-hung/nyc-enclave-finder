"""Open enrichment sources (§4.4, §4.5): OpenStreetMap via Overpass and Overture Maps Places.

Both are free, open (ODbL / CDLA-Permissive-2.0 + ODbL) and bulk-queried once at build time.
"""

from __future__ import annotations

import json
from typing import Any

from pipeline.fetch.common import file_record, http_get, http_post, now_iso, snapshot_dir

OVERPASS = "https://overpass-api.de/api/interpreter"
# OSM relation 175905 = City of New York (five boroughs). Overpass area id = 3600000000 + rel id.
NYC_AREA = 3600175905
OVERPASS_QUERY = f"""
[out:json][timeout:600];
area(id:{NYC_AREA})->.nyc;
(
  nwr["amenity"~"^(restaurant|fast_food|cafe)$"](area.nyc);
  nwr["amenity"="place_of_worship"](area.nyc);
);
out center tags;
"""

OVERTURE_STAC = "https://stac.overturemaps.org/catalog.json"
OVERTURE_S3 = "s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*"
# Generous NYC bounding box (lon/lat); records are clipped to the city precisely at build time.
NYC_BBOX = (-74.2591, 40.4774, -73.7004, 40.9176)


def fetch_osm() -> dict[str, Any]:
    r = http_post(OVERPASS, data={"data": OVERPASS_QUERY})
    payload = r.json()
    base = payload.get("osm3s", {}).get("timestamp_osm_base", now_iso())
    version = base[:10]
    out_dir = snapshot_dir("osm", version)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "osm_eating_and_worship.json"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    n = len(payload.get("elements", []))
    eat = sum(1 for e in payload["elements"] if e.get("tags", {}).get("amenity") in ("restaurant", "fast_food", "cafe"))
    print(f"    osm: {n} elements ({eat} eating places), OSM base {base}")
    return {
        "source_id": "osm",
        "name": "OpenStreetMap eating places and places of worship (NYC)",
        "publisher": "OpenStreetMap contributors",
        "license": "ODbL 1.0",
        "source_url": OVERPASS,
        "query": OVERPASS_QUERY.strip(),
        "vintage": version,
        "osm_base_timestamp": base,
        "fetched_at": now_iso(),
        "counts": {"elements": n, "eating_places": eat, "places_of_worship": n - eat},
        "files": [file_record(path, n)],
    }


def resolve_overture_release() -> str:
    cat = http_get(OVERTURE_STAC).json()
    if cat.get("latest"):
        return cat["latest"]
    rels = [link["href"].split("/")[-2] for link in cat["links"] if link.get("rel") == "child"]
    return sorted(rels)[-1]


def fetch_overture() -> dict[str, Any]:
    import duckdb

    release = resolve_overture_release()
    out_dir = snapshot_dir("overture", release)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "overture_places_food_nyc.parquet"
    xmin, ymin, xmax, ymax = NYC_BBOX
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    q = f"""
    COPY (
      SELECT id,
             names."primary" AS name,
             taxonomy."primary" AS category_primary,
             taxonomy.alternates AS category_alternates,
             taxonomy.hierarchy AS category_hierarchy,
             basic_category,
             operating_status,
             confidence,
             (bbox.xmin + bbox.xmax) / 2 AS lon,
             (bbox.ymin + bbox.ymax) / 2 AS lat,
             addresses[1].freeform AS address
      FROM read_parquet('{OVERTURE_S3.format(release=release)}', hive_partitioning=1)
      WHERE bbox.xmin >= {xmin} AND bbox.xmax <= {xmax} AND bbox.ymin >= {ymin} AND bbox.ymax <= {ymax}
        AND (taxonomy.hierarchy[1] = 'food_and_drink'
             OR taxonomy."primary" LIKE '%restaurant%'
             OR basic_category LIKE '%restaurant%')
      ORDER BY id
    ) TO '{path.as_posix()}' (FORMAT PARQUET)
    """
    con.execute(q)
    n = con.execute(f"SELECT count(*) FROM read_parquet('{path.as_posix()}')").fetchone()[0]
    print(f"    overture {release}: {n} food & drink places in NYC bbox")
    return {
        "source_id": "overture",
        "name": "Overture Maps Places (food and drink, NYC bounding box)",
        "publisher": "Overture Maps Foundation",
        "license": "CDLA-Permissive-2.0 / ODbL (per-source, see release notes)",
        "source_url": OVERTURE_S3.format(release=release),
        "vintage": release,
        "bbox": NYC_BBOX,
        "fetched_at": now_iso(),
        "files": [file_record(path, int(n))],
    }

