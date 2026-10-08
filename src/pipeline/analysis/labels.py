"""Multi-label cuisine model (§4.4): one primary label (DOHMH) plus inferred tags.

Rules
- Evidence is a candidate label from one restaurant-data source (OSM, Overture or a name keyword).
  Generic labels (formats/dishes, or the root) carry no cuisine information and are ignored.
- A *tag* is a label strictly below the primary in the cuisine hierarchy. Among candidate labels,
  only the most specific ones become tags (a less specific candidate credits the more specific tag).
- Each piece of evidence is credited to every tag it names or is an ancestor of
  ("Ecuadorian" from OSM + "Latin American" from Overture -> one Ecuadorian tag, both credited).
- Confidence is derived from the credited sources, never set by hand:
    high   - two or more independent sources
    medium - one structured external source (OSM or Overture)
    low    - a name keyword only
- Evidence that credits no tag and is not compatible with the primary is a *conflict*: it never
  becomes a tag and never feeds filtering, clustering or LQ.
- Residential data is never an input (§2.3).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from pipeline.config import CuisineGraph

STRUCTURED = ("osm", "overture")
CONFIDENCE_ORDER = {"low": 0, "medium": 1, "high": 2}


@dataclass(frozen=True)
class Evidence:
    label: str  # cuisine node id
    source: str  # "osm" | "overture" | "keyword"
    evidence: str  # e.g. "cuisine=ecuadorian (node 123)" or 'name keyword "pupuseria"'


@dataclass
class Tag:
    label: str
    sources: list[Evidence] = field(default_factory=list)

    @property
    def confidence(self) -> str:
        kinds = {e.source for e in self.sources}
        if len(kinds) >= 2:
            return "high"
        if kinds & set(STRUCTURED):
            return "medium"
        return "low"


@dataclass
class Labels:
    primary: str
    tags: list[Tag]
    conflicts: list[Evidence]
    agreements: list[Evidence]  # compatible with the primary but adding no specificity


def build_labels(primary: str, evidence: list[Evidence], cg: CuisineGraph) -> Labels:
    ev = [e for e in evidence if cg.effective(e.label) != "root"]
    below = {e.label for e in ev if cg.is_below(e.label, primary)}
    # keep the most specific candidates only
    tags_ids = sorted(t for t in below if not any(cg.is_below(o, t) for o in below if o != t))
    tags = {t: Tag(label=t) for t in tags_ids}
    credited: set[int] = set()
    for k, e in enumerate(ev):
        for t in tags_ids:
            if e.label == t or e.label in cg.ancestors[t]:
                if e not in tags[t].sources:
                    tags[t].sources.append(e)
                credited.add(k)
    conflicts, agreements = [], []
    for k, e in enumerate(ev):
        if k in credited:
            continue
        if cg.related(e.label, primary):
            agreements.append(e)
        else:
            conflicts.append(e)
    for t in tags.values():
        t.sources.sort(key=lambda e: (e.source, e.evidence))
    key = lambda e: (e.source, e.label, e.evidence)  # noqa: E731
    return Labels(primary=primary, tags=[tags[t] for t in tags_ids],
                  conflicts=sorted(set(conflicts), key=key), agreements=sorted(set(agreements), key=key))


def matches_node(node: str, primary: str, tags: list[tuple[str, str]], cg: CuisineGraph,
                 min_confidence: str = "medium", use_primary: bool = True) -> bool:
    """Whether a restaurant belongs to cuisine `node` (§4.4 filtering/clustering rule).

    A restaurant matches if `node` equals its primary label or a tag, or is an ancestor of one.
    Tags below `min_confidence` are ignored. Generic primaries never match a specific node.
    """
    if use_primary:
        p = cg.effective(primary)
        if p != "root" and (p == node or node in cg.ancestors[p]):
            return True
    floor = CONFIDENCE_ORDER[min_confidence]
    for label, conf in tags:
        if CONFIDENCE_ORDER[conf] >= floor and (label == node or node in cg.ancestors[label]):
            return True
    return False
