# NYC Enclave Finder: Spec (v6)

> This is the authoritative reference spec. The launch prompt (`PROMPT.md`) says how to work; this says what to build.
>
> Re-read `PROGRESS.md` and the sections relevant to the current milestone at the start of every milestone, and after any context compaction or restart.

---

## 0. Priority tiers

Every feature is tagged **[MUST]**, **[SHOULD]** or **[STRETCH]**.

- **MUST** items are the product. Hedge words ("where practical", "if useful") never apply to them; they apply only to SHOULD and STRETCH items.
- If time, context or feasibility gets tight, cut all STRETCH items before any SHOULD item.
- Within a tier, cut from the bottom of these lists:
  - **SHOULD, keep first → cut first:**
    1. cuisine enrichment (external tag sources)
    2. scatter plot
    3. diaspora detail from PUMS (§4.6)
    4. bucket context panel
    5. drill-down small multiples
    6. gazetteer presets
    7. enclaves and gap measures for non-default dimensions
    8. borough reference toggle
    9. connector lines
    10. diversity layer
    11. compare mode
    12. Find food (§9.9), added after M9 on 2026-11-03
  - **STRETCH, keep first → cut first:**
    1. Places of Worship
    2. population-weighted radius interpolation
    3. live threshold sliders
- Record every cut in `PROGRESS.md` and `DECISIONS.md`.
- Never cut a MUST. If a MUST proves infeasible, that's a checkpoint (§15.4).

---

## 1. Mission

Build a static, web-hostable interactive map of New York City that is **half restaurant-finding tool, half sociological experiment**.

For any ethnic or cultural group, broad ("South Asian") or granular ("Thai", "Vietnamese", "Nepali"), the user explores:

1. **Where the group lives** across the whole city.
2. **Where its restaurants cluster**, focusing on independent restaurants and small local multi-location businesses rather than obvious large chains.
3. **How those two patterns relate spatially.**

**The tool measures and visualizes. The user draws the conclusions.**

### 1.1 User journeys (acceptance scenarios) [MUST]

These describe what the user can **do**, never what they will **find**. Each one is an E2E test (§13.6) that checks the steps work, not what the data shows.

