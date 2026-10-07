# Progress

Status of the build against `SPEC.md` §16. Updated at every milestone boundary.

## Milestones

- [x] M0 Scaffold
- [x] M1 Fetch + provenance
- [ ] M2 Demographic build + taxonomy **[CHECKPOINT]**
- [ ] M3 Basemap + group focus
- [ ] M4 "Who's here?"
- [ ] M5 Area focus **[CHECKPOINT]**
- [ ] M6 Restaurants + labels + clusters
- [ ] M7 Gaps + presets **[CHECKPOINT]**
- [ ] M8 Remaining SHOULD / STRETCH
- [ ] M9 Finish

## Current status

**M1 complete.** Next: M2 (demographic build + taxonomy, then checkpoint).

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

## Cuts

None.

## Payload sizes

Not measured yet.

## Blockers

None.
