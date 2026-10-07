# Progress

Status of the build against `SPEC.md` §16. Updated at every milestone boundary.

## Milestones

- [x] M0 Scaffold
- [ ] M1 Fetch + provenance
- [ ] M2 Demographic build + taxonomy **[CHECKPOINT]**
- [ ] M3 Basemap + group focus
- [ ] M4 "Who's here?"
- [ ] M5 Area focus **[CHECKPOINT]**
- [ ] M6 Restaurants + labels + clusters
- [ ] M7 Gaps + presets **[CHECKPOINT]**
- [ ] M8 Remaining SHOULD / STRETCH
- [ ] M9 Finish

## Current status

**M0 complete.** Next: M1 (fetchers + provenance manifest).

## Completed work

### M0 Scaffold
- Python pipeline package `src/pipeline` managed by `uv` (`uv run pipeline fetch|build`), pytest.
- Frontend: Vite + TypeScript + MapLibre GL (+ Turf) rooted at `web/`, Vitest for unit tests,
  Playwright for E2E (runs against `vite preview` of the production build) with desktop,
  mobile and screenshot projects.
- State files: `PROGRESS.md`, `DECISIONS.md`, `QUESTIONS.md`; README skeleton; `.gitignore`
  excludes raw/interim data.

## Cuts

None.

## Payload sizes

Not measured yet.

## Blockers

None.