- **J1: Group → neighborhood → restaurant**
  1. Pick "Thai" in the group picker.
  2. See where Thai New Yorkers live (choropleth on the group's default dimension, with honest data states).
  3. Focus on the Elmhurst NTA. The rest of the city grays out.
  4. The stats panel shows every over-represented group there.
  5. The restaurant list is filtered to Thai (primary label or tags).
  6. Open a restaurant card: see its primary label, tags with confidence and sources, and a Google Maps link.
- **J2: Commercial vs. residential**
  1. Jump to the Koreatown preset (or drop a radius pin there if the gazetteer is cut).
  2. "Who's here" shows both over-represented cuisines and over-represented residential groups for that radius.
  3. Select "Korean" and open the gaps panel: Korean clusters are listed with their distances to each Korean residential enclave.
  4. Clicking a row focuses the cluster together with its nearest enclave.
- **J3: Bucket → leaf, with sensitivity**
  1. Pick "Latin American" and see bucket-level clusters.
  2. Drill into "Ecuadorian" and see tag-based clusters with their tag coverage.
  3. Open the bucket context panel.
  4. Switch between the strict, default and loose presets; enclaves and clusters visibly change and the URL updates.
- **J4: Phone → share**
  1. On a phone-sized viewport, pick a group, focus on Queens and collapse the panels.
  2. Copy the URL.
  3. Opening that URL on desktop recreates the same view.
- **J5: Diaspora detail** (§4.6)
  1. Pick "Korean". The group profile shows the citywide split by birthplace and language at home.
  2. Focus on a neighborhood. In "Who's here", Korean shows a diaspora strip for the surrounding district, or no strip at all if the data there is too thin.
  3. Open a Korean restaurant cluster. Its residential context shows the same split for the surrounding district.
  4. The E2E test checks both cases: a strip renders where the data qualifies, and is absent (not zero) where it doesn't.

### 1.2 Visual direction [MUST]

- Map-first, with a quiet basemap.
- Color is reserved for data, using colorblind-safe palettes.
- Legible at a glance.
- Data states (§2.7) and inferred labels (§4.4) are distinguishable without reading fine print.
- Secondary panels stay out of the way until needed.
- **LQ choropleth scale** (user decision, 2026-10-08):
  - Two neutral greys below 1 (< 0.5, 0.5–1).
  - **8 sequential blue classes** above 1, with breaks at 1 / 1.5 / 2 / 3 / 4 / 6 / 10 / 20. That gives the classes 1–1.5, 1.5–2, 2–3, 3–4, 4–6, 6–10, 10–20 and ≥ 20.
  - Validate the 8-step ramp (dataviz palette validator): adjacent classes must stay distinguishable, the lightest blue must stay distinct from the greys, and the legend must stay readable on mobile.
  - Share and count may use the same 8-step ramp.

---

## 2. Analytical principles [MUST, non-negotiable]

### 2.1 Over-representation, not dominance

The primary metric is the location quotient:

`LQ = local group share / reference group share`

The reference defaults to citywide. A group at 8% of a tract versus 1% citywide is a strong signal even if another group is 40% of that tract. Never equate "largest group" with "most distinctive group."

### 2.2 Never collapse an area to one winner

Where several groups are meaningfully over-represented, show all of them. Rankings are for display only; the data model must preserve multi-group neighborhoods.

### 2.3 Residential and commercial are separate lenses

Census measures describe where people **reside**. Restaurant data describes where a cuisine is **commercially present**.

- Detect each independently, then measure the relationship.
- **Restaurant cuisine labels come only from restaurant data.** Residential data must never be used to label, tag, refine or cluster restaurants.
- Commercial data must never define residential enclaves.
- Residential data may be *displayed beside* commercial results as context (§8.3). It must be labeled as context, not evidence.
- **One user-chosen exception (2026-11-03):** Find food's "Where the community lives" option (§9.9) uses residential enclaves to decide *where to look* for restaurants. It never changes a restaurant's cuisine label, tags or clusters, and the UI says so.

### 2.4 Exploratory, not prescriptive

- Do NOT build categorical interpretations ("co-located", "detached", "legacy") into the pipeline or UI.
- Do NOT tune thresholds so known neighborhoods tell a desired story.
- Surface continuous measures and underlying values. The user interprets them.
- Never imply that a connector line or proximity proves a causal or cultural relationship.

### 2.5 Dimension semantics stay honest

Ancestry, race/ethnicity, birthplace and language measure different things over **different Census universes**:

- country of birth covers the foreign-born only
- language covers people aged 5 and over
- the detailed Asian table covers the Asian-alone population
- ancestry lets one person report two ancestries

For every demographic dimension, store:

- source table / variable
- numerator
- denominator / universe
- estimate
- MOE
- a human-readable universe description

LQ must always compare values built from the **same dimension and universe**. Never silently compare percentages with different denominators. The UI states what a percentage is "a share of" wherever ambiguity matters.

### 2.6 Never sum across overlapping dimensions

Never add values across dimensions to estimate a population. Broad groups may sum compatible leaf categories *within* one dimension, as the crosswalk permits.

### 2.7 Honest uncertainty and sparse data

Use estimates and MOEs (e.g. the coefficient of variation) to assign every value one of these states:

| State | Meaning |
|---|---|
| `reliable` | Usable as-is |
| `caution` | Noisy estimate |
| `suppressed` | Too unreliable to show a value |
| `unavailable` | The dimension doesn't exist for this group or geography |
| `zero` | True or estimated zero |

These states must be **visually distinct**. Missing or suppressed data must never look like zero.

- Apply a minimum-data rule so tiny denominators and tiny reference populations can't produce extreme LQs.
- If a granular group is too sparse at tract level, aggregate to NTA and say so in the UI.
- Use simple documented thresholds. Don't spend effort optimizing them.

### 2.8 Avoid the centroid trap

Many groups are multi-modal. A single citywide centroid can land somewhere meaningless (e.g. Chinese New Yorkers' several concentrations average out to a point in the water). Measure commercial-to-residential distance against **detected residential enclaves**, never against a group centroid.

---

## 3. Data architecture [MUST]

### 3.1 Snapshot at build time, never live

The deployed site makes **zero** runtime calls to data APIs.

- **`uv run pipeline fetch`** downloads full source data into `data/raw/<source>/<vintage-or-date>/`.
  - It records provenance in `data/manifest.json`: source URL or id, resolved vintage or snapshot date, fetch timestamp, row count, SHA-256 and relevant source metadata.
  - It is idempotent: an existing snapshot is skipped unless `--refresh` is passed.
- **`uv run pipeline build`** reads only local snapshots and deterministically writes compact frontend assets to `web/public/data/`.
- Raw snapshots are gitignored. Processed outputs needed by the frontend are committed.

### 3.2 Reproducibility

"Latest" means latest at the moment `fetch` resolves the source. After that, the build uses the pinned snapshot and never silently moves to a newer vintage. Refreshing is an explicit operation.

---

## 4. Sources

### 4.1 Demographics [MUST]

Use the latest ACS 5-year vintage available at fetch time, for NYC census tracts. Before relying on any table, verify that it and its variables exist at tract level.

Candidate tables:

- B03001: detailed Hispanic origin
- B02015: detailed Asian groups
- B04006: ancestry
- B05006: country of birth
- C16001, or the most detailed language table available at tract level
- B03002: race / Hispanic totals

The optional 2020 Census detailed race/ethnicity products (DHC-A) may help with granular categories.

**Expect tract-level language data to be heavily bucketed.** It is believed to have only about 12 categories: Yiddish grouped with German/West Germanic, Russian with Polish/Slavic, and Thai, Bengali and Nepali under "Other Asian". Verify this against the snapshot, treat language as bucketed wherever it is, and report the actual granularity at M2.

Detailed language, plus birthplace and language at home *within* a group, come from ACS microdata (PUMS) and are shown inline only where reliable (§4.6).

- Use `CENSUS_API_KEY` from the environment if set. The build must not depend on it.
- Absence is valid data: not every group appears in every dimension.

### 4.2 Geography [MUST]

- 2020 Census tracts for the five boroughs
- shoreline-clipped geometry for display only
- NYC DCP 2020 Neighborhood Tabulation Areas (NTAs)
- borough boundaries

Rules:

- Tract GEOID is the fundamental join key.
- Validate tract → NTA and tract → borough relationships from the data, not from names. Handle edge cases from the data (water-only or park tracts) rather than hard-coding assumptions.
- **Adjacency comes from unclipped tract geometry or source relationships.** Display clipping must never change which tracts count as neighbors.

**[SHOULD] `gazetteer.yaml`:** hand-curated colloquial presets that aren't clean NTAs (Koreatown, Curry Hill, Little Italy, Arthur Avenue, Little Sri Lanka, Little Senegal, Little Guyana, …), each with an approximate center and radius. These are navigation only and never analytical ground truth.

### 4.3 Restaurants: backbone [MUST]

The backbone is NYC DOHMH Restaurant Inspection Results (NYC Open Data, Socrata `43nn-pn8j`), fetched as a full snapshot. DOHMH is the authority on whether a restaurant exists, where it is and whether it looks active.

- **One record per CAMIS, by a deterministic, documented rule.** Inspection data has many rows per establishment and per inspection, so don't assume an arbitrary latest row is complete.
- Keep only establishments that look active, using a documented heuristic.
- Log these diagnostics:
  - raw rows
  - unique CAMIS
  - retained establishments
  - records dropped for missing or invalid coordinates
  - records filtered as inactive
  - every distinct cuisine value
- Modest metadata imperfections must not stop the build. Prefer a transparent heuristic.

**Multi-location heuristic.** Normalize DBA names and flag businesses at multiple locations.

- This is a heuristic, not proof of a corporate chain.
- Flagged businesses are hidden by default.
- Support a small overrides file, but don't make manual curation a prerequisite for finishing.

### 4.4 Restaurants: multi-label cuisine model [MUST model, SHOULD enrichment]

#### Label model [MUST]

Every restaurant has **one primary label and zero or more inferred tags**.

- **Primary label: `cuisine_primary`.**
  - It is the DOHMH `CUISINE DESCRIPTION`, mapped to its node in the cuisine hierarchy (§5.3).
  - It is always present, it is the source of truth, and it is often the widest bucket ("Latin American", "Caribbean", "Middle Eastern", "African").
  - Generic DOHMH values ("Other", "Not Listed/Not Applicable", etc.) map to the hierarchy root, so any tag counts as "below" them.
  - Enumerate the real values; don't assume.
- **Inferred tags: `cuisine_tags`.**
  - A list of tags, each sitting **below** the primary label in the hierarchy (a descendant of the primary's node) and adding specificity.
  - A restaurant may carry several tags, e.g. a "Latin American" place tagged Ecuadorian *and* Colombian.
  - Tags never replace or contradict the primary.
- **Each tag records:**
  - `label`: a hierarchy node. It may be an intermediate node such as "Himalayan" when the evidence is ambiguous.
  - `sources`: a list of {`source`, `evidence`}, e.g. the OSM `cuisine=` value plus element id, the Overture category plus place id, or the matched keyword.
  - `confidence`: derived from the sources, never set by hand:
    - **high:** two or more independent sources agree on the label or on a compatible ancestor/descendant
    - **medium:** one structured external source (OSM or Overture)
    - **low:** a name keyword only
- **Merging.** The same label from two sources becomes one tag listing both sources. Ecuadorian from one source plus Latin American from another becomes a single Ecuadorian tag crediting both.
- **Conflicts.** An external label that is *not* below the primary (e.g. DOHMH "Pizza", OSM "thai") never becomes a tag.
  - It goes in a separate `cuisine_conflicts` list, shown in the restaurant detail view under "Other sources say…", and is counted in the diagnostics.
  - Conflicts never feed filtering, clustering or LQ.
- **Only restaurant-derived evidence produces tags** (§2.3). Residential data never creates, removes or ranks a tag.

#### Enrichment sources [SHOULD]

Free, open, bulk-downloadable sources only:

- **OpenStreetMap:** eating places (`amenity=restaurant|fast_food|cafe`) with `cuisine=*` from an NYC extract. Semicolon-separated values become separate candidate tags.
- **Overture Maps Places:** bulk GeoParquet filtered to the NYC bbox. Primary and alternate categories are both candidate tags.
- **Name-keyword dictionary:** a curated `cuisine_keywords.yaml` that maps telling name terms to a hierarchy node. Ambiguous terms map to a parent node rather than a guessed leaf. Examples:
  - "Pupusería" → Salvadoran
  - "Ecuatoriano" → Ecuadorian
  - "Momo" / "Himalayan" → Himalayan
  - "Arepa" → Venezuelan/Colombian

External sources are snapshotted and recorded in the manifest like any other source.

**Not allowed:** Google Places, Yelp or any paid API, sources whose terms forbid storing data, scraping.

**Matching.** Match DOHMH records to external places by normalized name similarity plus a distance limit (default ~75 m). Matching is one-to-one and deterministic. Log match rates per source and per primary bucket.

#### How labels are used [MUST]

- **Filtering.**
  - A restaurant matches if the selected cuisine equals its primary label or any of its tags, or is an ancestor of them.
  - A tag-confidence selector (all / medium+ / high) defaults to medium+.
  - A multi-tag restaurant appears under each of its cuisines.
- **Clustering (§7).**
  - Bucket-level clusters ("Latin American") use primary labels plus any tags under that bucket.
  - Leaf or intermediate clusters ("Ecuadorian", "Himalayan") use tags at medium+ confidence.
  - A multi-tag restaurant belongs to each relevant point set, but **counts exactly once in every catchment denominator**.
- **Display.**
  - The card shows the primary label prominently, with tags as chips beneath it.
  - Each chip shows its confidence and sources and is visibly marked as inferred.
  - Conflicts sit in a collapsed "Other sources say…" section.

**Coverage bias.** External coverage is geographically uneven: OSM tagging follows mapper activity. Every tag-based cluster reports its **tag coverage**: the share of its catchment's restaurants with the parent bucket as primary that carry any medium+ tag. This lets the user tell real clusters from data-coverage artifacts.

### 4.5 Religion proxy [STRETCH]

The Census has no religion data, and religion must never be inferred from ethnicity. The proxy is a Places of Worship layer from the OSM extract (`amenity=place_of_worship` with `religion`/`denomination`), labeled as having incomplete and uneven coverage.

### 4.6 Diaspora detail from PUMS [SHOULD]

**Purpose.** The tract tables count everyone who identifies with a group, but they can't split that group by where people were born or what they speak at home. US-born and English-speaking members are counted, yet invisible as a distinct part of the group. PUMS microdata can cross-tabulate identity × birthplace × language, which makes the diaspora visible: where a group is mostly immigrants, where it is mostly US-born, and where the heritage language persists or has faded.

**No separate view (user decision, 2026-10-08).**
- There is no PUMA choropleth or map level. The map stays at tract level.
- This detail appears **only inside existing panels**, and **only where the data is reliable**.
- It supersedes the display-only "PUMA (detailed)" map level approved at M2 (`QUESTIONS.md` Q1, `DECISIONS.md` D13).

#### Source

- ACS 5-year PUMS person records for NYC PUMAs, same vintage as the tract tables, snapshotted like every other source.
- Verify the PUMA vintage. A 5-year file may mix 2010 and 2020 PUMA codes; handle that with the official crosswalk or a documented restriction.
- Estimates come from person weights (`PWGTP`). MOEs come from the 80 replicate weights (successive difference replication).

#### Defining each group

- Each group is defined in PUMS by the variable matching its `default_dimension`: detailed race, Hispanic origin, ancestry (first or second), or place of birth.
- Enumerate the real codes and record the mapping in `groups.yaml`.
- A group with no valid PUMS definition simply gets no diaspora detail.

#### Measures (per group × geography: PUMA, combined PUMAs, borough, city)

- **Birthplace:** born in the 50 states/DC / born in Puerto Rico or a US territory / born abroad.
  - Puerto Rico is its own category because island-born people count as US-born in Census data.
  - Among those born abroad: arrived < 10 years ago vs. 10+ years ago.
- **Language at home:** heritage language(s) / English only / another language. Each group's heritage language(s) are declared in `groups.yaml` from real PUMS language codes.
- **Heritage language among the US-born.**
- **English ability** among those who speak another language at home: "very well" vs. "less than very well".

**Wording.** Always say "Born in the US". Never say "second generation": the data can't tell second generation from third and later.

#### Reliability gating ("hide when too thin")

- Each individual number is shown only if it meets the **reliable** state: a CV threshold plus a minimum unweighted sample count, both documented in `config/analysis.yaml`.
- Anything else is **hidden silently**: no placeholder, no "not enough data" note.
- If every number in a strip is hidden, the strip doesn't render at all.
- Hidden must never render as, or be computed as, zero.
- The About page explains the rule.

#### Where it appears

1. **Group profile (§9.1):** the selected group's citywide split, next to the legend.
2. **"Who's here" / area focus (§9.2–9.3):** a thin strip under each listed group, describing the surrounding district.
   - The district is the PUMA(s) whose population overlaps the focused area, combined directly from the microdata (re-weighted, never by averaging percentages).
   - A borough focus uses the borough.
   - The strip's label names the PUMA(s) it describes, so a small radius is never presented as if measured at radius scale.
3. **Restaurant clusters (§7, §8.3):** in the cluster's details, the paired group's split for the PUMA containing the cluster, shown as **residential context** under the same rule as §2.3: it is never evidence of what the restaurants serve, and it never feeds labels, tags or clustering.

#### Detailed language fill

In the "Who's here" language section, where tract-level language is a bucket (e.g. "Other Indo-European"), detailed PUMS languages for the surrounding district fill in beneath it (e.g. Bengali, Hindi, Nepali, Yiddish), with share and LQ against the city. The same gating applies: reliable values only, hidden otherwise. These rows are labeled as district-level.

#### Never used for

- enclaves
- clusters
- gap measures
- the choropleth

PUMAs are too coarse for neighborhood- or restaurant-scale analysis.

---

## 5. Group and cuisine hierarchies [MUST]

Build `groups.yaml` as a hierarchy from broad groups to granular leaves. For example:

- South Asian → Indian, Bangladeshi, Pakistani, Nepali, Sri Lankan, Indo-Caribbean
- Southeast Asian → Thai, Vietnamese, Filipino, Indonesian, Burmese, …

Each node maps to its representation in each dimension (race/ethnicity, ancestry, country of birth, language) and to its paired cuisines (§5.3).

### 5.1 Enumerate, don't assume

Inspect the snapshots before finalizing any mapping. Enumerate the real ACS variables and labels, DOHMH cuisine values, OSM `cuisine=` values and Overture categories, then map from those.

- A group with no data in a dimension shows "no data" there. It is never dropped.
- Mark broad or ambiguous source buckets in metadata so the UI can flag them.

### 5.2 Default residential dimension

Each group declares a `default_dimension`. It drives the initial map view, the MUST-tier enclaves and the gap analysis. Typical choices:

- detailed race/ethnicity (B02015) for Asian groups
- detailed origin (B03001) for Hispanic groups
- ancestry or birthplace for others (Haitian, Jamaican, Polish, Greek, Arab, …)

Record the rationale for each choice and present the defaults at M2.

- **[MUST]** Enclaves and gap measures for the default dimension, under all three presets.
- **[SHOULD]** Enclaves and gap measures for the group's other dimensions, under the default preset only.

The choropleth works for every dimension a group has, regardless.

### 5.3 Cuisine hierarchy and pairing

Build a cuisine hierarchy (`cuisines.yaml`) rooted at a generic node, with broad buckets below the root and granular cuisines below those. For example:

- root → Latin American → Ecuadorian, Colombian, Salvadoran, …
- root → South Asian → Himalayan → Nepali, Tibetan

Every DOHMH value, OSM value, Overture category and keyword maps to a node. This hierarchy defines what "below" means in §4.4.

Each group lists the cuisine nodes it pairs with, and the pairing can be many-to-many (Indian cuisine ↔ Indian and Indo-Caribbean). Each pairing is tagged:

- **exact:** the cuisine names this group specifically (Thai ↔ "Thai")
- **bucket:** the cuisine covers this group among others ("Latin American" ↔ Ecuadorian)

Gap analysis runs only for declared pairings.

### 5.4 Aggregation

- Broad groups sum compatible leaf categories within one dimension.
- Independent MOEs combine by the standard ACS approximation (square root of the sum of squared MOEs).
- Never combine overlapping concepts just because they belong to the same cultural group.
- Prefer transparent, defensible aggregation over maximizing populated cells.

---

## 6. Residential enclaves [MUST]

For each group × dimension, compute tract-level values: count, share within that dimension's universe, LQ against the chosen reference, and reliability state.

**Enclaves:**

- **Method:** threshold plus connected components over tract adjacency by default. Another method is fine if it's equally explainable.
- **Qualification** considers at least LQ, estimated count and reliability.
- **Output:** polygons plus stats (population, share of the group's citywide population, peak LQ, tract count).
- **Thresholds** live in one central config, vary by preset (§11), and are never tuned neighborhood by neighborhood.

---

## 7. Commercial clusters [MUST]

Cluster each cuisine node independently, using density-based clustering (DBSCAN or HDBSCAN) on projected coordinates (EPSG:2263 or another suitable local CRS).

- Use NYC-scale default parameters and document them.
- Never optimize parameters to make known neighborhoods appear.

**No circular cuisine LQ.** A cluster defined by Thai points trivially has a high Thai share among those same points. Measure over-representation against **all restaurants in a catchment** that isn't defined by cuisine membership (e.g. a buffered cluster footprint). Pick one approach, document it and use it everywhere.

`cuisine LQ = cuisine share among all catchment restaurants / cuisine share among all reference restaurants`

Restaurant density alone must never qualify a cluster.

**Per-cluster stats:**

- restaurant count and independent (non-multi-location) count
- cuisine share and cuisine LQ
- footprint geometry
- label basis: primary vs. tags, with the tag confidence mix
- tag coverage (for tag-based clusters)
- **[SHOULD]** diaspora detail for the paired group around the cluster, shown as residential context only (§4.6)

---

## 8. Gap measures [MUST]

### 8.1 Measures

For each commercial cluster × declared group pairing, compute continuous relationships to that group's residential enclaves. Scope follows §5.2.

- polygon-to-polygon distance to the 1st, 2nd and 3rd nearest enclave (intersecting polygons have distance 0)
- intersection area
- % of the cluster overlapping an enclave, and % of the enclave overlapping the cluster
- the group's residential LQ and count within the cluster's catchment (same catchment definition everywhere)
- share of the group's citywide population within 0.5 / 1 / 2 / 5 mi of the cluster

Use a projected CRS for all distances and areas. **If a group has no qualifying enclave, distance is `null`, never a made-up large value.**

### 8.2 Bucket clusters

A cluster whose cuisine is a **bucket** pairing (e.g. "Latin American") gets its gap measures computed against the enclaves of the corresponding **broad group**. It is marked as bucket-level everywhere it appears.

### 8.3 Bucket context panel [SHOULD]

For any bucket cluster, or any area with many untagged bucket restaurants, show **residential context**: the leaf groups within that bucket that live in the catchment, with LQ, count and reliability.

Label the panel exactly: *"Residential context — who lives nearby. This is not evidence of what these restaurants serve."* It never feeds back into labels, tags or clustering (§2.3).

---

## 9. Features

### 9.1 Group focus

A searchable, hierarchical group picker. Selecting a group shows:

- **[MUST]**
  - a residential choropleth: LQ by default, `% share` and `count` toggles, and a dimension switcher starting on the `default_dimension`
  - residential enclaves (filled)
  - commercial cluster outlines
- **[SHOULD]** connector lines from each cluster to its nearest enclave, shaded on a continuous distance scale
- **[SHOULD]** a group profile next to the legend: the citywide diaspora split, reliable values only (§4.6)
- **[STRETCH]** Places of Worship

### 9.2 "Who's here?" [MUST]

Click a tract, NTA or borough to see:

- the top over-represented groups per dimension, with share, LQ, count and reliability
- the top over-represented cuisines (marked as approximate at tract level, where counts are small)
- **[SHOULD]** a diaspora strip under each listed group, plus detailed-language rows under language buckets, for the surrounding district. Shown only where reliable; otherwise absent (§4.6).

Always show multiple groups.

### 9.3 Area focus

**[MUST]** Three ways to focus:

- **Radius:** a pin plus a 0.1–3 mi slider
- **Neighborhood:** NTA list or map click
- **Borough**

When an area is focused, an inverse mask grays out the rest of the city, the map fits to the area, and the stats panel shows:

- composition by dimension
- top groups by LQ and by share
- over-represented cuisines
- a restaurant list
- intersecting enclaves and clusters

NTA and borough stats are exact tract sums. Radius stats use area-weighted interpolation and are labeled approximate.

- **[SHOULD]**
  - gazetteer presets
  - citywide/borough reference toggle
  - drill-down: tract-level mini choropleth plus small multiples of the area's ~6 most over-represented groups
  - compare: pin a second area side by side
- **[STRETCH]** population-weighted radius interpolation

### 9.4 Gaps panel / experiment view

- **[MUST]** A sortable table of the selected group's clusters, showing:
  - all gap measures
  - a compact distance-decay sparkline

  Clicking a row focuses the cluster together with its nearest enclave.
- **[SHOULD]** Scatter plot:
  - x = distance to nearest enclave
  - y = residential LQ in the catchment
  - size = restaurant count

  Hovering a point highlights it on the map; clicking focuses the cluster with its enclave. Null-distance clusters sit in a separate strip.

No categorical labels.

### 9.5 Restaurants [MUST]

- Points at high zoom; density or aggregation at low zoom.
- A hierarchical cuisine filter with the tag-confidence selector (§4.4).
- Multi-location businesses hidden by default.
- A Google Maps search link on each card.

This is not a review product.

### 9.6 Diversity layer [SHOULD]

An entropy-based diversity index, with its definition documented. Not framed as good or bad.

### 9.7 URL state [MUST]

The hash holds the group, dimension, metric, focused area, reference and preset. A shared URL recreates the same view.

### 9.8 Mobile [MUST]

Usable on a phone. Prioritize the map, group selection, focus controls, key stats and readable legends. Secondary panels collapse.

---

### 9.9 Find food [SHOULD] (user request, 2026-11-03)

Suggestions of candidate restaurants for the cuisine selected in §9.5, in four modes:

| Mode | Candidates |
|---|---|
| **Nearby** | Within 0.25 / 0.5 / 1 / 2 mi of a starting point, set inside the panel in one of three ways: **my location** (asked only when that button is pressed; kept in memory, **never written to the URL** or stored), a **ZIP code**, or **a click on the map**. A ZIP or click sets a radius pin, which is a normal radius focus (§9.3) and can be dragged. |
| **In a neighborhood** | Inside a neighborhood or borough picked in the panel itself (or any focused area). |
| **In an enclave** | Either the cuisine's restaurant clusters (§7) at the current preset, or "where the community lives": within 0.5 mi of the paired group's residential enclaves (default dimension, current preset). The second option is the §2.3 exception and is labeled as such. |
| **Off the beaten path** | Places of the cuisine outside every one of its clusters. |

Rules:

- Candidates follow the same eligibility as the map: independent and inspected, plus multi-location businesses when shown, at the current tag-confidence floor.
- Ordering is visible and switchable: closest first, surest cuisine match first (DOHMH label, then high / medium / low tags) or shuffled. There is no hidden score.
- Each suggestion shows "why" chips (distance, match basis, independent or multi-location, cluster, enclave distance) and a Google Maps link.
- There are no ratings, so suggestions are candidates, not judgments of quality, and the panel says so.
- **Not built: an "open since" signal.** The DOHMH file keeps only about three years of inspections per restaurant (verified: the maximum span is 3.0 years), so an earliest inspection date can't measure longevity.
- **Location is optional everywhere** (user feedback, 2026-11-03). Opening Find food never asks for it. If it's denied, the panel says so and offers a ZIP or a map click; the message appears only under Nearby. Every other mode works without any location.
- **ZIP centres** come from the restaurant data itself: the median location of each ZIP's restaurants (`restaurants/zips.json`, ZIPs with 3+ restaurants), rebuilt with every refresh. No geocoding service is used.
- When a starting point exists, every mode defaults to closest first.
- **Placement:** Find food stays below the Restaurants section, where the cuisine is picked next to the selected group's paired cuisines. A "first thing in the panel" layout was tried on 2026-11-03 and rejected by the user, because it separated restaurants from the group/enclave flow.
- **Every suggestion is tagged to the enclaves** (user feedback, 2026-11-03), in every mode:
  - the restaurant cluster it belongs to, by its colloquial place name where one exists (e.g. "Thai Town cluster"), else "#rank"
  - its distance to the paired group's residential enclave, when it is within 0.5 mi

  Only "Where the community lives" filters by that distance; elsewhere it is a label (residential context, §2.3).
- **Contact details, free only** (user decision, 2026-11-03): each suggestion and restaurant card shows what the data has:
  - phone (DOHMH, ~all restaurants)
  - website, Instagram and opening hours from the matched OpenStreetMap place (partial coverage; hours labeled "may be out of date")
  - **Normalization:** only 10-digit phones and http(s) links pass, and nothing is shown where data is missing.
  - **No photos or ratings:** every source of those is paid, forbids storing data, or forbids use beside a non-Google map. The Google Maps link stays as the way to see them.
- The mode is kept in the URL (`ff=`); the user's location never is.

## 10. About / methodology page [MUST]

In plain language, explain:

- every principle in §2
- the sources and snapshot dates (§3–4)
- the cuisine label model (§4.4)
- enclave detection (§6)
- cluster detection, including why the cuisine LQ isn't circular (§7)
- the gap measures (§8)
- the presets (§11)
- why radius results are approximate
- the limits of the multi-location heuristic
- the religion proxy, if built
- diaspora detail, if built: what it measures, why "Born in the US" is not "second generation", why Puerto Rico is separate, that it describes the surrounding district (PUMA), and why some groups or areas show no strip (§4.6)

Include verbatim:

> "Lives here" means census-measured residence. "Eats here" means restaurant location. Neither proves cultural identity, causality or neighborhood ownership.

---

## 11. Analytical presets

- **[MUST] Three precomputed presets: strict / default / loose.**
  - Each preset sets every consequential threshold: residential LQ cutoff, minimum count, reliability threshold, minimum cluster size, clustering density and catchment size.
  - Enclaves, clusters and gap measures are precomputed per preset, scoped per §5.2.
  - The preset switcher sits in an "Advanced" section and is kept in the URL.
  - The point is sensitivity analysis: seeing how the picture changes when the definitions change.
- **[STRETCH]** Live per-parameter sliders, only if client-side recomputation doesn't hurt usability.

---

## 12. Tech [MUST]

- **Site:**
  - static: no backend, no paid APIs, no secrets or tokens in the client
  - a free basemap that needs no key (OpenFreeMap, Protomaps or CARTO), with attribution
- **Pipeline:**
  - Python with `uv`
  - pandas, geopandas, shapely, scikit-learn and/or hdbscan, libpysal/esda where useful
  - `overturemaps`/duckdb for Overture
  - no heavyweight dependencies without a clear need
- **Frontend:**
  - Vite + TypeScript + MapLibre GL JS, with Turf.js where helpful
  - prefer precomputed data over analysis in the browser
- **Payload targets:**
  - first load under ~5 MB compressed (app, geometry, restaurant points, default view)
  - each lazy-loaded group, dimension or preset bundle under ~1 MB compressed
  - full restaurant details (address, tag sources, conflicts) load on demand, not up front

  The build prints a size report, and `PROGRESS.md` records the actual sizes. Usability beats the targets; document any exception.
- **Local-first:**
  - `npm run dev` and `npm run preview` work from committed processed data
  - a fresh clone is inspectable without refetching
- **Cross-platform:** the dev machine is Windows. Scripts must run there; no bash-only Makefiles.

---

## 13. Verification [MUST]

Tests catch incorrect analysis and broken plumbing. They never force reality to match expectations.

### 13.1 Unit tests

- LQ
- MOE and data states
- broad-group roll-up
- the no-cross-dimension-sum rule
- universe consistency
- aggregation and interpolation
- tract/NTA/borough joins
- crosswalk integrity
- mask geometry
- commercial LQ
- gap distances
- enrichment matching
- the tag model: "below primary" checks, merging, confidence derivation, conflicts

### 13.2 Synthetic fixture tests: the primary correctness proof

Small fake cities with planted answers:

- a cluster overlapping an enclave → distance 0, overlap > 0
- a cluster ~5 mi from an enclave → distance ≈ 5 mi
- a group with two enclaves → the nearer one is selected
- a group at 8% locally, not the plurality → ranks first by LQ
- two over-represented groups in one area → both appear
- a restaurant-dense area with an ordinary cuisine mix → no cuisine cluster
- a tiny or noisy estimate → `caution` or `suppressed`, never shown as zero
- a group with no enclave → `null` distance
- N same-cuisine points in an ordinary area → LQ computed against the full catchment (circularity guard)
- an external label not below the primary → goes to `cuisine_conflicts`, never to tags, never affects clustering
- a "Latin American" restaurant tagged Ecuadorian + Colombian → in both leaf point sets, counted once in every denominator
- OSM "ecuadorian" + Overture "latin_american_restaurant" → one Ecuadorian tag, both sources credited, high confidence
- a name keyword alone → low confidence, excluded from leaf clustering at medium+
- the ambiguous keyword "Himalayan" → an intermediate-node tag, not a guessed leaf
- primary "Other" → any external label is accepted as a tag
- a PUMS cell below the sample-size or CV threshold → hidden, never rendered or computed as 0
- a person born in Puerto Rico → counted as "born in PR/territory", not "born in the 50 states/DC"
- a replicate-weight MOE → matches a hand-computed example
- a focus area spanning two PUMAs → combined from the microdata (not by averaging percentages), with both PUMAs named in the label

### 13.3 Hard data invariants (failure fails the build)

- GEOIDs are unique where required.
- Every referenced variable exists in the snapshot.
- Restaurant coordinates parse at a reasonable rate.
- Every retained tract maps to its NTA and borough, or is explicitly accounted for.
- Joins don't silently lose significant data.
- Borough population totals reconcile with source totals within tolerance.
- Processed counts reconcile with the pipeline logs.

### 13.4 Plausibility checks (warn only; smoke tests, not truths)

- Russian, or the language category containing it, is concentrated around Brighton Beach.
- Dominican origin is concentrated around Washington Heights.
- Chinese population is concentrated around Flushing.
- Yiddish, or the language category containing it, is concentrated around Borough Park.
- Korean-cuisine restaurants are concentrated around W 32nd St.

On failure:

1. Look for a plumbing or crosswalk error.
2. If the pipeline is correct, record the discrepancy.
3. Never change thresholds to make a check pass.

Report **all** results, passing and failing, at the M2 checkpoint.

### 13.5 No outcome assertions

No test may require a real cluster to have any particular relationship to a residential enclave.

### 13.6 E2E (Playwright)

- **The user journeys J1–J5 (§1.1), end to end.**
- In addition:
  - group and dimension switching updates the map
  - each focus mode masks the city and updates the stats
  - the preset switcher changes enclaves and clusters
  - URL state round-trips

Test behavior and visible states, not pixels.

### 13.7 Visual self-check

At each milestone, save desktop and mobile screenshots to `docs/screenshots/` and actually inspect them. Look for:

- a blank or broken map
- a mask that is invisible or fully opaque
- an unreadable or misleading color scale
- overlapping controls or clipped panels
- mobile overflow
- missing data that looks like zero
- broken geometry

### 13.8 Observations digest

After M7, generate `docs/OBSERVATIONS.md`. It is machine-generated and numbers-first:

- the largest and smallest gaps by group
- groups with multiple enclaves
- NTAs with many over-represented groups
- high-cuisine-LQ clusters
- areas of high diversity
- how much results shift between presets

Descriptive only: no explanations, no categories.

---

## 14. Deployment [MUST]

**Published by the user on 2026-11-03** at `curtis-hung/nyc-enclave-finder` (GitHub Pages). This replaces the original "prepared, NOT executed" rule. Agents still never push, create remotes or change repository settings unless the user asks in that session. Local commits are expected.

- **`.github/workflows/deploy.yml`:** deploys to GitHub Pages and runs the build and tests on push. The Vite `base` path comes from configuration or an environment variable.
- **`.github/workflows/refresh-data.yml`** (user decision, 2026-11-03): runs monthly and on demand.
  - It refetches every source at its **pinned** census vintage (§3.2), rebuilds and runs the full suite.
  - `pipeline refresh-gate` then decides the outcome:
    - **Routine:** restaurant count within ±10%, tagged restaurants within ±25%, census and geography vintages unchanged. The workflow commits to `main` and starts the deploy itself, because pushes made with the workflow token don't trigger other workflows.
    - **Anything else:** opens a PR with the gate's reasons.
  - A newer census vintage opens an issue. Upgrading it (`--upgrade-vintages`) is always a reviewed PR, never automatic.
- **`DEPLOY.md`:** the steps to create a repo, push, enable Pages, optionally add `CENSUS_API_KEY` and optionally enable the cron. Going live should take a few minutes.

---

## 15. Working style

### 15.1 State files

- **`PROGRESS.md`:** milestone checklist, status, completed work, cuts, payload sizes, blockers and next step. Update it at every milestone boundary.
- **`DECISIONS.md`:** consequential choices, with the decision, alternatives, rationale and limitations. Skip trivial ones.
- **`QUESTIONS.md`:** issues that need the user.

### 15.2 When the spec is ambiguous

1. Preserve §2.
2. Prefer the simplest robust option.
3. Prefer reversible decisions.
4. Prefer transparent methods over opaque ones.
5. Use source data over hard-coded assumptions.
6. Test the choice.
7. Document it if it's consequential.
8. Keep building.

Don't pause because several libraries, thresholds or UIs are possible. Don't over-engineer for speculative requirements.

### 15.3 Stuck rule

If the same problem survives **3 genuinely different approaches**:

1. log it in `QUESTIONS.md` with what was tried
2. take the simplest working fallback
3. record it in `DECISIONS.md`
4. move on to unblocked work

### 15.4 User checkpoints

Pause for user input **only** at these points, or on a genuine blocker. Each pause gives a concise summary plus screenshots, then waits.

**After M2**, show:

- the group hierarchy and crosswalk
- the dimensions available per group
- the actual tract-level granularity of each dimension (especially language)
- source buckets
- the default dimension per group, with rationale
- cuisine pairings (exact vs. bucket)
- **all plausibility results**
- data limitations
- whether to propose a PUMS layer

The user may reshape the taxonomy.

**After M5**, show screenshots of:

- the main map and group focus
- radius, NTA and borough focus
- "who's here"
- drill-down
- mobile

Ask for UX feedback.

**After M7**, show:

- clusters, the gaps table and the scatter plot
- representative cluster/enclave interactions
- all three presets and their parameters
- enrichment match rates by source
- tag counts by confidence
- conflict counts and tag coverage by bucket
- **a sample of 20 tagged restaurants and 10 conflicts** to spot-check
- `OBSERVATIONS.md`
- current payload sizes

Ask for feedback on the experiment view and the defaults.

**Genuine blocker:** an important source is unavailable or materially changed, an assumed variable or geography doesn't exist, an analysis isn't statistically meaningful with the available data, or a MUST is infeasible. Explain:

- what happened
- what's still possible
- your recommended default
- alternatives

Don't pause for anything a straightforward fallback handles.

**If the harness can't pause:** append the issue to `QUESTIONS.md`, take the most reversible default, record it in `DECISIONS.md` and continue all unblocked work.

### 15.5 Git

- Commit after each milestone that passes its tests, with a descriptive message.
- Never mark a milestone complete on a known failing state.
- Never interact with remotes.

---

## 16. Milestones

| # | Milestone | Covers |
|---|---|---|
| M0 | Scaffold | Repo structure, uv + Vite/TS, test runners, README skeleton, state files (§15.1) |
| M1 | Fetch + provenance | §3, all fetchers in §4 |
| M2 | Demographic build + taxonomy **[CHECKPOINT]** | §2.5–2.7, §4.1–4.2, §5, §13.3–13.4 |
| M3 | Basemap + group focus | §1.2, §6 (default preset), §9.1 MUST items |
| M4 | "Who's here?" | §9.2 |
| M5 | Area focus **[CHECKPOINT]** | §9.3 MUST items, plus the gazetteer and drill-down |
| M6 | Restaurants + labels + clusters | §4.3–4.4, §5.3, §7, §9.5 |
| M7 | Gaps + presets **[CHECKPOINT]** | §8, §9.4, §11, §13.8 |
| M8 | Remaining SHOULD / STRETCH | In tier order (§0) |
| M9 | Finish | §10, §9.8 polish, §12 size report, accessibility basics, §14, README, final screenshots, full suite |

---

## 17. Done when

- Every milestone is checked in `PROGRESS.md`, and any cuts are listed with reasons.
- All §13 suites pass: unit, synthetic, invariants, and E2E including J1–J5. Plausibility results have been reported to the user.
- `npm run preview` serves a working site, usable on desktop and mobile. Payload targets are met or the exceptions are documented.
- The documentation is complete:
  - README (fetch, build, run, refresh; every major metric)
  - About page
  - `DECISIONS.md`
  - `DEPLOY.md`
- Nothing has been pushed or published.
