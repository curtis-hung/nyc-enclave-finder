"""Crosswalk integrity, broad-group roll-ups, the no-cross-dimension-sum rule, universe
consistency and the cuisine hierarchy (§2.5, §2.6, §5, §13.1)."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
import yaml

from pipeline.config import ConfigError, load_config, load_cuisines, load_dimensions, load_groups
from pipeline.paths import CONFIG_DIR


@pytest.fixture(scope="module")
def cfg():
    return load_config()


def _tmp_config(tmp_path: Path, groups: list[dict]) -> Path:
    d = tmp_path / "config"
    shutil.copytree(CONFIG_DIR, d)
    (d / "groups.yaml").write_text(yaml.safe_dump({"groups": groups}), encoding="utf-8")
    return d


# --- real configuration ---------------------------------------------------------------------


def test_every_mapping_uses_only_its_dimensions_table(cfg):
    for g in cfg.groups.values():
        for dim_id, m in g.dims.items():
            table = cfg.dimensions[dim_id].table
            assert all(v.startswith(table + "_") for v in m.vars), (g.id, dim_id, m.vars)


def test_no_group_sums_ancestry_categories(cfg):
    assert cfg.dimensions["ancestry"].summable is False
    for g in cfg.groups.values():
        if "ancestry" in g.dims:
            assert len(g.dims["ancestry"].vars) == 1, g.id
            assert not g.dims["ancestry"].derived, g.id


def test_rollups_never_double_count_a_variable(cfg):
    for g in cfg.groups.values():
        for m in g.dims.values():
            assert len(set(m.vars)) == len(m.vars), g.id


def test_derived_rollups_equal_union_of_children_exact_mappings(cfg):
    for g in cfg.groups.values():
        for dim_id, m in g.dims.items():
            if not m.derived:
                continue
            union = []
            for cid in g.children:
                cm = cfg.groups[cid].dims.get(dim_id)
                if cm is not None and not cm.is_bucket:
                    union.extend(cm.vars)
            assert sorted(union) == m.vars, (g.id, dim_id)


def test_bucket_mappings_never_enter_rollups(cfg):
    for g in cfg.groups.values():
        for dim_id, m in g.dims.items():
            if not m.derived:
                continue
            for cid in g.children:
                cm = cfg.groups[cid].dims.get(dim_id)
                if cm is not None and cm.is_bucket:
                    assert cid in m.missing_from_sum


def test_every_group_has_a_valid_default_dimension(cfg):
    for g in cfg.groups.values():
        assert g.default_dimension in g.dims, g.id
        assert g.rationale
        # only explicitly labelled proxy groups may default to a bucket category
        assert g.proxy or not g.dims[g.default_dimension].is_bucket, g.id


def test_rejects_bucket_default_unless_proxy(tmp_path):
    grp = {"id": "x", "name": "X", "dims": {"language": {"vars": [9], "bucket": "b"}}, "default_dimension": "language"}
    d = _tmp_config(tmp_path, [grp])
    with pytest.raises(ConfigError, match="bucket"):
        load_groups(load_dimensions(d), d)
    d2 = _tmp_config(tmp_path / "ok", [{**grp, "proxy": True}])
    assert load_groups(load_dimensions(d2), d2)["x"].proxy


def test_every_pairing_points_at_a_cuisine_node(cfg):
    for g in cfg.groups.values():
        for cid, kind in g.cuisines.items():
            assert cid in cfg.cuisines.nodes
            assert kind in ("exact", "bucket")


def test_exact_pairings_are_unique(cfg):
    owners = {}
    for g in cfg.groups.values():
        for cid, kind in g.cuisines.items():
            if kind == "exact":
                assert cid not in owners, (cid, owners.get(cid), g.id)
                owners[cid] = g.id


def test_denominators_are_one_per_dimension(cfg):
    # universe consistency: one dimension = one numerator table = one denominator
    tables = [d.table for d in cfg.dimensions.values()]
    assert len(tables) == len(set(tables))
    for d in cfg.dimensions.values():
        assert d.denominator and d.share_of and d.numerator_universe


# --- synthetic configurations -----------------------------------------------------------------


def test_rejects_summing_non_summable_dimension(tmp_path):
    d = _tmp_config(tmp_path, [{"id": "x", "name": "X", "dims": {"ancestry": [7, 8]}, "default_dimension": "ancestry"}])
    with pytest.raises(ConfigError, match="non-summable"):
        load_groups(load_dimensions(d), d)


def test_rollup_sums_children_and_records_missing(tmp_path):
    d = _tmp_config(tmp_path, [{
        "id": "broad", "name": "Broad", "default_dimension": "birthplace",
        "children": [
            {"id": "a", "name": "A", "dims": {"birthplace": [60], "asian": [21]}, "default_dimension": "asian"},
            {"id": "b", "name": "B", "dims": {"birthplace": [58]}, "default_dimension": "birthplace"},
            {"id": "c", "name": "C", "dims": {"asian": [26], "birthplace": {"vars": [171], "bucket": "proxy"}},
             "default_dimension": "asian"},
        ],
    }])
    groups = load_groups(load_dimensions(d), d)
    b = groups["broad"]
    assert b.dims["birthplace"].vars == ["B05006_058", "B05006_060"]
    assert b.dims["birthplace"].missing_from_sum == ["c"]  # bucket mapping excluded
    assert b.dims["asian"].vars == ["B02015_021", "B02015_026"]
    assert b.dims["asian"].missing_from_sum == ["b"]
    assert "ancestry" not in b.dims  # never derived


def test_rollup_rejects_children_sharing_a_variable(tmp_path):
    d = _tmp_config(tmp_path, [{
        "id": "broad", "name": "Broad", "default_dimension": "asian",
        "children": [
            {"id": "a", "name": "A", "dims": {"asian": [21]}, "default_dimension": "asian"},
            {"id": "b", "name": "B", "dims": {"asian": [21]}, "default_dimension": "asian"},
        ],
    }])
    with pytest.raises(ConfigError, match="double count"):
        load_groups(load_dimensions(d), d)


def test_language_is_never_derived_for_broad_groups(tmp_path):
    d = _tmp_config(tmp_path, [{
        "id": "broad", "name": "Broad", "default_dimension": "asian",
        "children": [{"id": "a", "name": "A", "dims": {"asian": [5], "language": [18]}, "default_dimension": "asian"}],
    }])
    groups = load_groups(load_dimensions(d), d)
    assert "language" not in groups["broad"].dims


# --- cuisine DAG ------------------------------------------------------------------------------


def test_cuisine_dag_below_relations():
    cg = load_cuisines()
    assert cg.is_below("ecuadorian", "latin_american")
    assert cg.is_below("dominican", "caribbean") and cg.is_below("dominican", "latin_american")
    assert cg.is_below("nepali", "himalayan")
    assert not cg.is_below("thai", "pizza")
    assert not cg.is_below("latin_american", "ecuadorian")
    assert not cg.is_below("thai", "thai")
    # generic primaries behave as the root: any specific label is below them
    assert cg.is_below("thai", "root") and cg.is_below("thai", "generic_format")


def test_dohmh_values_map_once():
    cg = load_cuisines()
    m = cg.dohmh_map()
    assert m["Thai"] == "thai" and m["Other"] == "root"
