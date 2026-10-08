# Progress

Status of the build against `SPEC.md` §16. Updated at every milestone boundary.

## Milestones

- [x] M0 Scaffold
- [x] M1 Fetch + provenance
- [x] M2 Demographic build + taxonomy **[CHECKPOINT]** (reviewed; changes in D12)
- [x] M3 Basemap + group focus
- [x] M4 "Who's here?"
- [x] M5 Area focus **[CHECKPOINT]** (reviewed; changes in D20–D21)
- [x] M6 Restaurants + labels + clusters
- [x] M7 Gaps + presets **[CHECKPOINT]** (reviewed; changes in D26-D30)
- [x] M8 Remaining SHOULD / STRETCH
- [x] M9 Finish

## Current status

**M7 checkpoint feedback applied** (D26-D30): seeded clustering fixes DBSCAN chaining, signed edge
distance, 8-class LQ scale (from the other session's spec update, applied late), multi-location
threshold 7, overlay toggle, click-to-deselect, hide/show panels; round 2 (D31-D32): share-gap
cluster rule (Chinatown in Asian clusters), red restaurants, hover info, context follows cluster.
**M8 complete** (D33-D38). **M9 complete** (D39-D40): all milestones done. Nothing has been
pushed or published; deployment is prepared in `.github/workflows/` and `DEPLOY.md`.

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

### M5 Area focus
- Focus modes: neighborhood (grouped select or map click at NTA level), borough (buttons),
  radius (drop a pin, draggable, 0.1–3 mi slider) and 24 gazetteer presets
  (`config/gazetteer.yaml`, navigation only). Inverse mask greys out the rest of the city; the
  map fits the area clear of both panels; URL `a=` holds n:/b:/r:lat,lon,mi.
- Stats panel: exact NTA/borough tract sums (precomputed) or radius area-weighted interpolation
  (client-side, labelled approximate, approximate MOEs); per dimension the over-represented list
  (by LQ) and the largest groups (by share); enclaves of the selected group intersecting the area.
- Drill-down (SHOULD): tract-level SVG small multiples for the selected group plus the area's six
  most over-represented groups, with the map's colour scale and state textures.
- Pipeline adds `matrix/<dim>.json` (tract estimates/MOEs per candidate, 38–161 KB gzip each),
  tract land areas and `gazetteer.json`. TS port of the data-state rules with parity tests.
- Restaurant list, over-represented cuisines and intersecting clusters arrive with M6.
- Tests: pytest 50, Vitest 20, Playwright 21. Screenshots `docs/screenshots/m5-*.png`.

### M6 Restaurants + labels + clusters
- DOHMH backbone: 296,270 rows / 31,469 CAMIS → 30,300 retained (802 without valid coordinates,
  356 inactive = no inspection in 3 years, 11 outside NYC tracts); one record per CAMIS by a
  deterministic newest-inspection rule; coordinate parse rate 97.5%; all 90 cuisine values mapped.
- Multi-location heuristic (normalized name at ≥ 5 active locations): 5,015 establishments /
  330 names flagged, hidden by default. Analysis population (inspected, not flagged): 21,905.
- Enrichment: OSM (33.4% of establishments matched), Overture (60.6%), 1,535 name-keyword hits;
  one-to-one name+distance (75 m) matching. Tags: 751 high, 1,418 medium, 260 low; 1,765
  conflicts on 1,404 restaurants (shown only under "Other sources say…").
- Clusters: DBSCAN per paired cuisine node (102 nodes) per preset — strict 120, default 416,
  loose 641 — qualified by non-circular catchment cuisine LQ; tag-based clusters report tag
  coverage. Korean-cuisine plausibility passes (Midtown South rank 3; a default Korean cluster
  covers W 32nd St).
- UI: cuisine filter (hierarchy) + tag-confidence selector (default medium+) + multi-location
  toggle; heatmap at low zoom, points at high zoom (hollow = inferred-tag-only match); paired-
  cuisine chips; cluster table and outlines (catchment on selection); restaurant card (DOHMH
  label, inferred tag chips with confidence/sources, collapsed conflicts, Google Maps search
  link); area panel adds over-represented cuisines, the selected cuisine's clusters and a
  filtered restaurant list. J1 passes end to end.
- Tests: pytest 79, Vitest 26, Playwright 28.

### M7 Gaps + presets
- Gap measures (§8) for every cluster × declared pairing, per preset, scoped per §5.2 (default
  dimension × all presets; other dimensions × default preset): 1st/2nd/3rd nearest-enclave
  polygon distances (null when no enclave), intersection area, % of cluster in enclaves, % of
  nearest enclave in cluster, the enclave group's residential LQ/count/state in the catchment
  (area-weighted), and the share of its citywide residents within 0.5/1/2/5 mi. Bucket pairings
  are measured against the cuisine's exact-owner broad group (§8.2). 15,121 rows; 7 null.
- Bucket context (§8.3, SHOULD, built now because J3 uses it): leaf groups under the bucket in
  the catchment, with the exact required label; display only.
- Experiment view (§9.4): bottom drawer with a sortable gaps table (nulls last, bucket rows
  badged, distance-decay sparklines), scatter (x distance, y residential LQ log scale, size =
  restaurants, separate "no enclave" strip; hover highlights, click focuses); row click focuses
  the cluster with its nearest enclave. URL `x=1`.
- Presets (§11): strict/default/loose precomputed for enclaves, clusters and gaps; switcher under
  Advanced, in the URL.
- `docs/OBSERVATIONS.md` (§13.8) and `docs/CUISINES.md` generated by `uv run pipeline report`.
- Vocabulary fix from the spot-check: DOHMH "Creole/Cajun" → Creole bucket (Haitian or Louisiana).
- Tests: pytest 85, Vitest 26, Playwright 31 — J1, J2, J3, J4 all pass.

### M8 Remaining SHOULD / STRETCH
- SHOULD #1, #2, #4-#7 were built in earlier milestones (enrichment, scatter, bucket context,
  drill-down, gazetteer, non-default-dimension enclaves/gaps).
