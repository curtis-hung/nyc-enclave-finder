# Decisions

Consequential choices only: decision, alternatives, rationale, limitations.

## D1. Repository layout

- **Decision:** One repo, two toolchains. Python pipeline at `src/pipeline` (uv, `pyproject.toml`
  at root); frontend at `web/` with `package.json`/`vite.config.ts` at the root (`root: "web"`).
  Built assets go to `web/public/data/` and are committed.
- **Alternatives:** separate `web/package.json`; monorepo tooling.
- **Rationale:** `npm run dev` / `npm run preview` and `uv run pipeline` both work from the repo
  root on Windows without wrapper scripts.
- **Limitations:** none material.

## D2. Clustering library

- **Decision:** use scikit-learn (`DBSCAN`, and `HDBSCAN` which ships in sklearn ≥ 1.3) instead
  of the standalone `hdbscan` package.
- **Rationale:** avoids a compiled dependency that is awkward on Windows.
