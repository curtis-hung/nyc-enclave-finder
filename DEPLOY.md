# Deploying NYC Enclave Finder

**Live:** https://curtis-hung.github.io/nyc-enclave-finder/ (repository
`curtis-hung/nyc-enclave-finder`, published 2026-11-03). Every push to `main` re-runs the tests and
redeploys. The steps below record how it was set up, for a fork or a fresh copy; they take a few minutes. They use GitHub Pages, but any static host works:
`npm run build` writes a self-contained site to `dist/`.

## 1. Create the repository and push

1. Create an empty repository on GitHub, for example `nyc-enclave-finder`. Do not add a README
   or license.
2. From this folder, run:

   ```bash
   git remote add origin https://github.com/<you>/nyc-enclave-finder.git
   ```

   ```bash
   git push -u origin main
   ```

The processed data in `web/public/data/` (about 68 MB raw) is committed, so the site builds
without downloading anything. Raw snapshots in `data/raw/` are git-ignored.

## 2. Enable GitHub Pages

1. In the repository, open **Settings → Pages** and set **Source: GitHub Actions**.
2. Open **Actions → Build, test and deploy → Run workflow**, or push any commit.
   `.github/workflows/deploy.yml` then:
   - runs pytest, Vitest and Playwright (desktop and mobile)
   - builds with the right base path
   - publishes `dist/`
3. The site appears at `https://<you>.github.io/nyc-enclave-finder/`.

**Base path.** The workflow takes the base path from Pages, which is `/<repo>/` for a project
site. For a custom domain or a `<you>.github.io` repository, add a repository variable
**`VITE_BASE`** = `/` under **Settings → Secrets and variables → Actions → Variables**. For a local
build under a sub-path, run:

```bash
VITE_BASE=/nyc-enclave-finder/ npm run build
```

In PowerShell, set it first with `$env:VITE_BASE = "/nyc-enclave-finder/"`.

## 3. Optional: Census API key

`CENSUS_API_KEY` is used only when data are refreshed. Without it, the pipeline falls back to the
ACS summary files, which hold the same tables but take longer to download. To add one:

1. Request a free key at <https://api.census.gov/data/key_signup.html>.
2. Add it as a repository **secret** named `CENSUS_API_KEY` under **Settings → Secrets and
   variables → Actions → Secrets**.

The key is never shipped to the browser.

## 4. Refreshing data

`.github/workflows/refresh-data.yml` runs **automatically on the 2nd of each month**, and by hand
from **Actions → Refresh data → Run workflow**. Each run:

- re-fetches every source. Restaurants, OpenStreetMap and Overture get new snapshots; census data
  (ACS, PUMS) stays at its **pinned vintage**, so the census data can't change silently
- rebuilds the data and reports
- runs the full test suite. Any failure stops the run, the live site is untouched, and GitHub
  emails you
- runs the **refresh gate** (`uv run pipeline refresh-gate`), then does one of the following:

| Outcome | What happens |
|---|---|
| Routine: restaurant count within ±10%, tagged restaurants within ±25%, census vintage unchanged, and the same tracts and neighborhoods with no tract area moving more than 1% | Commits to `main` and redeploys the site. No action needed. |
| Anything else | Opens a **pull request** with the gate's reasons. Review it; merging redeploys. |
| No data changed | Nothing |

**New census vintages** (the Census Bureau publishes one each December) are never applied
automatically. When one exists, the refresh opens an **issue**. To get it, run the workflow by
hand with **upgrade_vintages** ticked. That run always opens a PR. Check `docs/TAXONOMY.md` and
`docs/OBSERVATIONS.md` in it before merging, because new vintages can change which groups have
reliable data.

**Required setting:** **Settings → Actions → General → Workflow permissions → "Allow GitHub
Actions to create and approve pull requests"** must be on, or the PR step fails.

To refresh locally instead:

```bash
uv run pipeline fetch --refresh
```

```bash
uv run pipeline build
```

```bash
uv run pytest
```

Add `--upgrade-vintages` to `fetch` to move census data to the latest published vintage.
