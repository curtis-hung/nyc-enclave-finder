"""Fetch plumbing: manifest idempotency, key redaction, ACS normalization."""

from __future__ import annotations

from pipeline.fetch import acs, common


def test_redact_removes_api_key(monkeypatch):
    monkeypatch.setenv("CENSUS_API_KEY", "abc123secret")
    s = common._redact("https://api.census.gov/data?get=x&key=abc123secret&for=tract:*")
    assert "abc123secret" not in s
    assert "key=REDACTED" in s


def test_existing_snapshot_requires_files_on_disk(tmp_path, monkeypatch):
    monkeypatch.setattr(common, "REPO_ROOT", tmp_path)
    f = tmp_path / "data" / "raw" / "x" / "v1" / "a.csv"
    f.parent.mkdir(parents=True)
    f.write_text("a\n1\n")
    manifest = {"sources": {"x": {"vintage": "v1", "files": [{"path": "data/raw/x/v1/a.csv"}]}}}
    assert common.existing_snapshot(manifest, "x") is not None
    f.unlink()
    assert common.existing_snapshot(manifest, "x") is None
    assert common.existing_snapshot(manifest, "missing") is None


def test_file_record_hashes_and_counts(tmp_path, monkeypatch):
    monkeypatch.setattr(common, "REPO_ROOT", tmp_path)
    f = tmp_path / "a.txt"
    f.write_bytes(b"hello")
    rec = common.file_record(f, 1)
    assert rec["path"] == "a.txt"
    assert rec["bytes"] == 5
    assert rec["sha256"] == "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"


def test_acs_normalize_keeps_estimate_and_moe_by_geoid():
    rows = [
        {"GEO_ID": "1400000US36061000200", "B01003_001E": "10", "B01003_001M": "5", "NAME": "x"},
        {"GEO_ID": "1400000US36005000100", "B01003_001E": "20", "B01003_001M": "-555555555"},
    ]
    out = acs._normalize(rows, ["B01003_001"])
    assert [r["GEOID"] for r in out] == ["36005000100", "36061000200"]  # sorted, deterministic
    assert out[0] == {"GEOID": "36005000100", "B01003_001E": "20", "B01003_001M": "-555555555"}


def test_acs_estimate_vars_ignores_annotations():
    meta = {"B01003_001E": {}, "B01003_001M": {}, "B01003_001EA": {}, "B01003_001MA": {}, "GEO_ID": {}}
    assert acs._estimate_vars(meta, "B01003") == ["B01003_001"]
