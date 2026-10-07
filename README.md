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
uv run pipeline fetch --refresh  # re-resolve "latest" and re-download
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

## Metrics

_To be completed (M9): location quotient, reliability states, enclaves, clusters, cuisine LQ,
gap measures, presets._
