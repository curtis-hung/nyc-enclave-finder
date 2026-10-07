"""Load and validate the YAML configuration; resolve the group crosswalk (§5) and the cuisine DAG.

Resolution rules (documented in config/groups.yaml):
- an exact mapping lists table lines that are summed (summable dimensions only);
- a bucket mapping is shown but flagged, and never enters a roll-up;
- a broad group missing a summable dimension sums its descendants' resolved exact mappings;
  descendants lacking that dimension are recorded as `missing_from_sum`;
- ancestry (non-summable) is never derived.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path
from typing import Any

import yaml

from pipeline.paths import CONFIG_DIR


def load_yaml(name: str, config_dir: Path = CONFIG_DIR) -> Any:
    with open(config_dir / name, encoding="utf-8") as f:
        return yaml.safe_load(f)


@dataclass(frozen=True)
class Dimension:
    id: str
    table: str
    name: str
    short: str
    numerator_universe: str
    denominator: str
    share_of: str
    summable: bool
    note: str | None = None
    derive: bool = True

    def var(self, line: int) -> str:
        return f"{self.table}_{line:03d}"


@dataclass
class DimMapping:
    """How one group is represented in one dimension."""

    vars: list[str]
    bucket: str | None = None  # description of the broader source category, if a bucket
    derived: bool = False  # summed from children
    missing_from_sum: list[str] = field(default_factory=list)

    @property
    def is_bucket(self) -> bool:
        return self.bucket is not None


@dataclass
class Group:
    id: str
    name: str
    parent: str | None
    children: list[str]
    depth: int
    default_dimension: str
    rationale: str | None
    cuisines: dict[str, str]
    dims: dict[str, DimMapping] = field(default_factory=dict)

    @property
    def is_leaf(self) -> bool:
        return not self.children


class ConfigError(ValueError):
    pass


def load_dimensions(config_dir: Path = CONFIG_DIR) -> dict[str, Dimension]:
    raw = load_yaml("dimensions.yaml", config_dir)
    return {k: Dimension(id=k, **v) for k, v in raw.items()}


DEFAULT_RATIONALE = {
    "asian": "Detailed Asian groups (B02015) count U.S.-born and immigrant residents of the group.",
    "hispanic": "Detailed Hispanic origin (B03001) counts U.S.-born and immigrant residents of the group.",
    "ancestry": "Ancestry counts U.S.-born and immigrants who report this heritage (race-neutral).",
    "race": "Race / Hispanic origin table (B03002).",
    "birthplace": "Country of birth (foreign-born residents only).",
    "language": "Language spoken at home.",
}


def load_groups(dims: dict[str, Dimension], config_dir: Path = CONFIG_DIR) -> dict[str, Group]:
    raw = load_yaml("groups.yaml", config_dir)["groups"]
    groups: dict[str, Group] = {}
    raw_dims: dict[str, dict[str, Any]] = {}

    def walk(node: dict[str, Any], parent: str | None, depth: int) -> None:
        gid = node["id"]
        if gid in groups:
            raise ConfigError(f"duplicate group id {gid}")
        kids = node.get("children", []) or []
        g = Group(
            id=gid,
            name=node["name"],
            parent=parent,
            children=[k["id"] for k in kids],
            depth=depth,
            default_dimension=node["default_dimension"],
            rationale=node.get("rationale"),
            cuisines=dict(node.get("cuisines") or {}),
        )
        groups[gid] = g
        raw_dims[gid] = node.get("dims") or {}
        for k in kids:
            walk(k, gid, depth + 1)

    for top in raw:
        walk(top, None, 0)

    # explicit mappings
    for gid, d in raw_dims.items():
        for dim_id, spec in d.items():
            if dim_id not in dims:
                raise ConfigError(f"{gid}: unknown dimension {dim_id}")
            dim = dims[dim_id]
            if isinstance(spec, dict):
                lines, bucket = spec["vars"], spec["bucket"]
            else:
                lines, bucket = spec, None
            if len(lines) > 1 and not dim.summable:
                raise ConfigError(f"{gid}: cannot sum {len(lines)} categories in non-summable {dim_id}")
            if len(set(lines)) != len(lines):
                raise ConfigError(f"{gid}/{dim_id}: duplicate variable")
            groups[gid].dims[dim_id] = DimMapping(vars=[dim.var(n) for n in lines], bucket=bucket)

    # derived roll-ups, bottom-up (deepest first)
    for g in sorted(groups.values(), key=lambda x: -x.depth):
        if g.is_leaf:
            continue
        for dim_id, dim in dims.items():
            if dim_id in g.dims or not dim.summable or not dim.derive:
                continue
            got: list[str] = []
            missing: list[str] = []
            for cid in g.children:
                child = groups[cid]
                m = child.dims.get(dim_id)
                if m is None or m.is_bucket:
                    missing.append(cid)
                    continue
                got.extend(m.vars)
                missing.extend(m.missing_from_sum)
            if not got:
                continue
            if len(set(got)) != len(got):
                raise ConfigError(f"{g.id}/{dim_id}: children share a variable; roll-up would double count")
            g.dims[dim_id] = DimMapping(vars=sorted(got), derived=True, missing_from_sum=sorted(set(missing)))

    for g in groups.values():
        if g.default_dimension not in g.dims:
            raise ConfigError(f"{g.id}: default_dimension {g.default_dimension} has no mapping")
        if g.dims[g.default_dimension].is_bucket and g.id != "indo_caribbean":
            # a bucket default would make enclaves describe a broader population than the group
            raise ConfigError(f"{g.id}: default dimension is a bucket mapping")
        if not g.rationale:
            g.rationale = DEFAULT_RATIONALE[g.default_dimension]
    return groups


# --- cuisines -------------------------------------------------------------------------------------


@dataclass
class CuisineNode:
    id: str
    name: str
    parents: list[str]
    kind: str
    dohmh: list[str]
    osm: list[str]
    overture: list[str]


class CuisineGraph:
    def __init__(self, nodes: dict[str, CuisineNode]):
        self.nodes = nodes
        for n in nodes.values():
            for p in n.parents:
                if p not in nodes:
                    raise ConfigError(f"cuisine {n.id}: unknown parent {p}")
        self._check_acyclic()

    def _check_acyclic(self) -> None:
        state: dict[str, int] = {}

        def visit(nid: str) -> None:
            if state.get(nid) == 1:
                raise ConfigError(f"cuisine hierarchy has a cycle at {nid}")
            if state.get(nid) == 2:
                return
            state[nid] = 1
            for p in self.nodes[nid].parents:
                visit(p)
            state[nid] = 2

        for nid in self.nodes:
            visit(nid)

    def effective(self, nid: str) -> str:
        """Generic nodes behave as the root for hierarchy checks (§4.4)."""
        return "root" if self.nodes[nid].kind == "generic" else nid

    @cached_property
    def ancestors(self) -> dict[str, frozenset[str]]:
        memo: dict[str, frozenset[str]] = {}

        def anc(nid: str) -> frozenset[str]:
            if nid not in memo:
                s: set[str] = set()
                for p in self.nodes[nid].parents:
                    s.add(p)
                    s |= anc(p)
                memo[nid] = frozenset(s)
            return memo[nid]

        return {nid: anc(nid) for nid in self.nodes}

    def is_below(self, node: str, other: str) -> bool:
        """True if `node` is a strict descendant of `other` (after generic -> root)."""
        node, other = self.effective(node), self.effective(other)
        if node == other or node == "root":
            return False
        return other in self.ancestors[node]

    def related(self, a: str, b: str) -> bool:
        """Same node, or one is an ancestor of the other (compatible labels)."""
        a, b = self.effective(a), self.effective(b)
        return a == b or a in self.ancestors[b] or b in self.ancestors[a]

    def descendants(self, nid: str) -> set[str]:
        return {n for n, anc in self.ancestors.items() if nid in anc}

    def dohmh_map(self) -> dict[str, str]:
        out: dict[str, str] = {}
        for n in self.nodes.values():
            for v in n.dohmh:
                if v in out:
                    raise ConfigError(f"DOHMH value {v!r} mapped twice ({out[v]}, {n.id})")
                out[v] = n.id
        return out


def load_cuisines(config_dir: Path = CONFIG_DIR) -> CuisineGraph:
    raw = load_yaml("cuisines.yaml", config_dir)["nodes"]
    nodes: dict[str, CuisineNode] = {}
    for r in raw:
        nid = r["id"]
        if nid in nodes:
            raise ConfigError(f"duplicate cuisine id {nid}")
        nodes[nid] = CuisineNode(
            id=nid,
            name=r["name"],
            parents=list(r.get("parents", ["root"] if nid != "root" else [])),
            kind=r.get("kind", "cuisine"),
            dohmh=list(r.get("dohmh", [])),
            osm=list(r.get("osm", [])),
            overture=list(r.get("overture", [])),
        )
    return CuisineGraph(nodes)


def validate_pairings(groups: dict[str, Group], cuisines: CuisineGraph) -> dict[str, str]:
    """Check every pairing points at a real cuisine node; return cuisine -> group with an exact
    pairing (that group is the "broad group" used for bucket gap analysis, §8.2)."""
    exact_owner: dict[str, str] = {}
    for g in groups.values():
        for cid, kind in g.cuisines.items():
            if cid not in cuisines.nodes:
                raise ConfigError(f"group {g.id}: unknown cuisine {cid}")
            if kind not in ("exact", "bucket"):
                raise ConfigError(f"group {g.id}: pairing {cid} must be exact|bucket")
            if kind == "exact":
                if cid in exact_owner:
                    raise ConfigError(f"cuisine {cid} paired exact with {exact_owner[cid]} and {g.id}")
                exact_owner[cid] = g.id
    return exact_owner


@dataclass
class Config:
    dimensions: dict[str, Dimension]
    groups: dict[str, Group]
    cuisines: CuisineGraph
    exact_owner: dict[str, str]
    analysis: dict[str, Any]
    presets: dict[str, Any]


def load_config(config_dir: Path = CONFIG_DIR) -> Config:
    dims = load_dimensions(config_dir)
    groups = load_groups(dims, config_dir)
    cuisines = load_cuisines(config_dir)
    exact_owner = validate_pairings(groups, cuisines)
    return Config(
        dimensions=dims,
        groups=groups,
        cuisines=cuisines,
        exact_owner=exact_owner,
        analysis=load_yaml("analysis.yaml", config_dir),
        presets=load_yaml("presets.yaml", config_dir),
    )
