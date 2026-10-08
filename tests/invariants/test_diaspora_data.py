"""Invariants on the diaspora (PUMS) outputs (§4.6, §13.3)."""

from __future__ import annotations

import json

import pytest

from pipeline.paths import WEB_DATA_DIR

pytestmark = pytest.mark.invariants
IDX = WEB_DATA_DIR / "diaspora" / "index.json"


@pytest.fixture(scope="module")
def ix():
    if not IDX.exists():
        pytest.skip("no diaspora data")
    return json.loads(IDX.read_text(encoding="utf-8"))


def test_every_tract_has_a_puma(ix):
    meta = json.loads((WEB_DATA_DIR / "meta.json").read_text(encoding="utf-8"))
    assert len(ix["tract_puma"]) == meta["levels"]["tract"]
    assert all(0 <= p < len(ix["pumas"]) for p in ix["tract_puma"])


def test_shown_values_are_reliable_and_never_zero(ix):
    cv_max = ix["rules"]["cv_max"]
    for scope in [ix["city"], *ix["boro"].values()]:
        for gid, ms in scope.items():
            for name, (value, se) in ms.items():
                assert 0 < value <= 1, (gid, name)
                assert se / value <= cv_max + 1e-6, (gid, name)


def test_measures_only_for_declared_families(ix):
    for gid, ms in ix["city"].items():
        fams = ix["groups"][gid]["families"]
        for name in ms:
            assert ix["measures"][name][2] in fams, (gid, name)


def test_puma_cells_are_well_formed(ix):
    for p in ix["pumas"][:5]:
        data = json.loads((WEB_DATA_DIR / "diaspora" / "puma" / f"{p['code']}.json").read_text(encoding="utf-8"))
        for gid, cells in data["groups"].items():
            assert gid in ix["groups"]
            for name, c in cells.items():
                assert len(c) == 82 and c[0] > 0, (gid, name)
