"""Places of Worship (§4.5, STRETCH): OSM `amenity=place_of_worship` points with their tagged
`religion` / `denomination`. Coverage is incomplete and uneven (it follows mapper activity), and
religion is never inferred from ethnicity or from anything else — untagged places stay untagged."""

from __future__ import annotations

import json
from collections import Counter

from pipeline.build.writer import write_json
from pipeline.fetch.common import existing_snapshot, load_manifest
from pipeline.paths import REPO_ROOT, WEB_DATA_DIR

NYC_BBOX = (-74.27, 40.47, -73.68, 40.93)


def build_worship() -> dict[str, int]:
    e = existing_snapshot(load_manifest(), "osm")
    if not e:
        return {}
    data = json.loads((REPO_ROOT / e["files"][0]["path"]).read_text(encoding="utf-8"))
    pts = []
    for el in data["elements"]:
        t = el.get("tags", {})
        if t.get("amenity") != "place_of_worship":
            continue
        lat = el.get("lat", el.get("center", {}).get("lat"))
        lon = el.get("lon", el.get("center", {}).get("lon"))
        if lat is None or lon is None or not (NYC_BBOX[0] <= lon <= NYC_BBOX[2] and NYC_BBOX[1] <= lat <= NYC_BBOX[3]):
            continue
        pts.append([round(lon, 5), round(lat, 5), t.get("religion") or "", t.get("denomination") or "", t.get("name") or ""])
    pts.sort()
    write_json(WEB_DATA_DIR / "worship.json", {
        "source": f"OpenStreetMap (ODbL), snapshot {e['vintage']}",
        "note": "Incomplete and uneven coverage: places are mapped where volunteers mapped them. Religion is shown only as tagged in OSM and is never inferred.",
        "columns": ["lon", "lat", "religion", "denomination", "name"],
        "points": pts,
    })
    c = Counter(p[2] or "(not tagged)" for p in pts)
    return {"places": len(pts), **dict(c.most_common(6))}
