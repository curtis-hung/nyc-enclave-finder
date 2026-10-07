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

## D3. ACS access: API with key, Summary File fallback

- **Decision:** the Census Data API now rejects keyless requests (redirect to `missing_key`), so
  `fetch` uses `CENSUS_API_KEY` when set and otherwise streams the national table-based Summary
  File and keeps NYC rows. Both paths write identical normalized CSVs (verified for B01003).
  The build never touches the network.
- **Limitations:** the keyless path downloads large national files (up to ~280 MB per table).

## D4. Geography sources

- **Decision:** NYC DCP 2020 tract layers from NYC Open Data. Shoreline-clipped tracts
  (`63ge-mke6`) are display geometry; water-included tracts (`imfq-nf3j`) are the "unclipped"
  geometry used for adjacency (§4.2). Tract → NTA → borough comes from DCP's equivalency table
  (`hm78-6dwm`) and is cross-validated spatially and by GEOID county code at build time.
- **Alternatives:** TIGER/Line tracts (also unclipped). DCP layers carry NTA codes and match the
  NTA polygons exactly, so fewer join edge cases.
- **Limitations:** water-included geometry makes tracts on opposite banks of a river touch at the
  mid-channel line, so adjacency can cross water. This follows the spec rule (adjacency from
  unclipped geometry, never from display clipping).

## D5. OSM via Overpass

- **Decision:** one Overpass query for `amenity=restaurant|fast_food|cafe` and
  `amenity=place_of_worship` inside the NYC relation (175905), `out center tags`, stored as JSON.
- **Alternatives:** Geofabrik New York PBF extract (~400 MB, needs a PBF parser such as
  osmium, a heavy Windows dependency for a few thousand features).
- **Limitations:** depends on a public Overpass instance at fetch time (retries built in).
