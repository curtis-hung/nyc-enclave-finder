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

## D6. Every share in a dimension is "of all residents" (language: residents aged 5+)

- **Decision:** each dimension has one numerator table and one explicit denominator
  (`config/dimensions.yaml`). For B02015 (Asian-alone universe) and B05006 (foreign-born universe)
  the denominator is total population (B01003), so "Thai share" means Asian-alone Thai residents
  as a share of all residents. The numerator universe is stored and shown in the UI.
- **Alternatives:** divide by each table's own universe (Thai as a share of Asian-alone residents;
  Thai-born as a share of the foreign-born).
- **Rationale:** the question is "where does the group live"; a within-universe share maps
  over-representation *among Asians* or *among immigrants*, which rewards areas with few Asians or
  immigrants. LQ still compares like with like: same numerator table, same denominator (§2.5).
- **Limitations:** numerators remain partial (Asian-alone only; foreign-born only); the UI states it.
- **Status:** confirmed by the user at the M2 checkpoint.

## D7. Data states and the minimum-data rule

- **Decision:** CV = (MOE/1.645)/estimate. reliable ≤ 0.30 < caution ≤ 0.60 < suppressed.
  Estimate 0 → `zero`; no residents in the universe or missing estimate → `unavailable`;
  denominator < 50 → `suppressed`; citywide group count < 200 → suppressed everywhere (no LQ).
  MOE code −555555555 → 0; uncomputable MOE → `caution`. Sums use root-sum-of-squares with only the
  largest zero-estimate MOE included (Census guidance).
- **NTA fallback:** if < 50% of a group's citywide estimate sits in reliable/caution tracts, the
  group×dimension is shown and analysed at NTA level by default, and the UI says so.
- **Rationale:** simple, documented, standard thresholds (§2.7); not tuned to any neighbourhood.
- **Limitations:** at tract level most granular groups are noisy; ~60% of groups default to NTA.

## D8. Crosswalk rules

- Ancestry is never summed across categories (a person can report two ancestries); broad groups
  use a published subtotal (Arab, Subsaharan African, West Indian) or have no ancestry value.
- Language is never derived for broad groups; most language mappings are flagged buckets.
- Broad groups otherwise sum their children's exact categories within one dimension;
  children without an exact category are listed as missing from the sum.
- Indo-Caribbean has no census category: the only mapping is a flagged birthplace proxy
  (Guyana + Trinidad & Tobago, all ethnicities). Sikh is shown as the ACS reports it (an Asian
  write-in group) and never used to infer religion. Afghan defaults to ancestry because race
  reporting for Afghans is inconsistent.
- Top-level group renamed "Hispanic & Latin American" because Brazilians (not Hispanic in the
  Census) sit under South American; its `hispanic` dimension excludes them.

## D9. Cuisine hierarchy is a DAG

- **Decision:** nodes may have several parents (Dominican under Latin American and Caribbean;
  "Chinese/Cuban" under Chinese and Cuban; Haitian under Caribbean and Creole). "Below" =
  descendant. DOHMH format values (Coffee/Tea, Bakery, Juice, Sandwiches, Chicken, Seafood, Donuts,
  Vegan, …) are *generic*: they behave as the root, so an external cuisine label adds specificity
  rather than conflicting. Dish-type values that imply a cuisine family (Pizza, Hamburgers,
  Steakhouse, …) are not generic, so "Pizza" + OSM "thai" is a conflict (§4.4 example).
  DOHMH "Spanish" is an ambiguous bucket above both Spain and Latin American; Tex-Mex sits under
  American only.
- **Rationale:** the real DOHMH vocabulary mixes national cuisines, regional buckets and formats;
  a strict tree would force false conflicts or false matches.

## D10. Cross-borough tract (Marble Hill)

- Tract 36061030900 is legally Manhattan (New York County) but DCP assigns it to Bronx NTA
  BX0802. Borough stats follow the legal county; NTA stats follow DCP. Recorded in the build log;
  more than five such tracts would fail the build.

## D11. Adjacency

- Rook contiguity (shared boundary > 1 ft) on water-included tracts in EPSG:2263. Point contacts
  are not neighbours. Five island tracts have no neighbours. NTA adjacency = any adjacent tract pair.

