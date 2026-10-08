"""Multi-location key, cluster membership basis and parent buckets (§4.3, §4.4, §7)."""

from __future__ import annotations

import pytest

from pipeline.build.clusters_build import membership, parent_buckets
from pipeline.build.restaurants import chain_key
from pipeline.config import load_cuisines


@pytest.fixture(scope="module")
def cg():
    return load_cuisines()


def test_chain_key_drops_store_numbers_and_legal_suffixes():
    assert chain_key("DUNKIN' #12345") == chain_key("Dunkin #7") == "dunkin"
    assert chain_key("STARBUCKS COFFEE CO.") == "starbucks coffee"
    assert chain_key("Café Mogador, LLC") == "cafe mogador"
    assert chain_key(None) == ""


def test_parent_buckets_are_nearest_dohmh_ancestors(cg):
    assert parent_buckets(cg, "ecuadorian") == ["latin_american"]
    assert parent_buckets(cg, "nepali") == ["asian"]  # Himalayan/South Asian have no DOHMH value
    assert parent_buckets(cg, "dominican") == ["caribbean", "latin_american"]


def test_bucket_membership_uses_primary_and_any_tag(cg):
    primaries = ["latin_american", "generic_format", "latin_american", "thai"]
    tags = [[], [("latin_american", "low")], [("ecuadorian", "low")], []]
    m = membership(cg, "latin_american", primaries, tags, "medium")
    assert m.basis == "primary"
    assert m.member.tolist() == [True, True, True, False]
    assert m.via_primary.tolist() == [True, False, True, False]


def test_leaf_membership_uses_medium_plus_tags_only(cg):
    primaries = ["latin_american", "latin_american", "latin_american"]
    tags = [[("ecuadorian", "low")], [("ecuadorian", "medium")], [("ecuadorian", "high"), ("colombian", "high")]]
    m = membership(cg, "ecuadorian", primaries, tags, "medium")
    assert m.basis == "tag"
    assert m.member.tolist() == [False, True, True]
