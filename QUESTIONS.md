# Questions for the user

Issues that need user input. Each entry: context, what was tried, the default taken.

## Q1. PUMS (PUMA-level microdata) layer: proposed path, awaiting yes/no before M8

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

**Default if no answer:** not built (it is the first STRETCH item and gated on approval).
