"""Hard invariants on the built restaurant and cluster assets (§13.3)."""

from __future__ import annotations

import json

import pytest

from pipeline.config import load_config
from pipeline.paths import WEB_DATA_DIR

pytestmark = pytest.mark.invariants
PTS = WEB_DATA_DIR / "restaurants" / "points.json"


@pytest.fixture(scope="module")
def pts():
    if not PTS.exists():
        pytest.skip("no built data")
    return json.loads(PTS.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def cfg():
    return load_config()


@pytest.fixture(scope="module")
def nodes():
    return json.loads((WEB_DATA_DIR / "cuisines.json").read_text(encoding="utf-8"))["nodes"]


def test_point_arrays_are_aligned(pts):
    for k in ("lon", "lat", "tract", "primary", "flags"):
        assert len(pts[k]) == pts["n"], k


def test_every_tag_is_below_its_primary(pts, cfg, nodes):
    cg = cfg.cuisines
    for i, tags in pts["tags"].items():
        primary = nodes[pts["primary"][int(i)]]["id"]
        for node, _ in tags:
            assert cg.is_below(nodes[node]["id"], primary), (i, primary, nodes[node]["id"])


def test_conflicts_are_never_below_the_primary(cfg):
    cg = cfg.cuisines
    checked = 0
    for f in sorted((WEB_DATA_DIR / "restaurants" / "details").glob("*.json"))[:60]:
        for d in json.loads(f.read_text(encoding="utf-8")).values():
            primary = cg.dohmh_map().get(d["cuisine_dohmh"] or "", "root")
            for c in d["conflicts"]:
                assert not cg.is_below(c["label"], primary)
                assert not cg.related(c["label"], primary)
                checked += 1  # noqa: SIM113


def test_cluster_stats_are_internally_consistent(cfg, pts):
    for f in (WEB_DATA_DIR / "clusters").glob("*.json"):
        data = json.loads(f.read_text(encoding="utf-8"))
        for preset, items in data["stats"].items():
            pc = cfg.presets["presets"][preset]["cluster"]
            for c in items:
                # LQ is published rounded to 2 decimals but the pipeline qualifies on the exact value,
                # so within ±0.005 of the cutoff either label is consistent with the published number
                band = 0.005 + 1e-9
                assert c["lq"] >= pc["lq_min"] - band or c["share_gap"] >= pc["gap_min"] - 1e-3
                if c["lq"] >= pc["lq_min"] + band:
                    assert c["qualified_by"] == "lq"
                elif c["lq"] < pc["lq_min"] - band:
                    assert c["qualified_by"] == "share_gap"
                else:
                    assert c["qualified_by"] in ("lq", "share_gap")
                assert c["share"] == pytest.approx(c["cuisine_in_catchment"] / c["catchment_restaurants"], abs=1e-3)
                assert c["restaurants"] == len(c["members"]) <= c["cuisine_in_catchment"]
                assert c["independent"] <= c["restaurants"]
                for m in c["members"]:
                    assert pts["flags"][m] & 4, "cluster member outside the analysis population"


def test_zip_centres_cover_nyc_and_lie_inside_it():
    """Find food's ZIP lookup (§9.9): derived from restaurant locations, so every centre must be
    in the NYC bounding box and the familiar residential ZIPs must be present."""
    zips = json.loads((WEB_DATA_DIR / "restaurants" / "zips.json").read_text(encoding="utf-8"))["zips"]
    assert len(zips) > 150
    for z, (lat, lon, n) in zips.items():
        assert len(z) == 5 and z.isdigit()
        assert 40.47 < lat / 1e5 < 40.93 and -74.27 < lon / 1e5 < -73.68, z
        assert n >= 3
    for z in ("10001", "10453", "11201", "11373", "10301"):  # one per borough
        assert z in zips
