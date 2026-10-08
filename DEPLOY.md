# Deploying NYC Enclave Finder

Deployment has been **prepared but not executed**. Nothing has been pushed and no remote or Pages
site exists. These steps take a few minutes. They use GitHub Pages, but any static host works:
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

`.github/workflows/refresh-data.yml` runs only by hand (**Actions → Refresh data → Run
workflow**). It:

- re-fetches every source, re-resolving "latest"
- rebuilds the data and reports
- runs the full test suite
- opens a **pull request** on a new branch

It never pushes to `main`. Before merging, review the PR:

- `data/manifest.json` for new source vintages
- `docs/OBSERVATIONS.md` for what changed

Merging the PR redeploys the site.

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

**Optional schedule.** Uncomment the `schedule:` block in `refresh-data.yml` to run on the 1st of
each month. The workflow needs **Settings → Actions → General → Workflow permissions → "Allow
GitHub Actions to create and approve pull requests"**.