## D12. M2 checkpoint taxonomy changes (user decisions)

- **Indo-Caribbean removed.** Guyanese and Trinidadian remain leaf groups under Caribbean; no
  proxy group is built from birthplace.
- **Sikh merged into Indian.** Indian's Asian-group mapping is B02015_021 + B02015_026 (the
  pre-2020 ACS coded Sikh write-ins as Asian Indian; the lines are mutually exclusive, so summing
  is valid within the dimension).
- **Jewish added as a proxy group** (`proxy: true`). The user directed that Yiddish speakers be
  assumed Jewish. At tract level the only available category is C16001 "German or other West
  Germanic languages" (also German, Dutch, Pennsylvania Dutch speakers), so the group is labelled
  "Jewish (Yiddish-language proxy)" everywhere, its mapping is flagged as a bucket, and the
  rationale states it misses Jewish New Yorkers who do not speak Yiddish at home. Paired exact with
  DOHMH "Jewish/Kosher". Only groups explicitly marked `proxy` may default to a bucket category.
  This knowingly departs from the spec's caution about inferring identity (§4.5) at the user's
  direction; the proxy is transparent in the UI and About page.
- **Thresholds** (D7, presets.yaml) confirmed as-is.

## D13. PUMS layer approved (STRETCH #1, M8)

- Display-only "PUMA (detailed)" level with detailed language/ancestry/birthplace from 2020-2024
  5-year PUMS, MOEs from 80 replicate weights; not used for enclaves, clusters or gaps. The Jewish
  proxy will use Yiddish itself at this level. See QUESTIONS Q1.

## D14. Frontend stack and test harness

- Preact (4 KB) for panels, plain MapLibre for the map, view state in the URL hash only.
  MapLibre 6 needs `setWorkerUrl` with Vite's `?url` import of its ESM worker.
- Choropleth colours are applied with a data-driven `["to-color", ["at", ["get","i"], colors]]`
  expression and state textures via `in` filters, so switching groups never re-tiles geometry.
- E2E runs `vite preview` on a dedicated port (4317, `reuseExistingServer: false`) with
  `?basemap=none`, because other local projects use 5173/4173 and tests must not depend on a
  remote tile server. Screenshot runs use the real basemap.

## D15. Choropleth encoding

- LQ: neutral greys below 1 ("not over-represented"), single-hue blue ramp above 1 at fixed breaks
  1 / 1.5 / 2 / 3 / 5 / 10 (validated reference palette). Share and count: blue ramp on rounded
  quantile breaks of usable values. Data states are textures, never hue: dots = caution,
  diagonal hatch = suppressed, cross-hatch = unavailable / no residents, pale solid = zero.
  Enclaves: orange (categorical slot 2); clusters: violet dashed (slot 7).
- **Rationale:** colour stays reserved for values; states stay distinguishable for colour-blind
  readers and never look like zero or like data (§1.2, §2.7).

## D16. Enclave polygons

- Union of the clipped land geometry of the enclave's units, closed by ±3 ft to dissolve hairline
  gaps between clipped neighbours. Non-qualifying units inside an enclave remain holes.
  Adjacency (and thus membership) still comes from unclipped geometry (D11).

## D17. "Who's here" candidates

- Per dimension, rank the finest groups with an exact mapping (skip a group when a descendant also
  has an exact mapping), so lists never double-count parent and child. Language ranks its own 12
  categories (nearly every language mapping is a bucket) and labels them as language categories.
  Proxy/bucket groups (e.g. Jewish) are not ranked as groups; their bucket category still appears
  in the language list. Precomputed for tracts, NTAs and boroughs (exact tract sums).

## D18. Radius interpolation

- Area-weighted: each tract's estimate × (share of its land area inside the circle), the share
  estimated by sampling a 120×120 grid of points in the circle against tract polygons (land
  only). Denominators are weighted the same way. Approximate MOE = root-sum-square of weighted
  MOEs (weights treated as constants; largest zero-estimate MOE only). Data states and LQ use the
  same rules as the pipeline (TS port with parity tests). Always labelled approximate.
