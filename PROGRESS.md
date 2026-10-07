# Progress

Status of the build against `SPEC.md` §16. Updated at every milestone boundary.

## Milestones

- [x] M0 Scaffold
- [x] M1 Fetch + provenance
- [x] M2 Demographic build + taxonomy **[CHECKPOINT]** (reviewed; changes in D12)
- [x] M3 Basemap + group focus
- [x] M4 "Who's here?"
- [ ] M5 Area focus **[CHECKPOINT]**
- [ ] M6 Restaurants + labels + clusters
- [ ] M7 Gaps + presets **[CHECKPOINT]**
- [ ] M8 Remaining SHOULD / STRETCH
- [ ] M9 Finish

## Current status

**M4 complete.** Next: M5 (area focus, then checkpoint).

## Completed work

### M0 Scaffold
- Python pipeline package `src/pipeline` managed by `uv` (`uv run pipeline fetch|build`), pytest.
- Frontend: Vite + TypeScript + MapLibre GL (+ Turf) rooted at `web/`, Vitest for unit tests,
  Playwright for E2E (runs against `vite preview` of the production build) with desktop,
  mobile and screenshot projects.
- State files: `PROGRESS.md`, `DECISIONS.md`, `QUESTIONS.md`; README skeleton; `.gitignore`
  excludes raw/interim data.

### M1 Fetch + provenance
- `uv run pipeline fetch [--refresh] [--only ids...]`, idempotent (skips sources whose manifest
  files exist). Provenance in `data/manifest.json` (committed): URL/id, resolved vintage or
  snapshot date, fetch timestamp, per-file rows/bytes/SHA-256, source metadata.
- Snapshots (2026-10-07 fetch):
  - ACS 5-year **2020-2024** (latest on the API): B01003, B03002, B03001, B02015, B04006,
    B05006, C16001 at tract + county level. **B16001 (detailed language) is null at tract level**
    and is recorded as unavailable; language is the 12-category C16001 bucket table.
  - NYC DCP geography: 2020 tracts clipped (2,325) and water-included (2,327), 262 NTAs,
    5 boroughs, tract-to-NTA equivalency (2,327 rows).
  - DOHMH inspections: 296,270 rows, 31,469 CAMIS (source updated 2026-10-06).
  - OSM (Overpass, base 2026-10-07): 15,271 eating places + 2,876 places of worship.
  - Overture Places 2026-09-23.1: 70,777 food & drink places in the NYC bbox.
- ACS no-key fallback (table-based Summary File) verified identical to the API for B01003.

### M2 Demographic build + taxonomy
- Config: `config/dimensions.yaml` (6 dimensions, one ACS table each, explicit denominators and
  universes), `config/groups.yaml` (144 groups, 482 variable references), `config/cuisines.yaml`
  (125-node cuisine DAG; all 90 DOHMH cuisine values mapped), `config/analysis.yaml` (data-state
  rules), `config/presets.yaml` (enclave thresholds; cluster/catchment thresholds added at M6/M7).
- `uv run pipeline build`: validated geography (tract→NTA→borough, rook adjacency on unclipped
  geometry), group×dimension values at tract/NTA/borough/city with MOEs, shares, LQs and data
  states; hard invariants; plausibility checks; deterministic assets in `web/public/data/`.
- `uv run pipeline report`: generated `docs/TAXONOMY.md` + review figure.
- Plausibility (warn-only): 5/5 residential checks pass (Brighton Beach Slavic language rank 1,
  Russian ancestry rank 1, Washington Heights Dominican rank 3, Flushing Chinese rank 1, Borough
  Park West Germanic language rank 2). Korean cuisine check runs at M6.
- Tests: 43 passing (unit, synthetic ranking, built-data invariants).

### M3 Basemap + group focus
- Enclaves (§6): threshold + connected components over rook adjacency at the group×dimension's
  analysis level (tract, or NTA when sparse). Scope: default dimension × all three presets (MUST)
  and other dimensions × default preset (SHOULD). Default-dimension enclaves: strict 455,
  default 1,646, loose 2,733. Bundles `web/public/data/enclaves/<group>.json` (≤ 93 KB gzip).
- Frontend (Vite + TS + Preact + MapLibre): OpenFreeMap Positron basemap (no key) with a blank
  fallback; searchable hierarchical group picker; dimension switcher (all six shown, "no data"
  disabled, bucket badges, default marked); LQ / % share / count; tract / NTA units with the
  sparse-data notice; data states as textures (dots = caution, hatch = suppressed, cross =
  unavailable, pale = zero); enclave fill + outline with a zoomable enclave table; preset
  switcher under Advanced; hover tooltip with estimate ± MOE and state; URL hash state; mobile
  bottom sheet with an on-map mini legend.
- Commercial cluster outline layer is wired but empty until M6 provides clusters.
- Tests: pytest 49, Vitest 8, Playwright 11 (desktop + mobile). Screenshots:
  `docs/screenshots/m3-*.png`.

### M4 "Who's here?"
- Build: `whoshere/{tract,nta,boro}.json` — for every unit and dimension, all over-represented
  candidates (LQ > 1, reliable/caution) ranked by LQ (top 10) plus the largest by share (top 6),
  with share, LQ, count ± MOE and state. Candidates are the finest groups with an exact mapping
  in the dimension (no parent/child duplicates); language ranks its 12 Census categories,
  labelled as language buckets. Tract 421 KB gzip, NTA 103 KB, borough 3 KB (lazy).
- UI: click any tract/NTA (or a borough button) → right panel (bottom sheet on phones) with
  breadcrumbs tract → NTA → borough, six dimension sections, caution badges, group links that
  select the group; selected unit outlined; URL `a=` holds the selection.
- Cuisine over-representation in "Who's here" is added in M6 when restaurant data exists.
- Tests: pytest 50, Vitest 11, Playwright 15. Screenshots `docs/screenshots/m4-*.png`.

## Cuts

None.

## Payload sizes

M3: app JS 293 KB gzip + CSS 13 KB; first-load data (meta, groups, tract/NTA/borough geometry)
≈ 0.4 MB gzip. Lazy bundles: group×dimension ≤ 21 KB gzip; enclaves per group ≤ 93 KB gzip.
Processed data total 22.8 MB raw / 3.96 MB gzip.

## Blockers

None.
