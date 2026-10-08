"""`uv run pipeline build`: deterministic build from local snapshots into web/public/data/ (§3.1)."""

from __future__ import annotations

import json
import shutil
import time
from typing import Any

import numpy as np

from pipeline.analysis.stats import STATE_NAMES
from pipeline.build import checks
from pipeline.build.demographics import AcsSnapshot, GroupDim, build_denominators, build_group_dims
from pipeline.build.enclaves_build import EnclaveGeometry, build_enclaves, write_enclaves
from pipeline.build.geography import Geography, load_geography
from pipeline.build.matrix import tract_land_areas, write_gazetteer, write_matrices
from pipeline.build.whoshere import build_candidates, write_whoshere
from pipeline.build.writer import arr, fmt_kb, sig_arr, simplify_for_display, size_report, write_geojson, write_json
from pipeline.config import Config, load_config
from pipeline.fetch.common import load_manifest
from pipeline.paths import LOG_DIR, REPO_ROOT, WEB_DATA_DIR

LEVELS = ("tract", "nta", "boro")


def _log(msg: str) -> None:
    print(msg, flush=True)


def _sources_meta() -> dict[str, Any]:
    m = load_manifest()["sources"]
    keep = ("name", "publisher", "vintage", "fetched_at", "source_url", "license", "rows_updated_at", "method")
    return {sid: {k: e[k] for k in keep if k in e} for sid, e in m.items()}


def write_geography(geo: Geography) -> None:
    tr = geo.tracts.copy()
    tr["i"] = range(len(tr))
    write_geojson(WEB_DATA_DIR / "geo" / "tracts.json", simplify_for_display(tr, 12), ["i", "geoid", "nta", "boro", "label"])
    nt = geo.ntas.copy()
    nt["i"] = range(len(nt))
    write_geojson(WEB_DATA_DIR / "geo" / "ntas.json", simplify_for_display(nt, 25), ["i", "nta", "name", "boro", "ntatype"])
    bo = geo.boroughs.copy()
    bo["i"] = range(len(bo))
    write_geojson(WEB_DATA_DIR / "geo" / "boroughs.json", simplify_for_display(bo, 40), ["i", "boro", "name"])


def group_dim_meta(cfg: Config, gd: GroupDim, labels: dict[str, str]) -> dict[str, Any]:
    return {
        "vars": gd.vars,
        "labels": [labels[v].replace("Estimate!!", "").replace("Total:!!", "").rstrip(":") for v in gd.vars],
        "bucket": gd.bucket,
        "derived": gd.derived,
        "missing_from_sum": gd.missing_from_sum,
        "city": {"e": round(gd.city_est), "m": arr([gd.city_moe], 0)[0], "share": sig_arr([gd.city_share], 4)[0]},
        "level": gd.recommended_level,
        "usable_share_tract": round(gd.usable_share_tract, 3),
        "sparse_citywide": gd.sparse_citywide,
    }


def write_groups(cfg: Config, acs: AcsSnapshot, gds: dict[str, dict[str, GroupDim]]) -> None:
    labels: dict[str, str] = {}
    for dim in cfg.dimensions.values():
        labels.update(acs.table(dim.table).labels)
    out = {"roots": [g.id for g in cfg.groups.values() if g.parent is None], "groups": {}}
    for gid, g in cfg.groups.items():
        out["groups"][gid] = {
            "id": gid,
            "name": g.name,
            "parent": g.parent,
            "children": g.children,
            "default_dimension": g.default_dimension,
            "rationale": g.rationale,
            "proxy": g.proxy,
            "cuisines": g.cuisines,
            "dims": {d: group_dim_meta(cfg, gds[gid][d], labels) for d in cfg.dimensions if d in gds[gid]},
        }
        for dim_id, gd in gds[gid].items():
            payload = {}
            for lvl in LEVELS:
                lv = gd.levels[lvl]
                payload[lvl] = {
                    "e": arr(lv.est, 0),
                    "m": arr(lv.moe, 0),
                    "s": sig_arr(lv.share, 3),
                    "lq": sig_arr(lv.lq, 3),
                    "st": [int(x) for x in lv.state],
                }
            write_json(WEB_DATA_DIR / "demo" / gid / f"{dim_id}.json", payload)
    write_json(WEB_DATA_DIR / "groups.json", out)


def write_meta(cfg: Config, acs: AcsSnapshot, geo: Geography, den) -> None:
    meta = {
        "sources": _sources_meta(),
        "acs_vintage": acs.vintage,
        "dimensions": {
            d.id: {
                "name": d.name, "short": d.short, "table": d.table, "numerator_universe": d.numerator_universe,
                "denominator": d.denominator, "share_of": d.share_of, "summable": d.summable, "note": d.note,
                "city_denominator": round(den.city[d.id]),
            }
            for d in cfg.dimensions.values()
        },
        "states": [STATE_NAMES[i] for i in range(5)],
        "analysis": cfg.analysis,
        "presets": cfg.presets,
        "levels": {"tract": geo.n_tracts, "nta": len(geo.ntas), "boro": len(geo.boroughs)},
        "ntas": [{"i": i, "code": r.nta, "name": r.name, "boro": r.boro, "type": r.ntatype}
                 for i, r in enumerate(geo.ntas.itertuples())],
        "boroughs": [{"i": i, "code": r.boro, "name": r.name} for i, r in enumerate(geo.boroughs.itertuples())],
        "tract_geoids": list(geo.tracts.geoid),
        "tract_labels": list(geo.tracts.label),
        "tract_area_sqmi": tract_land_areas(geo),
        "tract_nta": [int(x) for x in geo.tract_nta_idx],
        "tract_boro": [int(x) for x in geo.tract_boro_idx],
    }
    write_json(WEB_DATA_DIR / "meta.json", meta)
    write_json(WEB_DATA_DIR / "denominators.json",
               {d: {lvl: arr(den.est[d][lvl], 0) for lvl in LEVELS} for d in cfg.dimensions})


