# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`disk_usage` is the **dashboard/UI layer** of a two-part system. It reads report files
(JSON + SQLite) produced by the companion CLI scanner `check_disk` (../check_disk, also
indexed in codebase-memory) and serves them through a single PHP API to a vanilla-JS SPA.
This repo never scans the filesystem itself — it only reads and presents `check_disk` output.

Stack: PHP 5.4+ backend, vanilla ES2020 JS frontend (no framework), vanilla CSS3, Chart.js
(self-hosted in `js/vendor/`). `index.html` loads built bundles, so editing source `.js`/`.css`
requires a rebuild — see "Build is required after editing source".

## Commands

```bash
# Build the bundles index.html loads (REQUIRED after editing any source .js/.css)
npm install            # one-time, installs esbuild only
npm run build          # emits js/app.min.js, css/app.min.css, css/core/{fonts,index}.min.css
npm run build:watch    # rebuilds js/app.min.js on change (CSS only builds once per invocation)

# Manual API testing (no test framework exists in this repo)
curl "http://localhost/disk_usage/api.php?id=disk_sda" | python3 -m json.tool | head -30
USER_B64="$(printf '%s' 'alice' | base64 | tr -d '\n')"
curl "http://localhost/disk_usage/api.php?id=disk_sda&type=detail&user_b64=${USER_B64}&limit=50"

# Runtime/env sanity check — NOTE: gated behind admin auth, returns 401 unauthenticated
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
`npm run build:watch` during JS development. `build.mjs` (esbuild) emits exactly four files:
- `js/app.min.js` — bundles `js/app.js` (which imports all 14 modules in order) into one file;
- `css/app.min.css` — bundles `css/app.css`, marking `*.ttf`/`*.woff*` as `external` then
  rebasing font `url(...)` from `../../fonts/` to `../fonts/` (the bundle sits one dir
  shallower than `css/core/fonts.css`);
- `css/core/fonts.min.css` + `css/core/index.min.css` — minified in place (no bundling), because
  `setup.html` loads those two directly.
There is no longer a per-file `js/**/*.min.js` step (removed — nothing referenced those). The
tracked `.min.*` files are committed build artifacts; rebuild and commit them with the source
change. Bump the `?v=` query param on the bundle tags in `index.html` to bust caches.

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

### Escape all API data rendered into HTML
Renderers build HTML via template strings + `innerHTML`. API data (file names, dir paths,
usernames, extensions, owners, error/status text, team/disk/group names) are real filesystem
strings and **must** be wrapped in `escHtml` (from `js/utils/dom.js`) before interpolation —
including inside `title="..."` and `data-tooltip="..."` attributes, since the tooltip renderer
(`js/ui/tooltip.js`) injects `data-tooltip` via `innerHTML`. `escHtml` escapes `& < > "` but
**not** `'`, so never interpolate API data into a single-quoted inline `onclick`; wire events
with `addEventListener` instead. Numbers (`fmt`, `pct`, `toFixed`) are safe unescaped.

### Detail/export paging and limits
`detail`/`dirs`/`files` enforce `limit` max 50000 server-side (peak ~30MB JSON / ~7MB gzipped
per page, safe under the 512MB memory cap). CSV export (`streamExportGzip` in
`js/utils/csvExport.js`) pages via opaque cursor with a depth-1 prefetch pipeline — the next
page is fetched while the current one is compressed/written, so do not lower the cap below the
export `PAGE` size (50000 for files) or you multiply round-trips. The export callback mutates
its `cursor` after each fetch resolves; the pipeline relies on never running two callbacks
concurrently — preserve that ordering if you touch the loop.

## Git safety
`.gitignore` is intentionally broad for production deployments: it ignores `*.json` (including
`disks.json` and all report files), `reports*/`, `detail_users/`, `database/*.db`, `*.log`,
`*.gz`, `docs/`, `scripts/`, `.github/`, `.htaccess`, `build.mjs`, and more. `package.json` is
the one un-ignored JSON. Some ignored paths contain intentionally-tracked files (the `.min.js`
/ `.min.css` bundles, `build.mjs`); adding new files under ignored paths requires
`git add -f`. Do not commit `disks.json` or anything under report directories.

Per user preference: commit messages must not include `Co-Authored-By` or AI attribution.
