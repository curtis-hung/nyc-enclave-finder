"""Planted-answer tests for the tag model and enrichment matching (§4.4, §13.1, §13.2)."""

from __future__ import annotations

import numpy as np
import pytest

from pipeline.analysis.labels import Evidence, build_labels, matches_node
from pipeline.analysis.matching import match, normalize_name, similarity
from pipeline.config import load_cuisines


@pytest.fixture(scope="module")
def cg():
    return load_cuisines()


def osm(label, ev="n1"):
    return Evidence(label, "osm", ev)


def ov(label, ev="p1"):
    return Evidence(label, "overture", ev)


def kw(label, ev="k"):
    return Evidence(label, "keyword", ev)


def test_external_label_not_below_primary_is_a_conflict_not_a_tag(cg):
    lab = build_labels("pizza", [osm("thai")], cg)
    assert lab.tags == []
    assert [c.label for c in lab.conflicts] == ["thai"]


def test_osm_ecuadorian_plus_overture_latin_american_is_one_high_tag(cg):
    lab = build_labels("latin_american", [osm("ecuadorian"), ov("latin_american")], cg)
    assert [t.label for t in lab.tags] == ["ecuadorian"]
    assert {e.source for e in lab.tags[0].sources} == {"osm", "overture"}
    assert lab.tags[0].confidence == "high"
    assert lab.conflicts == []


def test_latin_american_tagged_ecuadorian_and_colombian_has_two_tags(cg):
    lab = build_labels("latin_american", [osm("ecuadorian"), ov("colombian")], cg)
    assert [t.label for t in lab.tags] == ["colombian", "ecuadorian"]
    assert all(t.confidence == "medium" for t in lab.tags)


def test_name_keyword_alone_is_low_confidence(cg):
    lab = build_labels("latin_american", [kw("salvadoran", 'name keyword "pupuseria"')], cg)
    assert lab.tags[0].label == "salvadoran" and lab.tags[0].confidence == "low"
    tags = [(t.label, t.confidence) for t in lab.tags]
    assert not matches_node("salvadoran", "latin_american", tags, cg, "medium", use_primary=False)
    assert matches_node("salvadoran", "latin_american", tags, cg, "low", use_primary=False)


def test_ambiguous_himalayan_keyword_is_an_intermediate_tag(cg):
    lab = build_labels("asian", [kw("himalayan", 'name keyword "momo"')], cg)
    assert [t.label for t in lab.tags] == ["himalayan"]


def test_more_specific_evidence_absorbs_compatible_ancestor(cg):
    lab = build_labels("asian", [kw("himalayan"), osm("nepali")], cg)
    assert [t.label for t in lab.tags] == ["nepali"]
    assert lab.tags[0].confidence == "high"  # keyword + OSM agree on a compatible ancestor/descendant


def test_generic_primary_accepts_any_label_as_tag(cg):
    for primary in ("root", "generic_format"):
        lab = build_labels(primary, [osm("thai")], cg)
        assert [t.label for t in lab.tags] == ["thai"] and lab.conflicts == []


def test_label_equal_to_primary_is_agreement_not_tag(cg):
    lab = build_labels("thai", [osm("thai")], cg)
    assert lab.tags == [] and lab.conflicts == [] and [a.label for a in lab.agreements] == ["thai"]


def test_generic_external_labels_are_ignored(cg):
    lab = build_labels("thai", [osm("generic_format"), ov("root")], cg)
    assert lab.tags == [] and lab.conflicts == [] and lab.agreements == []


def test_matching_by_primary_or_tag_or_ancestor(cg):
    tags = [("ecuadorian", "medium"), ("colombian", "high")]
    assert matches_node("latin_american", "latin_american", [], cg)
    assert matches_node("ecuadorian", "latin_american", tags, cg)
    assert matches_node("south_american", "latin_american", tags, cg, use_primary=False)
    assert not matches_node("peruvian", "latin_american", tags, cg)
    assert not matches_node("thai", "generic_format", [], cg)  # generic primary is not a cuisine


# --- matching ------------------------------------------------------------------------------------


def test_name_normalization_and_similarity():
    assert normalize_name("THE PUPUSERIA LA ESPECIAL, INC.") == "pupuseria la especial"
    assert similarity("pupuseria la especial", "la especial pupuseria") == 1.0  # token order ignored
    assert similarity("thai son", "thai son") == 1.0
    assert similarity("", "x") == 0.0


def test_matching_is_one_to_one_and_within_distance():
    a = np.array([[0.0, 0.0], [10.0, 0.0]])
    b = np.array([[5.0, 0.0], [500.0, 0.0]])
    pairs = match(a, ["thai son", "thai son"], ["A1", "A2"], b, ["thai son", "thai son"], ["B1", "B2"],
                  max_dist=246, min_sim=0.6)
    assert len(pairs) == 1  # only one B within distance; never matched twice
    assert pairs[0][1] == 0


def test_matching_is_deterministic_under_reordering():
    a = np.array([[0.0, 0.0], [3.0, 0.0]])
    b = np.array([[1.0, 0.0], [2.0, 0.0]])
    names = ["golden thai", "golden thai"]
    p1 = match(a, names, ["A1", "A2"], b, names, ["B1", "B2"], 246, 0.6)
    p2 = match(a[::-1], names, ["A2", "A1"], b[::-1], names, ["B2", "B1"], 246, 0.6)
    ids1 = sorted((["A1", "A2"][i], ["B1", "B2"][j]) for i, j, _, _ in p1)
    ids2 = sorted((["A2", "A1"][i], ["B2", "B1"][j]) for i, j, _, _ in p2)
    assert ids1 == ids2


def test_dissimilar_names_do_not_match():
    a, b = np.array([[0.0, 0.0]]), np.array([[1.0, 0.0]])
    assert match(a, ["golden thai"], [1], b, ["joes pizza"], [2], 246, 0.6) == []