- **Alternatives:** exact polygon clipping in the browser (adds a clipping library; the sampling
  error is far below the ACS sampling error); population-weighted interpolation (STRETCH).

## D19. Focus semantics

- Clicking a tract selects it for "who's here" (outlined, no mask, no zoom). NTA, borough and
  radius are *focus* modes: inverse mask, fit to area, full stats panel and drill-down.

## D20. Tract-level display caution band (user decision at the M5 checkpoint)

- Tract values with 0.60 < CV ≤ 0.80 are shown as `caution` (dotted) instead of `suppressed`
  (`analysis.yaml: cv_caution_max_tract`), roughly doubling coloured tracts for sparse groups.
  NTA, borough and radius values keep CV ≤ 0.60. The NTA-fallback rule still uses 0.60, so sparse
  groups still default to neighborhoods with the sparse-data notice, and the tract view adds a
  "treat as rough" caveat. Enclave qualification is unchanged: presets add `cv_max` (strict 0.30,
  default/loose 0.60), and enclave counts are identical before and after (455 / 1,646 / 2,733).

## D21. Places suggest a group; radius focus fits wider (user decision at the M5 checkpoint)

- Each gazetteer place names the group it is colloquially associated with (e.g. Flushing →
  Chinese). Choosing a place sets the radius focus *and* selects that group. This is navigation
  only: the pairing is never used in any computation, threshold or test, and the UI does not claim
  the area belongs to the group (§2.4).
- Radius focus fits to a circle of max(2.5 × radius, 1 mi) so the surrounding pattern is visible.
- The area panel has Hide/Show (keeps the focus and mask) in addition to Close; on phones the
  collapsed panel is a bottom bar.

## D22. Restaurant backbone rules

- One record per CAMIS: identity fields from the newest real inspection row that has them
  (rows ordered by inspection date, then inspection type/action/violation code for ties);
  coordinates from the newest row with coordinates inside the NYC bbox.
- Active = latest inspection within 3 years of the snapshot. Never-inspected permits (DOHMH date
  1900-01-01, no cuisine) stay on the map flagged "not yet inspected" but are outside the
  analysis population.
- Multi-location = normalized name (accents, punctuation, legal suffixes, store numbers removed)
  at ≥ 5 active locations; hidden by default and excluded from the analysis population, so
  clusters and cuisine LQ describe independents and small local multi-location businesses.
  Overrides file exists but is empty; curation is not required.
- **Limitations:** franchises with independent owners (e.g. many "Kennedy Fried Chicken") are
  flagged; a regional 5+ location business is treated like a chain.

## D23. Enrichment and tags

- External labels are mapped in `config/cuisine_sources.yaml` from the enumerated OSM/Overture
  vocabularies; format/dish labels (coffee, pizza, burger, bar…) are generic and ignored.
  Matching: KD-tree within 75 m, normalized-name similarity = max(sequence ratio, token
  Jaccard) ≥ 0.6, greedy one-to-one by (similarity, distance, ids).
- Tag model per §4.4 (`analysis/labels.py`): most specific below-primary candidates become tags;
  compatible ancestor evidence credits them; confidence from distinct sources (2+ high, one
  structured medium, keyword low); incompatible evidence → conflicts only.

## D24. Clusters

- DBSCAN (EPSG:2263 feet) per paired cuisine node; nodes that are DOHMH values use primary labels
  + any-confidence tags under them; other nodes use tags at medium+ (`presets.yaml
  tag_confidence`), plus primaries below them. Footprint = convex hull of members (+60 ft);
  catchment = footprint + `catchment_ft`. Cuisine LQ = cuisine share of ALL analysis-population
  restaurants in the catchment ÷ citywide share; qualifies at `lq_min`. Each restaurant counts once
  in every denominator. Tag coverage for tag-based clusters = share of catchment restaurants whose
  primary is a parent bucket (nearest DOHMH-valued ancestor) that carry any medium+ tag.
- Default parameters (eps 600 ft, min_samples 4, min size 5, catchment 1,000 ft, LQ ≥ 2) are
  NYC-scale defaults, set once and never tuned to make places appear.
- Only cuisine nodes paired with some group are clustered (102 nodes); cuisine over-representation
  in "who's here" covers every non-generic, non-dish node.
