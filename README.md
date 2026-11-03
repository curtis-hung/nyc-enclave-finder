# NYC Enclave Finder

A static, web-hostable interactive map of New York City that is half restaurant-finding tool,
half sociological experiment. For any ethnic or cultural group it shows **where the group
lives** (Census residence), **where its restaurants cluster** (DOHMH restaurant locations), and
**how those two patterns relate spatially** — with continuous measures, not conclusions.

> "Lives here" means census-measured residence. "Eats here" means restaurant location. Neither
> proves cultural identity, causality or neighborhood ownership.

`SPEC.md` is the authoritative build spec. Status lives in `PROGRESS.md`, design choices in
`DECISIONS.md`.

## Requirements

- [uv](https://docs.astral.sh/uv/) (Python 3.12 is installed automatically)
- Node.js 20+ and npm

Works on Windows, macOS and Linux; no Makefiles or shell-only scripts.

## Quick start (no data download needed)

Processed data for the frontend is committed under `web/public/data/`, so a fresh clone runs
immediately:

```
npm install
npm run dev        # http://localhost:5173
npm run build
npm run preview    # http://localhost:4173
```

## Data pipeline

```
uv sync
uv run pipeline fetch            # download source snapshots into data/raw/ (skips existing)
uv run pipeline fetch --refresh  # re-download (census stays at its pinned vintage)
uv run pipeline fetch --refresh --upgrade-vintages  # also move census data to the latest vintage
uv run pipeline build            # deterministic build from local snapshots -> web/public/data/
```

`CENSUS_API_KEY` is used if set in the environment; nothing depends on it.

## Tests

```
uv run pytest            # unit + synthetic fixtures + data invariants
npm test                 # frontend unit tests (Vitest)
npx playwright install chromium
npm run test:e2e         # end-to-end journeys (Playwright)
```

## Using the map

Pick a group to see where it lives (blue, by location quotient), its residential enclaves
(orange outlines) and its paired cuisine's restaurant clusters (violet outlines; restaurants in
red). Click any tract or neighbourhood to see who's over-represented there; focus a neighbourhood,
borough, place or radius pin for area statistics; open **Experiment view** for the gap table and
scatter. **Find food** suggests candidate restaurants for the selected cuisine: near you, around a
focused area, in an enclave or off the beaten path. **About & methods** in the panel explains everything below in plain language. All view
state lives in the URL hash, so any view can be shared.

## Data refresh

```
uv run pipeline fetch --refresh   # new snapshots (records vintages in data/manifest.json)
uv run pipeline build             # rebuild web/public/data/ (prints a size report)
uv run pipeline report            # regenerate docs/TAXONOMY.md, OBSERVATIONS.md, CUISINES.md, PUMS.md
uv run pytest && npm test && npm run test:e2e
```

Sources: ACS 2020–2024 5-year detailed tables and PUMS (U.S. Census Bureau), NYC DCP 2020 tracts,
NTAs and boroughs, DOHMH restaurant inspections, OpenStreetMap and Overture Maps Places. Exact
snapshot dates are in `data/manifest.json` and the About page. Live site: https://curtis-hung.github.io/nyc-enclave-finder/ (deploys on every push to `main`).
Data refreshes automatically each month; see `DEPLOY.md` §4.

## Metrics

All thresholds live in `config/` (`analysis.yaml`, `presets.yaml`, `restaurants.yaml`,
`pums.yaml`); design rationale is in `DECISIONS.md`.

- **Location quotient (LQ)** = group's share of the unit's denominator ÷ group's share citywide
  (or borough-wide with the borough reference toggle). Shares always use the dimension's own
  universe (e.g. language: people 5+; birthplace: foreign-born). LQ is suppressed when the unit's
  denominator is below 50 or the group's citywide count below 200. Map classes: < 0.5, 0.5–1,
  then 1 / 1.5 / 2 / 3 / 4 / 6 / 10 / 20+.
- **Data states** from the ACS margin of error (CV = MOE / 1.645 / estimate): *reliable*
  CV ≤ 0.30; *caution* ≤ 0.60 (≤ 0.80 on tract maps); *suppressed* above that; *unavailable*
  when the Census publishes no value; *zero* for a real zero estimate. Each has its own texture;
  missing never looks like zero. Groups where < 50% of residents are in usable tracts are
  analysed by NTA.
- **Who's here** lists every group with LQ > 1 in a reliable/caution state, ranked by LQ, plus the
  largest groups by share; no single winner.
- **Area statistics**: NTA and borough values are exact tract sums (MOEs combined in
  quadrature); radius values are area-weighted from intersected tracts and labelled approximate.
- **Enclaves**: units with LQ ≥ `lq_min`, count ≥ `count_min`, an allowed data state and
  CV ≤ `cv_max`; rook-adjacent units merge; the enclave must hold ≥ `min_enclave_pop` residents.
- **Restaurant labels**: DOHMH cuisine is the primary label; inferred tags from OSM, Overture and
  name keywords sit below it in the cuisine DAG with derived confidence (high = 2+ independent
  sources, medium = one map source, low = keyword only); disagreements are conflicts, never used.
  Businesses whose normalized name appears at ≥ 7 locations are flagged multi-location and
  excluded by default.
- **Restaurant clusters**: per cuisine, DBSCAN (`eps_ft`, `min_samples`) seeded only where the
  cuisine is locally over-represented; a cluster of ≥ `min_cluster_size` restaurants qualifies
  when its **catchment cuisine LQ** (cuisine's share of all restaurants within the footprint +
  `catchment_ft`, ÷ citywide share) ≥ `lq_min`, or when the cuisine's catchment share ≥
  `ref + gap_min × (1 − ref)` (the "share gap" rule for very common cuisines).
- **Gap measures** per cluster × paired group: polygon distance to the 1st/2nd/3rd nearest
  enclave (null when the group has no enclave), signed edge distance from the cluster centre
  (negative = inside an enclave), overlap area and percentages, the group's residential LQ in the
  catchment, and the share of the group's citywide residents within 0.5 / 1 / 2 / 5 miles.
- **Presets**: strict / default / loose sets of the enclave and cluster thresholds above, all
  precomputed.
- **Diaspora detail** (PUMS): nativity (US-born, born in Puerto Rico/territories, foreign-born by
  arrival period) and language at home for the PUMA district around an area; a cell is shown only
  with ≥ 30 sampled people and CV ≤ 0.30 (successive-difference replicate weights).
- **Diversity index**: normalized Shannon entropy over the eight race/Hispanic-origin categories,
  0 (one group) to 1 (perfectly even).

## Repository layout

- `config/` — every taxonomy, mapping and threshold
- `src/pipeline/` — fetch, analysis and build (Python, `uv`)
- `web/` — the static site (Vite, TypeScript, Preact, MapLibre); `web/public/data/` holds the
  committed processed data
- `tests/` (pytest), `web/src/*.test.ts` (Vitest), `e2e/` (Playwright journeys J1–J5)
- `docs/` — generated reports and screenshots