def run_build() -> int:
    t0 = time.time()
    _log("[build] loading configuration and snapshots")
    cfg = load_config()
    acs = AcsSnapshot()
    n_vars = checks.check_variables_exist(cfg, acs)
    _log(f"  crosswalk: {len(cfg.groups)} groups, {n_vars} variable references, all present in ACS {acs.vintage}")

    geo = load_geography(acs.table("B01003").geoids)
    d = geo.diagnostics
    _log(f"  geography: {geo.n_tracts} tracts, {len(geo.ntas)} NTAs, {len(geo.boroughs)} boroughs; "
         f"{d['tract_adjacency_edges']} tract adjacencies; water-only tracts {d['tracts_without_land_geometry']}; "
         f"cross-borough NTA assignments {d['tracts_in_nta_of_other_borough']}")

    den = build_denominators(cfg, acs, geo)
    gds = build_group_dims(cfg, acs, geo, den)
    recon = checks.check_reconciliation(cfg, acs, geo, den)
    outc = checks.check_group_outputs(cfg, geo, gds)
    _log(f"  invariants passed: borough reconciliation for {len(cfg.dimensions)} dimensions; {outc}")

    plaus = checks.run_plausibility(cfg, acs, geo, den)
    for p in plaus:
        flag = "PASS" if p["passed"] else "WARN"
        _log(f"  plausibility {flag}: {p['description']}: {p['nta_name']} rank {p['nta_rank']}/{p['ntas_ranked']} "
             f"(LQ {p['nta_lq']}); top: {', '.join(t['nta'] for t in p['top_3'])}")

    eg = EnclaveGeometry(geo)
    enclaves = build_enclaves(cfg, geo, gds, eg)
    n_enc = {p: sum(1 for recs in enclaves.values() for r in recs
                    if r.preset == p and r.dim == cfg.groups[r.group].default_dimension) for p in cfg.presets["presets"]}
    _log(f"  enclaves on default dimensions by preset: {n_enc}; "
         f"groups with none (default preset): {sum(1 for g, recs in enclaves.items() if not any(r.preset == 'default' and r.dim == cfg.groups[g].default_dimension for r in recs))}")

    _log("[build] writing assets")
    for sub in ("demo", "geo", "enclaves", "whoshere", "matrix"):
        shutil.rmtree(WEB_DATA_DIR / sub, ignore_errors=True)
    write_geography(geo)
    write_meta(cfg, acs, geo, den)
    write_groups(cfg, acs, gds)
    write_enclaves(enclaves)
    cands = build_candidates(cfg, acs, geo, den, gds)
    wh = write_whoshere(cfg, geo, cands)
    write_matrices(cands)
    places = write_gazetteer(set(cfg.groups))
    _log(f"  gazetteer: {len(places)} navigation presets")
    _log(f"  who's here: candidates per dimension {({d: len(c) for d, c in cands.items()})}; ranked rows {wh}")

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log = {
        "geography": {k: v for k, v in d.items()},
        "reconciliation": recon,
        "outputs": outc,
        "plausibility": plaus,
        "group_dims": {
            gid: {dim: {"city_est": round(gd.city_est), "level": gd.recommended_level,
                        "usable_share_tract": round(gd.usable_share_tract, 3),
                        "states_tract": np.bincount(gd.levels["tract"].state, minlength=5).tolist(),
                        "states_nta": np.bincount(gd.levels["nta"].state, minlength=5).tolist()}
                  for dim, gd in dims.items()}
            for gid, dims in gds.items()
        },
    }
    (LOG_DIR / "build_log.json").write_text(json.dumps(log, indent=1, default=str), encoding="utf-8")

    rep = size_report()
    (LOG_DIR / "size_report.json").write_text(json.dumps(rep, indent=1), encoding="utf-8")
    big = sorted(rep["files"], key=lambda f: -f["gzip"])[:6]
    _log(f"[size] {len(rep['files'])} files, {fmt_kb(rep['total_bytes'])} raw / {fmt_kb(rep['total_gzip'])} gzip total")
    for f in big:
        _log(f"  {f['path'].replace('web/public/data/', '')}: {fmt_kb(f['bytes'])} raw, {fmt_kb(f['gzip'])} gzip")
    _log(f"[build] done in {time.time() - t0:.1f}s -> {WEB_DATA_DIR.relative_to(REPO_ROOT).as_posix()}")
    return 0
