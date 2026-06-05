# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`disk_usage` is the **dashboard/UI layer** of a two-part system. It reads report files
(JSON + SQLite) produced by the companion CLI scanner `check_disk` (../check_disk, also
indexed in codebase-memory) and serves them through a single PHP API to a vanilla-JS SPA.
This repo never scans the filesystem itself — it only reads and presents `check_disk` output.

Stack: PHP 5.4+ backend, vanilla ES2020 JS frontend (no framework), vanilla CSS3, Chart.js
(self-hosted in `js/vendor/`). No build step is required to run.

## Commands

```bash
# Build minified JS/CSS bundles (OPTIONAL — see "Build is optional" below)
npm install            # one-time, installs esbuild only
npm run build          # bundles js/**/*.js -> *.min.js and css/<bundle>/parts -> *.min.css
npm run build:watch    # JS watch mode (CSS only builds once per invocation)

# Manual API testing (no test framework exists in this repo)
curl "http://localhost/disk_usage/api.php?id=disk_sda" | python3 -m json.tool | head -30
USER_B64="$(printf '%s' 'alice' | base64 | tr -d '\n')"
curl "http://localhost/disk_usage/api.php?id=disk_sda&type=detail&user_b64=${USER_B64}&limit=50"

# Runtime/env sanity check (PHP version, disabled functions)
curl "http://localhost/disk_usage/api.php?debug_runtime=1"
```

There is no automated test suite, linter, or CI in this repo. `.pytest_cache/` is a stray
artifact (Python tests live in the companion `check_disk` project, not here). Verify backend
changes by curling `api.php`; verify frontend changes in a browser.

## Architecture

### Request flow (backend)
`api.php` → `backend/bootstrap.php` (loads libs + handlers, sets gzip/memory) →
`backend/router.php`. Dispatch is by `?type=`:
- **Global types** (no disk needed): `disks`, `team`, `team_scan_status`, `health`,
  `group_config`, `admin` → handled directly.
- **Disk types** (require `?id=`): `permissions`, `treemap`, `treemap_search`, `meta`,
  `users`, `dirs`, `files`, `detail`. The `id` is resolved against `disks.json` to a
  filesystem path — **the real path is never exposed to the client**.
- **No type** → `api_handle_aggregate` (snapshot + history timeline).

Handlers live in `backend/handlers/`, shared helpers in `backend/lib/`
(`request.php`/`response.php` = param parsing + base64 + ETag/304 flow,
`db_connection.php` = read-only SQLite PDO, `path_resolver.php` = dir_id→path,
`filesystem.php` = report-file discovery, `cache.php` = file-backed payload cache).

### Frontend
`index.html` loads two **bundled** assets: `js/app.min.js` (a single ESM bundle) and
`css/app.min.css`, plus the two self-hosted vendor scripts (`js/vendor/chart.min.js`,
`jszip.min.js`). The bundle is produced from `js/app.js` (imports all 14 modules in order)
and `css/app.css` (`@import`s the 4 CSS entry files). Source modules still live under
`js/core/`, `js/services/`, `js/renderers/`, `js/features/`, `js/ui/`, `js/utils/`; the app
boots via independent `DOMContentLoaded` listeners scattered across modules (there is no single
`initApp()` call — `main.js` only *exports* it). Cross-module coupling is via explicit
`window.*` globals (e.g. `window._permToggle`, `window.appFetcher`) consumed by inline
`onclick`/`oninput` handlers, so those assignments must survive bundling. State is a plain
module-level store (`js/core/dataStore.js`, `AppState` in main.js).

### Build is required after editing source
`index.html` references `js/app.min.js` + `css/app.min.css`, so editing a source `.js`/`.css`
has **no effect until you rebuild**. Run `npm install` (one-time) then `npm run build`, or
`npm run build:watch` during JS development. `build.mjs` (esbuild):
- bundles `js/app.js` → `js/app.min.js` (one file, all modules inlined);
- per-file minifies every other `js/**/*.js` → `*.min.js` (legacy `rewrite-imports-to-min`
  path, kept for any standalone consumers);
- bundles `css/app.css` → `css/app.min.css`, marking `*.ttf`/`*.woff*` as `external` and then
  rebasing font `url(...)` from `../../fonts/` to `../fonts/` (the bundle sits one dir
  shallower than `css/core/fonts.css`);
- still emits per-dir CSS (`css/core/index.min.css` etc.) — `setup.html` references those.
Bump the `?v=` query param on the bundle tags in `index.html` when you want to bust caches.
The tracked `.min.*` bundles
are committed artifacts. If you edit a source `.js`/`.css`, the change is live immediately for
dev; only run `npm run build` when you need to refresh the minified bundles.

## Critical constraints

### PHP 5.4+ compatibility
The backend must run on PHP 5.4. Use `array(...)`, **not** `[...]` short-array syntax, and
file-scope `const` with bare scalar values (no concatenation between consts). Match the
existing style in `backend/lib/`.

### constants.php mirrors the scanner
`backend/constants.php` is the single source of truth for report filenames/patterns and is
intentionally kept in sync with `check_disk/src/constants.py`. If `check_disk` changes an
output filename, update `constants.php` to match — do not hardcode filename literals in
handlers.

### SQLite is read-only + keyset pagination
Detail and treemap data come from SQLite DBs (`detail_users/data_detail.db`,
`tree_map_data/treemap.db`) opened read-only. Detail User pagination is **cursor/keyset**
(O(limit), no total count, no jump-to-page) — files keyed on `(size, dir_id, name_id)`, dirs
on `(size, id)`, with WHERE clauses crafted to hit specific covering indexes. When resolving
paths for large export pages, `dir_id IN (...)` is **chunked to 500 IDs per query** to stay
under SQLite's binding limit — preserve this chunking or large exports silently lose path data.
Schemas and index names are documented in README.md.

## Git safety
`.gitignore` is intentionally broad for production deployments: it ignores `*.json` (including
`disks.json` and all report files), `reports*/`, `detail_users/`, `database/*.db`, `*.log`,
`*.gz`, `docs/`, `scripts/`, `.github/`, `.htaccess`, `build.mjs`, and more. `package.json` is
the one un-ignored JSON. Some ignored paths contain intentionally-tracked files (the `.min.js`
/ `.min.css` bundles, `build.mjs`); adding new files under ignored paths requires
`git add -f`. Do not commit `disks.json` or anything under report directories.

Per user preference: commit messages must not include `Co-Authored-By` or AI attribution.