- SHOULD #3 diaspora detail from PUMS: 134 groups with a definition, 126 with a reliable citywide
  profile; group profile, "who's here" strips, detailed-language fill, cluster residential context;
  J5 passes. Generated `docs/PUMS.md`.
- SHOULD #8 borough reference toggle, #9 connector lines, #10 diversity layer, #11 compare mode.
- STRETCH #1 Places of Worship built; #2 population-weighted interpolation and #3 live sliders cut.
- Tests: pytest 101, Vitest 32, Playwright 43 (J1-J5 all pass).

### M9 Finish
- About & methods dialog (§10), linked from the panel header and footer, URL `ab=1`: the §1
  statement verbatim, every §2 principle, sources with snapshot dates (read from `meta.json`),
  the cuisine label model, enclave and cluster detection (non-circular cuisine LQ, seeding,
  share-gap rule), gap measures, presets with their parameters (from `meta.json`), why radius
  values are approximate, multi-location limits, diaspora detail, diversity, the Yiddish proxy
  and Places of Worship coverage.
- Accessibility basics: visible keyboard focus on every control, dialog semantics with focus on
  open and Escape to close, reduced-motion support; existing labelled regions/groups kept.
- Deploy prep (§14, not executed): `.github/workflows/deploy.yml` (tests + Pages deploy, base
  path from Pages or the `VITE_BASE` variable), `.github/workflows/refresh-data.yml` (manual
  only, cron commented, fetch → build → report → full suite → PR on a new branch),
  `DEPLOY.md`.
- README: run, fetch, build, refresh, tests and every major metric.
- Final screenshots `docs/screenshots/m9-*.png` (desktop + mobile, incl. the About page).
- Tests: pytest 101, Vitest 32, Playwright 46 (desktop + mobile; J1-J5 pass).

## Cuts

- STRETCH #2 population-weighted radius interpolation — needs block-level population; radius
  values stay area-weighted and labelled approximate (D38).
- STRETCH #3 live threshold sliders — the three precomputed presets provide the sensitivity
  analysis (D38).
- No MUST or SHOULD item was cut.

## Payload sizes

**Final (M9)** — targets met:
- First load: app JS 310 KB gzip + MapLibre worker 140 KB + CSS 14 KB; data (meta, groups,
  geometry for tracts/NTAs/boroughs, cuisines, restaurant points, diaspora index, gazetteer)
  667 KB gzip → **≈ 1.13 MB gzip** (target < 5 MB; basemap tiles come from OpenFreeMap).
- Largest lazy bundle: `whoshere/tract.json` **625 KB gzip** (target < 1 MB); next
  `matrix/birthplace.json` 161 KB, the largest PUMA diaspora file 124 KB. Restaurant details load
  on demand per neighbourhood (NTA).
- All processed data: 1,013 files, 13 MB gzip (68 MB raw) in `web/public/data/`.

M7: app JS 313 KB gzip + CSS 14 KB; first-load data (meta, groups, geometry, cuisines,
restaurant points, gazetteer) 639 KB gzip → first load ≈ 1.0 MB gzip (target < 5 MB). Largest
lazy bundle: who's-here tract file 626 KB gzip (target < 1 MB). All processed data: 955 files,
7.7 MB gzip. Lazy bundles: group×dimension ≤ 21 KB gzip; enclaves per group ≤ 93 KB gzip.
Processed data total 22.8 MB raw / 3.96 MB gzip.

## Blockers

None.
