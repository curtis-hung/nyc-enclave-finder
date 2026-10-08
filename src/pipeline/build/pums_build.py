"""Diaspora detail from PUMS (§4.6): group definitions, cells per PUMA, gated measures.

Outputs (web/public/data/diaspora/):
- index.json: PUMA list (data-derived labels), tract -> PUMA, group definitions and measure sets,
  the citywide group profile and borough strips (already gated: reliable values only)
- puma/<code>.json: per group the raw cells [n, est, d_1..d_80] so the client can combine the
  PUMAs of any focus area from the microdata, plus detailed-language cells for the language fill
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from pipeline.analysis.pums_stats import born_abroad, born_pr_territory, born_us50, cell, ratio
from pipeline.build.demographics import AcsSnapshot, GroupDim
from pipeline.build.geography import Geography, InvariantError
from pipeline.build.writer import clean, sig_arr, write_json
from pipeline.config import Config, load_yaml
from pipeline.fetch.common import existing_snapshot, load_manifest
from pipeline.paths import REPO_ROOT, WEB_DATA_DIR

CELLS = ["T", "B50", "BPR", "BAB", "AREC", "AARR", "L5", "LEN", "LHER", "LOTH", "USB5", "USBH", "ESP", "EVW"]
# measure -> (numerator cell, denominator cell, measure family)
MEASURES = {
    "born_us50": ("B50", "T", "birthplace"),
    "born_pr": ("BPR", "T", "birthplace"),
    "born_abroad": ("BAB", "T", "birthplace"),
    "recent_arrival": ("AREC", "AARR", "arrival"),
    "heritage_lang": ("LHER", "L5", "language"),
    "english_only": ("LEN", "L5", "language"),
    "other_lang": ("LOTH", "L5", "language"),
    "heritage_usborn": ("USBH", "USB5", "heritage"),
    "english_very_well": ("EVW", "ESP", "english"),
}


def _norm(s: str) -> str:
    s = "".join(c for c in unicodedata.normalize("NFKD", str(s)) if not unicodedata.combining(c)).lower()
    s = re.sub(r"\balone\b", "", s)
    s = re.sub(r"/[a-z]{2}$", "", s)  # "New York/NY"
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


@dataclass
class Definition:
    group: str
    var: str
    description: str
    mask: np.ndarray
    families: list[str]
    heritage: list[int]
    pums_total: float = 0.0
    acs_total: float = 0.0
    notes: list[str] = field(default_factory=list)


class Pums:
    def __init__(self) -> None:
        e = existing_snapshot(load_manifest(), "pums")
        if not e:
            raise InvariantError("missing PUMS snapshot")
        self.entry = e
        paths = {p["path"].split("/")[-1]: REPO_ROOT / p["path"] for p in e["files"]}
        self.df = pd.read_parquet(paths["pums_persons_nyc.parquet"])
        dd = pd.read_csv(paths["pums_data_dictionary.csv"], header=None, dtype=str, names=list("abcdefg"))
        self.labels = {var: {r.e: r.g for r in dd[(dd.a == "VAL") & (dd.b == var)].itertuples()} for var in
                       ("RAC2P19", "RAC2P24", "HISP", "ANC1P", "POBP", "LANP")}
        rel = pd.read_csv(paths["tract_to_puma_2020.txt"], dtype=str, encoding="utf-8-sig")
        rel = rel[rel.STATEFP == "36"]
        self.tract_puma = dict(zip("36" + rel.COUNTYFP + rel.TRACTCE, rel.PUMA5CE))
        d = self.df
        self.year = d.SERIALNO.str[:4].astype(int).to_numpy()
        self.w = d[["PWGTP"] + [f"PWGTP{i}" for i in range(1, 81)]].to_numpy(dtype=float)
        self.puma = d.PUMA.astype(int).map(lambda x: f"{x:05d}").to_numpy()
        self.col = {c: d[c].fillna(-1).astype(int).to_numpy() for c in
                    ("AGEP", "RAC1P", "RAC2P19", "RAC2P24", "HISP", "ANC1P", "ANC2P", "POBP", "YOEP", "LANX", "LANP", "ENG")}

    def codes_by_label(self, var: str, label: str | list[str]) -> list[int]:
        """Exact (normalized) label match; falls back to the label without parentheticals or an
        'except ...' clause (e.g. "Dominican (Dominican Republic)" -> "Dominican")."""
        labels = label if isinstance(label, list) else [label]
        out: list[int] = []
        for lab in labels:
            for t in dict.fromkeys([_norm(lab), _norm(re.sub(r"\(.*?\)|,? except .*$", "", lab))]):
                hits = [int(k) for k, v in self.labels[var].items() if k.lstrip("-").isdigit() and _norm(v) == t]
                if hits:
                    out += hits
                    break
        return sorted(set(out))


def _leaf_label(label: str) -> str:
    return label.replace("Estimate!!", "").split("!!")[-1].rstrip(":")


def resolve_var_mask(p: Pums, dim: str, var: str, acs_label: str, overrides: dict[str, dict[str, str]],
                     table_labels: dict[str, str]) -> tuple[np.ndarray | None, str]:
    """Mask of persons counted by one ACS variable, using the PUMS variable of that dimension."""
    c = p.col
    line = int(var.split("_")[1])
    leaf = _leaf_label(acs_label)
    hisp = c["HISP"]
    if dim == "race":
        nh = hisp == 1
        rules = {3: [1], 4: [2], 5: [3, 4, 5], 6: [6], 7: [7], 8: [8], 9: [9]}
        if line == 12:
            return hisp > 1, "HISP != 1"
        if line in rules:
            return nh & np.isin(c["RAC1P"], rules[line]), f"RAC1P in {rules[line]} and HISP = 1"
        return None, ""
    if dim == "hispanic":
        if line == 3:
            return hisp > 1, "HISP != 1"
        if line in (8, 16):  # Central / South American subtotals: union of their child lines
            prefix = "Central American:" if line == 8 else "South American:"
            kids = [k for k, v in table_labels.items() if prefix in v and not v.rstrip().endswith(":")]
            codes = sorted({x for k in kids for x in p.codes_by_label("HISP", _leaf_label(table_labels[k]))})
            if line == 8:
                codes += p.codes_by_label("HISP", "Other Central American")
            else:
                codes += p.codes_by_label("HISP", "Other South American")
            return np.isin(hisp, codes), f"HISP in {sorted(set(codes))}"
        codes = p.codes_by_label("HISP", leaf)
        return (np.isin(hisp, codes), f"HISP in {codes}") if codes else (None, "")
    if dim == "asian":
        if line == 1:
            return c["RAC1P"] == 6, "RAC1P = 6 (Asian alone)"
        c19 = p.codes_by_label("RAC2P19", leaf)
        c24 = p.codes_by_label("RAC2P24", leaf)
        if not c19 or not c24:  # coded in only one year system: a partial-year count would mislead
            return None, f"no code in both RAC2P19/RAC2P24 for {leaf!r}"
        m = np.where(p.year < 2023, np.isin(c["RAC2P19"], c19), np.isin(c["RAC2P24"], c24))
        return m, f"RAC2P19 in {c19} (2020-22) / RAC2P24 in {c24} (2023-24)"
    if dim == "ancestry":
        if acs_label.rstrip().endswith(":"):  # subtotal: union of the child ancestries
            prefix = leaf + ":"
            kids = [v for v in table_labels.values() if prefix in v and not v.rstrip().endswith(":")]
            codes = sorted({x for v in kids for x in _anc_codes(p, _leaf_label(v), overrides)})
        else:
            codes = _anc_codes(p, leaf, overrides)
        if not codes:
            return None, ""
        return np.isin(c["ANC1P"], codes) | np.isin(c["ANC2P"], codes), f"ANC1P or ANC2P in {codes}"
    if dim == "birthplace":
        lab = overrides.get("birthplace", {}).get(_norm(leaf), leaf)
        codes = [x for x in p.codes_by_label("POBP", lab) if x >= 100]  # countries only, never US states

        return (np.isin(c["POBP"], codes), f"POBP in {codes}") if codes else (None, "")
    if dim == "language":
        return None, ""
    return None, ""


def _anc_codes(p: Pums, leaf: str, overrides: dict[str, dict[str, str]]) -> list[int]:
    lab = overrides.get("ancestry", {}).get(_norm(leaf), leaf)
    return p.codes_by_label("ANC1P", lab)


def build_definitions(cfg: Config, acs: AcsSnapshot, p: Pums, gds: dict[str, dict[str, GroupDim]]) -> tuple[dict[str, Definition], list[dict[str, Any]]]:
    pc = load_yaml("pums.yaml")
    overrides = pc.get("match_overrides", {})
    heritage = pc.get("heritage_languages", {})
    max_ratio = float(cfg.analysis["pums"]["max_total_ratio"])
    defs: dict[str, Definition] = {}
    log: list[dict[str, Any]] = []
    for gid, g in cfg.groups.items():
        dim = g.default_dimension
        m = g.dims[dim]
        table = acs.table(cfg.dimensions[dim].table)
        entry: dict[str, Any] = {"group": gid, "dimension": dim}
        if gid == "jewish":
            mask = p.col["LANP"] == 1130
            desc = "LANP = 1130 (Yiddish spoken at home), the user-directed proxy"
            fam = ["birthplace", "arrival"]
        else:
            masks, descs = [], []
            for v in m.vars:
                mk, d = resolve_var_mask(p, dim, v, table.labels[v], overrides, table.labels)
                if mk is None:
                    # a summed broad group keeps its matched parts (recorded); the total-ratio
                    # check below still rejects a definition that misses too much
                    descs.append(f"{v}: not included ({d or 'no PUMS code'})")
                    if len(m.vars) == 1:
                        masks = []
                        break
                    continue
                masks.append(mk)
                descs.append(f"{v}: {d}")
            if not masks:
                entry.update(status="no definition", detail="; ".join(descs))
                log.append(entry)
                continue
            mask = np.logical_or.reduce(masks)
            desc = "; ".join(descs)
            fam = ["birthplace", "arrival", "language", "heritage", "english"]
            if dim == "birthplace":
                fam = ["arrival", "language", "heritage", "english"]  # all born abroad by definition
        h = heritage.get(gid, [])
        if not h:
            fam = [f for f in fam if f not in ("heritage",)]
        tot = float(p.w[mask, 0].sum())
        acs_tot = gds[gid][dim].city_est
        ratio_ = tot / acs_tot if acs_tot else float("inf")
        entry.update(pums_total=round(tot), acs_total=round(acs_tot), ratio=round(ratio_, 3), definition=desc,
                     sampled=int(mask.sum()))
        if gid != "jewish" and not (1 / max_ratio <= ratio_ <= max_ratio):
            entry["status"] = f"rejected: PUMS/ACS total ratio {ratio_:.2f} outside 1/{max_ratio}-{max_ratio}"
            log.append(entry)
            continue
        entry["status"] = "ok"
        log.append(entry)
        defs[gid] = Definition(gid, dim, desc, mask, fam, h, tot, acs_tot)
    return defs, log


def group_cells_by_puma(p: Pums, d: Definition, pumas: list[str]) -> dict[str, dict[str, np.ndarray]]:
    """All cells of a group for every PUMA in one pass (cells add linearly, so borough and city
    cells are sums of PUMA cells)."""
    c = p.col
    idx = np.flatnonzero(d.mask)
    sub = {k: v[idx] for k, v in c.items()}
    year = p.year[idx]
    w = p.w[idx]
    pu = p.puma[idx]
    pobp, lanx, lanp = sub["POBP"], sub["LANX"], sub["LANP"]
    abroad = born_abroad(pobp)
    yoe_ok = sub["YOEP"] > 0
    l5 = (sub["AGEP"] >= 5) & (lanx > 0)
    other = l5 & (lanx == 1)
    her = other & np.isin(lanp, d.heritage) if d.heritage else np.zeros_like(other)
    us50 = born_us50(pobp)
    one = np.ones(len(idx), bool)
    sel = {
        "T": one, "B50": us50, "BPR": born_pr_territory(pobp), "BAB": abroad,
        "AREC": abroad & yoe_ok & ((year - sub["YOEP"]) < 10), "AARR": abroad & yoe_ok,
        "L5": l5, "LEN": l5 & (lanx == 2), "LHER": her, "LOTH": other & ~her,
        "USB5": us50 & l5, "USBH": us50 & her,
        "ESP": other, "EVW": other & (sub["ENG"] == 1),
    }
    pos = {code: i for i, code in enumerate(pumas)}
    gi = np.array([pos[x] for x in pu])
    out: dict[str, dict[str, np.ndarray]] = {code: {} for code in pumas}
    for name, m in sel.items():
        n = np.bincount(gi[m], minlength=len(pumas))
        sums = np.zeros((len(pumas), 81))
        np.add.at(sums, gi[m], w[m])
        for k, code in enumerate(pumas):
            out[code][name] = np.concatenate([[n[k]], [sums[k, 0]], sums[k, 1:] - sums[k, 0]])
    return out


def add_cells(cells: list[dict[str, np.ndarray]]) -> dict[str, np.ndarray]:
    return {k: np.sum([c[k] for c in cells], axis=0) for k in cells[0]}


def group_cells(p: Pums, d: Definition, rows: np.ndarray) -> dict[str, np.ndarray]:
    c = p.col
    m = d.mask & rows
    pobp, lanx, lanp = c["POBP"], c["LANX"], c["LANP"]
    abroad = born_abroad(pobp)
    yoe_ok = c["YOEP"] > 0
    recent = abroad & yoe_ok & ((p.year - c["YOEP"]) < 10)
    arrived = abroad & yoe_ok
    l5 = (c["AGEP"] >= 5) & (lanx > 0)
    other = l5 & (lanx == 1)
    her = other & np.isin(lanp, d.heritage) if d.heritage else np.zeros_like(other)
    us50 = born_us50(pobp)
    sel = {
        "T": m, "B50": m & us50, "BPR": m & born_pr_territory(pobp), "BAB": m & abroad,
        "AREC": m & recent, "AARR": m & arrived,
        "L5": m & l5, "LEN": m & l5 & (lanx == 2), "LHER": m & her, "LOTH": m & other & ~her,
        "USB5": m & us50 & l5, "USBH": m & us50 & her,
        "ESP": m & other, "EVW": m & other & (c["ENG"] == 1),
    }
    return {k: cell(v, p.w) for k, v in sel.items()}


def measures(cells: dict[str, np.ndarray], families: list[str], cv_max: float, min_n: int) -> dict[str, Any]:
    out = {}
    for name, (num, den, fam) in MEASURES.items():
        if fam not in families:
            continue
        r = ratio(cells[num], cells[den], cv_max, min_n)
        if r.shown:
            out[name] = sig_arr([r.value, r.se], 4)  # significant digits keep small shares' CV exact
    return out


def _pack(c: np.ndarray) -> list[int]:
    return [int(round(x)) for x in c]


def build_pums(cfg: Config, acs: AcsSnapshot, geo: Geography, gds: dict[str, dict[str, GroupDim]]) -> dict[str, Any]:
    p = Pums()
    defs, log = build_definitions(cfg, acs, p, gds)
    cv_max = float(cfg.analysis["pums"]["cv_max"])
    min_n = int(cfg.analysis["pums"]["min_unweighted"])
    pc = load_yaml("pums.yaml")

    # PUMA list and data-derived labels: borough + its two most populous NTAs
    tract_puma = [p.tract_puma.get(gid_) for gid_ in geo.tracts.geoid]
    missing = [g for g, pu in zip(geo.tracts.geoid, tract_puma) if pu is None]
    if missing:
        raise InvariantError(f"{len(missing)} tracts have no 2020 PUMA: {missing[:5]}")
    pumas = sorted(set(tract_puma))
    pop = gds["white"]["race"].levels["tract"].denom
    labels = {}
    for pu in pumas:
        idx = [i for i, x in enumerate(tract_puma) if x == pu]
        by_nta = Counter()
        for i in idx:
            by_nta[int(geo.tract_nta_idx[i])] += float(pop[i])
        top = [geo.ntas.name.iloc[k] for k, _ in by_nta.most_common(2)]
        boro = geo.boroughs.name.iloc[Counter(int(geo.tract_boro_idx[i]) for i in idx).most_common(1)[0][0]]
        labels[pu] = f"{boro}: {' · '.join(top)}"
    if set(pumas) != set(np.unique(p.puma)):
        raise InvariantError("PUMS PUMA codes do not match the 2020 tract-to-PUMA relationship file")

    boro_of_puma = {pu: Counter(geo.boroughs.boro.iloc[int(geo.tract_boro_idx[i])] for i, x in enumerate(tract_puma) if x == pu).most_common(1)[0][0] for pu in pumas}
    city: dict[str, Any] = {}
    boro: dict[str, dict[str, Any]] = {b: {} for b in geo.boroughs.boro}
    per_puma: dict[str, dict[str, Any]] = {pu: {"groups": {}} for pu in pumas}
    for gid, d in defs.items():
        by_puma = group_cells_by_puma(p, d, pumas)
        city[gid] = measures(add_cells(list(by_puma.values())), d.families, cv_max, min_n)
        for b in boro:
            mb = measures(add_cells([by_puma[pu] for pu in pumas if boro_of_puma[pu] == b]), d.families, cv_max, min_n)
            if mb:
                boro[b][gid] = mb
        for pu in pumas:
            cells = by_puma[pu]
            if cells["T"][0] > 0:
                per_puma[pu]["groups"][gid] = {k: _pack(v) for k, v in cells.items() if v[0] > 0}

    # detailed-language cells per PUMA (persons 5+), for the "who's here" language fill
    buckets = {int(k): v for k, v in pc["language_buckets"].items()}
    lang_codes = sorted({x for v in buckets.values() for x in v})
    l5 = (p.col["AGEP"] >= 5) & (p.col["LANX"] > 0)
    city_lang = {"L5": float(p.w[l5, 0].sum())}
    for code in lang_codes:
        city_lang[str(code)] = float(p.w[l5 & (p.col["LANP"] == code), 0].sum())
    for pu in pumas:
        rows = (p.puma == pu) & l5
        langs = {"L5": _pack(cell(rows, p.w))}
        for code in lang_codes:
            mk = rows & (p.col["LANP"] == code)
            if mk.any():
                langs[str(code)] = _pack(cell(mk, p.w))
        per_puma[pu]["languages"] = langs
        write_json(WEB_DATA_DIR / "diaspora" / "puma" / f"{pu}.json", per_puma[pu])

    lan_labels = {str(k): v for k, v in p.labels["LANP"].items() if k.isdigit()}
    write_json(WEB_DATA_DIR / "diaspora" / "index.json", {
        "vintage": p.entry["vintage"],
        "pumas": [{"code": pu, "label": labels[pu], "boro": boro_of_puma[pu]} for pu in pumas],
        "tract_puma": [pumas.index(x) for x in tract_puma],
        "cells": CELLS,
        "measures": {k: list(v) for k, v in MEASURES.items()},
        "rules": cfg.analysis["pums"],
        "groups": {gid: {"families": d.families, "heritage": [lan_labels.get(str(x), str(x)) for x in d.heritage],
                         "definition": d.description} for gid, d in defs.items()},
        "city": city,
        "boro": boro,
        "languages": {"buckets": {str(k): [str(x) for x in v] for k, v in buckets.items()},
                      "names": {str(c): lan_labels.get(str(c), str(c)) for c in lang_codes},
                      "city": {k: clean(v, 0) for k, v in city_lang.items()}},
    })
    return {"definitions": log, "groups_with_detail": len(defs),
            "groups_with_city_profile": sum(1 for v in city.values() if v)}
