# Progress

Status of the build against `SPEC.md` §16. Updated at every milestone boundary.

## Milestones

- [x] M0 Scaffold
- [x] M1 Fetch + provenance
- [x] M2 Demographic build + taxonomy **[CHECKPOINT]** (reviewed; changes in D12)
- [ ] M3 Basemap + group focus
- [ ] M4 "Who's here?"
- [ ] M5 Area focus **[CHECKPOINT]**
- [ ] M6 Restaurants + labels + clusters
- [ ] M7 Gaps + presets **[CHECKPOINT]**
- [ ] M8 Remaining SHOULD / STRETCH
- [ ] M9 Finish

## Current status

**M2 checkpoint reviewed.** Taxonomy changes applied (D12): Indo-Caribbean removed, Sikh merged
into Indian, Jewish added as a Yiddish-language proxy group. PUMS proposal pending (QUESTIONS Q1).
Next: M3 (basemap + group focus).

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

## Cuts

None.

## Payload sizes

M2 build: 273 files, 12.8 MB raw / 1.93 MB gzip in total (all lazy except geometry + meta).
Tract geometry 215 KB gzip; NTA 92 KB; boroughs 43 KB; each group×dimension bundle ≤ 21 KB gzip.

## Blockers

None.
