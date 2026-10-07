"""Hard invariants on the committed processed data (§13.3). These re-check the build outputs
that the frontend consumes; the build itself also fails on any violation."""

from __future__ import annotations

import json

import pytest

from pipeline.paths import WEB_DATA_DIR

pytestmark = pytest.mark.invariants

META = WEB_DATA_DIR / "meta.json"


@pytest.fixture(scope="module")
def meta():
    if not META.exists():
        pytest.skip("no built data; run `uv run pipeline build`")
    return json.loads(META.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def groups():
    return json.loads((WEB_DATA_DIR / "groups.json").read_text(encoding="utf-8"))


def test_tract_geoids_unique(meta):
    feats = json.loads((WEB_DATA_DIR / "geo" / "tracts.json").read_text(encoding="utf-8"))["features"]
    ids = [f["properties"]["geoid"] for f in feats]
    assert len(ids) == len(set(ids))
    idx = [f["properties"]["i"] for f in feats]
    assert len(set(idx)) == len(idx) and max(idx) < meta["levels"]["tract"]


def test_every_tract_maps_to_an_nta_and_borough(meta):
    n = meta["levels"]["tract"]
    assert len(meta["tract_nta"]) == n and len(meta["tract_boro"]) == n
    assert all(0 <= i < meta["levels"]["nta"] for i in meta["tract_nta"])
    assert all(0 <= i < meta["levels"]["boro"] for i in meta["tract_boro"])


def test_group_bundles_are_complete_and_consistent(meta, groups):
    n = meta["levels"]
    for gid, g in groups["groups"].items():
        assert g["default_dimension"] in g["dims"], gid
        for dim in g["dims"]:
            data = json.loads((WEB_DATA_DIR / "demo" / gid / f"{dim}.json").read_text(encoding="utf-8"))
            for lvl in ("tract", "nta", "boro"):
                d = data[lvl]
                assert all(len(d[k]) == n[lvl] for k in ("e", "m", "s", "lq", "st")), (gid, dim, lvl)
                for st, s, lq, e in zip(d["st"], d["s"], d["lq"], d["e"]):
                    if st in (2, 3):  # suppressed / unavailable never carry a value
                        assert s is None and lq is None, (gid, dim, lvl)
                    if st == 4:  # zero is a real zero, never missing
                        assert e == 0 and s == 0 and lq == 0, (gid, dim, lvl)
            # NTA and borough values are exact tract sums
            tot = sum(x for x in data["tract"]["e"] if x is not None)
            assert abs(sum(x for x in data["nta"]["e"] if x is not None) - tot) <= len(data["tract"]["e"]) * 0.5
            assert abs(g["dims"][dim]["city"]["e"] - tot) <= len(data["tract"]["e"]) * 0.5


def test_shares_in_a_dimension_use_that_dimensions_denominator(meta, groups):
    den = json.loads((WEB_DATA_DIR / "denominators.json").read_text(encoding="utf-8"))
    for gid in ("thai", "dominican", "jamaican", "polish"):
        g = groups["groups"][gid]
        for dim in g["dims"]:
            data = json.loads((WEB_DATA_DIR / "demo" / gid / f"{dim}.json").read_text(encoding="utf-8"))["nta"]
            for e, s, d in zip(data["e"], data["s"], den[dim]["nta"]):
                if s not in (None, 0) and d:
                    assert s == pytest.approx(e / d, rel=0.01, abs=1e-6)
