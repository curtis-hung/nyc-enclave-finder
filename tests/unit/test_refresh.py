"""Scheduled-refresh gate and ACS vintage pinning (§3.2, §14)."""

from __future__ import annotations

from pipeline.fetch import acs
from pipeline.refresh import evaluate


def _points(n: int, tagged: int) -> dict:
    return {"n": n, "tags": {str(i): [[1, 2]] for i in range(tagged)}}


def _manifest(acs_vintage: str = "2020-2024", ntas: str = "2026-05-28") -> dict:
    return {"sources": {"acs5": {"vintage": acs_vintage}, "pums": {"vintage": acs_vintage},
                        "nyc_ntas": {"vintage": ntas}, "dohmh": {"vintage": "2026-10-07"}}}


def test_routine_month_is_safe():
    safe, reasons = evaluate(_points(30000, 9000), _points(30400, 9200), _manifest(),
                             {**_manifest(), "sources": {**_manifest()["sources"], "dohmh": {"vintage": "2026-11-02"}}})
    assert safe, reasons


def test_large_restaurant_swing_needs_review():
    safe, reasons = evaluate(_points(30000, 9000), _points(25000, 9000), _manifest(), _manifest())
    assert not safe
    assert any(r.startswith("REVIEW restaurants") for r in reasons)


def test_tag_collapse_needs_review():
    """A quietly failed enrichment source shows up as a drop in tagged restaurants."""
    safe, reasons = evaluate(_points(30000, 9000), _points(30000, 4000), _manifest(), _manifest())
    assert not safe
    assert any(r.startswith("REVIEW tagged") for r in reasons)


def test_new_census_vintage_never_auto_publishes():
    safe, reasons = evaluate(_points(30000, 9000), _points(30000, 9000), _manifest(),
                             _manifest(acs_vintage="2021-2025"))
    assert not safe
    assert any("acs5 vintage changed" in r for r in reasons)


def test_revised_geography_needs_review():
    safe, _ = evaluate(_points(30000, 9000), _points(30000, 9000), _manifest(),
                       _manifest(ntas="2027-01-15"))
    assert not safe


def test_acs_fetch_keeps_the_pinned_vintage(monkeypatch):
    monkeypatch.setattr(acs, "resolve_latest_year", lambda start=None: 2025)
    pinned = {"sources": {"acs5": {"vintage_end_year": 2024}}}
    assert acs.choose_year(pinned, upgrade=False) == 2024  # monthly refresh: stays pinned
    assert acs.choose_year(pinned, upgrade=True) == 2025  # explicit upgrade only
    assert acs.choose_year({"sources": {}}, upgrade=False) == 2025  # first fetch resolves latest
