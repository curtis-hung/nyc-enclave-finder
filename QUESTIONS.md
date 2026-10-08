# Questions for the user

Issues that need user input. Each entry: context, what was tried, the default taken.

## Q1. PUMS (PUMA-level microdata) layer — APPROVED by the user (2026-10-07), build in M8

**Context:** tract-level language is 12 buckets and ~60% of granular groups are too sparse at
tract level. ACS PUMS has full detail (language incl. Yiddish/Bengali/Nepali/Thai, ancestry,
birthplace) but only for NYC's ~55 PUMAs (each roughly a community district).

**Proposal (STRETCH #1, built in M8 only if approved):**
- Fetch 2020-2024 5-year PUMS person records for NYC PUMAs (Census API microdata endpoint or the
  PUMS CSV), snapshotted like every other source.
- Add a fourth geographic level, "PUMA (detailed)", with detailed language, ancestry and
  birthplace categories; estimates from person weights, MOEs from the 80 replicate weights
  (successive difference replication), same data states and LQ rules.
- Display-only: a separate, clearly labelled choropleth level and a PUMA section in "Who's here".
  Enclaves, clusters and gap measures stay on tract/NTA data (PUMAs are too coarse for
  restaurant-scale distances).
- Biggest payoff: the Jewish proxy could use Yiddish itself (not the West Germanic bucket) at
  PUMA level, and Bengali/Nepali/Thai/Russian get language maps.

**Resolution:** approved as proposed (display-only fourth level, replicate-weight MOEs). Built in M8 as STRETCH #1.

**Superseded by Q2 (2026-10-08):** no separate PUMA map level; PUMS detail is shown inline and gated by reliability. See SPEC §4.6.

## Q2. M5 feedback: LQ scale + diaspora detail (decided by the user 2026-10-08)

Decided in a planning session while the build was paused at the M5 checkpoint. `SPEC.md` has been updated; re-read §0, §1.1 (J5), §1.2, §4.1, §4.6, §9.1–9.2, §10 and §13.2.

1. **LQ scale: 8 blue classes above 1.** Breaks at 1 / 1.5 / 2 / 3 / 4 / 6 / 10 / 20, keeping the two greys below 1. Validate the 8-step ramp and update `web/src/scales.ts`, its tests, the legend and the screenshots. Apply now, before M6.
2. **Diaspora detail (SPEC §4.6), SHOULD #3, built in M8.** For each group, PUMS cross-tabs of birthplace (50 states/DC / PR or territory / abroad, plus arrival period) and language at home (heritage / English only / other, plus heritage language among the US-born and English ability). Shown **inline only**: in a group profile, as strips under groups in "Who's here", and as cluster residential context. There is no separate view or map level.
3. **Hide when too thin.** Any number below the reliable state is hidden silently, with no placeholder. A strip with nothing reliable doesn't render. Hidden never means zero.
4. **Detailed-language fill.** In "Who's here", PUMS detailed languages fill in under tract language buckets for the surrounding district, where reliable; hidden otherwise.
5. Replaces Q1/D13's display-only "PUMA (detailed)" level. PUMS still never feeds enclaves, clusters, gaps or the choropleth.

## Q3. Broad-bucket clusters and the LQ ceiling (raised at the M7 checkpoint, 2026-10-08)

**Context:** common buckets (Asian = 23% of restaurants; Latin American; American) can never exceed
LQ = 1 / citywide share (Asian: 4.3), so a fixed `lq_min` is much harder for them. Manhattan
Chinatown's Asian cluster has catchment LQ 1.86 under the default preset (it shows under loose).
**Default taken:** thresholds unchanged (§2.4); the UI states the ceiling for any cuisine above 10%
of restaurants. **Options:** (a) keep as is; (b) qualify bucket clusters with a share-gap rule
(catchment share - citywide share >= x); (c) a normalized LQ ((LQ - 1) / (max LQ - 1)). Either
(b) or (c) would be one citywide rule.
