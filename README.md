# Disk Usage Dashboard

A production-ready web dashboard for visualising per-user and per-team disk usage across
multiple storage volumes. Designed to handle **enterprise-scale data** — millions of files,
terabytes of storage, and dozens of users — without degrading browser performance.

Pairs with the companion CLI scanner **check_disk**
which generates the JSON reports this dashboard consumes.

---

## ✨ Features

### Overview & Navigation
- **3-Column Master-Detail Layout** — Teams in the sidebar, Disks in a middle column, and a main dashboard canvas for detailed metrics
- **SPA Routing** — App state and active tabs persist seamlessly across reloads via `router.js`
- **Tab-based layout** — Overview, History & Analysis, Detail User, and Permission Issues tabs for deep diving into individual volumes
- **Custom UI Settings** — Built-in dropdown to toggle between Light/Dark mode; preferences saved to `localStorage`
- **Sidebar logic** — Live clock, collapsible layout, and quick dropdown space picker
- **Smart tooltips** — Glassmorphic JS singleton tooltip (auto-positions, viewport-aware, immune to stacking contexts)

### Overview Tab
- **System summary cards** — total capacity, used, scanned, free space with dynamic units
- **Disk capacity timeline** — line chart tracking capacity over time with range selector (7D / 30D / 6M / 1Y / 5Y / All)
- **Team usage donut chart** — proportional breakdown by team
- **Top consuming users bar chart** — ranked by disk usage, log/linear scale toggle
- **Expandable charts** — click ⤢ to open any chart fullscreen

### History & Analysis Tab
- **Time-range presets** — 7D, 30D, 3M, 6M, 1Y, All + custom date picker
- **User filter sidebar** — select users to include; selection persists across time-range changes
- **Usage trend chart** — per-user or combined usage over time
- **Fastest-growing users chart** — identifies top growth rates in the selected period

### Detail User Tab *(Early Access)*
- **User picker dropdown** — searchable, lists all users (configured + system UIDs)
- **Directory card** — top directories sorted by size with colour-coded bars and CSV export
- **File card** — files sorted by size with extension badges
- **Cursor pagination** — Next/Prev navigation with O(limit) keyset queries
- **Page indicator** — pill-shaped "Page N" indicator between Prev/Next buttons (no total count, no jump-to-page)
- **SQLite-backed PHP API** — reads `detail_users/data_detail.db` with cursor-based keyset pagination
- **Keyword search** — LIKE-based filter on file basename or directory path (comma-separated multi-term)
- **Advanced filters** — extension filter, min/max size range
- **CSV export** — streaming gzip export for dirs or files with progress indicator. Paths are normalized to absolute form (reconstructed from `scan_root` when DB stores relative paths)
- **Beta notice banner** — dismissible session-persistent notice (stored in `sessionStorage`)

### Permission Issues Tab
- **Flat item list** — every inaccessible path across all users: `[user] [path] [type] [error]`
- **Server-side user filter** — filter by one or more users; PHP filters before paginating
- **Item type filter** — filter by File / Directory / All (server-side)
- **Path search** — debounced (350 ms) substring filter, processed server-side
- **Numbered pagination** — resets to page 1 on any filter change
- **User summary sidebar** — item counts per user (always reflects full unfiltered totals)
- **CSV export** — Export Filtered (current filters) or Export All (raw dump)
- **Backward-compatible API** — accepts both new flat format and old nested format

### Treemap Explorer Tab
- **Interactive directory tree** — navigate filesystem hierarchy by clicking folders
- **Breadcrumb navigation** — click any ancestor to jump back; resolves paths via tree-walk
- **Global search** — find directories by name across the entire tree; results scoped to current path
- **Size bars** — visual percentage of disk usage per node with colour coding
- **Owner column** — shows each directory's real inode owner (`st_uid`), resolved to a username
- **Lazy loading** — fetches children on demand via `treemap.db` shard API
- **Responsive layout** — 4-column grid collapses to 2-column then single-column at narrow widths

### Inodes Stat Tab
- **System inode summary** — total/used/free inodes with capacity pie chart
- **Per-user inode distribution** — 2-column grid of user cards showing file count contribution
- **Searchable user list** — filter users by name
- **Stat cards** — quick metrics (total users, avg files/user, max files user)

### ⚙️ Config Generator (`setup.html`)
- **Visual setup wizard** — browser-based tool to generate config files without editing JSON by hand
- **Two config tabs** — generates `disk_checker_config.json` (for the check_disk scanner) and `disks.json` (for this dashboard)
- **Live JSON preview** — syntax-highlighted real-time preview panel, always in sync with the form
- **Input validation** — detects reserved names (e.g. `"other"`), duplicate usernames, and empty required fields
- **One-click download** — downloads the generated config file directly from the browser

### UI / UX
- **Theme Settings** — Light and Dark modes with preferences saved to `localStorage`
- **Responsive Layout** — desktop edge collapse button and mobile off-canvas drawer; CSS container queries for dynamic component density
- **Custom tooltip system** — `data-tooltip=""` attribute, auto-positions (flips/clamps at viewport edges)
- **Micro-animations** — hover lifts, skeleton loading states, fade-in transitions
- **SVG icons only** — no emoji, consistent cross-platform rendering
- **Accessible** — ARIA roles, keyboard navigation, focus-visible indicators
- **Container queries**: History and Permission Issues tabs use container queries to stack layouts at narrow widths. Tab pane heights and overflow are reset when stacking so charts/lists don't get clipped.
- **User filter box**: max-height clamped to `min(60dvh, 480px)` at narrow widths so it doesn't dominate the screen.

---

## 🏗️ Architecture

### Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5, Vanilla JavaScript ES2020+, Vanilla CSS3 |
| Backend | PHP 5.4+ (aggregation, SQLite-backed detail APIs, CSV export) |
| Charts | [Chart.js](https://www.chartjs.org/) — bundled locally (`js/vendor/chart.min.js`) |
| Data source | JSON reports and SQLite databases generated by check_disk |

### Unified API — `api.php`

All data endpoints are consolidated into a single `api.php`. The `?type=` parameter selects the
operation; `?id=` maps to a disk via `disks.json` (path never exposed to the client).

**HTTP caching:** The idempotent endpoints `meta`, `users`, `disks`, `team` emit
`ETag` + `Cache-Control` headers. Clients that send `If-None-Match` get a `304 Not Modified`
response (zero body) when the underlying source files (mtime/size) have not changed.
This is the cheapest form of polling — use it when wiring polled requests on the frontend.

#### `?id=<disk_id>` (default — snapshot + history)

Returns combined JSON with `history[]`, `latest` snapshot, team usage, user usage, top directories.

#### `?id=<disk_id>&type=permissions` — Permission issues (paginated)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `offset` | `0` | Row offset |
| `limit` | `100` | Rows per page (max 9999 for CSV export) |
| `users` | _(omit)_ | Comma-separated usernames for server-side filter |
| `item_type` | _(omit)_ | `file` \| `directory` — server-side type filter |
| `path` | _(omit)_ | Substring match on path (server-side) |

**Response:** `{ total, items[], user_summary{}, error_summary{} }`

#### `?id=<disk_id>&type=users` — User list

Returns `{ users: [{name, used}] }` — all users with detail reports for this disk.

#### `?id=<disk_id>&type=detail&user_b64=<base64_username>` — Unified user detail

Returns directory and file breakdowns for a single user. Supports cursor pagination.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `user_b64` | required | Base64-encoded UTF-8 username |
| `limit` | `500` | Rows per page (max 50000) |
| `dir_cursor` | _(omit)_ | Opaque cursor for dir pagination (from previous `next_cursor`) |
| `file_cursor` | _(omit)_ | Opaque cursor for file pagination |
| `filter_query` | _(omit)_ | Comma-separated keywords — LIKE match on file basename or dir path |
| `filter_ext` | _(omit)_ | Comma-separated extensions (files only) |
| `filter_min_size` | _(omit)_ | Minimum file/dir size in bytes |
| `filter_max_size` | _(omit)_ | Maximum file/dir size in bytes |

**Response:** `{ dir: { total_dirs_full, total_used, has_more, next_cursor, dirs[] }, file: { total_files_full, total_used, has_more, next_cursor, files[] } }`

#### `?id=<disk_id>&type=dirs&user_b64=<base64_username>` — Directory report (cursor)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `limit` | `500` | Rows per page |
| `cursor` | _(omit)_ | Opaque cursor from previous response's `next_cursor` |
| `filter_query` | _(omit)_ | Keyword filter on dir path |
| `filter_min_size` / `filter_max_size` | _(omit)_ | Size range filter |

**Response:** `{ dir: { total_dirs_full, total_used, has_more, next_cursor, dirs[] } }`

#### `?id=<disk_id>&type=files&user_b64=<base64_username>` — File report (cursor)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `limit` | `500` | Rows per page |
| `cursor` | _(omit)_ | Opaque cursor from previous response's `next_cursor` |
| `filter_query` | _(omit)_ | Keyword filter on file basename |
| `filter_ext` | _(omit)_ | Extension filter |
| `filter_min_size` / `filter_max_size` | _(omit)_ | Size range filter |

**Response:** `{ file: { total_files_full, total_used, has_more, next_cursor, files[] } }`


### File Matching

The API discovers report files from each disk `path` using the backend rules below:

| Data type | Location | Matching rule |
|-----------|----------|---------------|
| Main usage/history reports | disk path root | JSON filenames containing `disk_usage_report` or `usage_report`, or starting with `report_` / `report-` |
| Main report exclusions | disk path root | Files containing `permission_issue`, `detail_report`, or `inode_usage` are excluded from main usage/history aggregation |
| Permission issues (preferred) | disk path root | `permission_issues.db` (SQLite) — server-side WHERE/LIMIT filtering |
| Permission issues (legacy fallback) | disk path root | Latest JSON file whose name contains `permission_issue` |
| Inode usage fallback | disk path root | Latest JSON file matching `*inode_usage_report*.json` |
| Unified user detail | `detail_users/` | Preferred file is `data_detail.db` |
| Legacy directory detail fallback | `detail_users/` | `detail_report_dir_<user>.json`, `detail_report_dirs_<user>.json`, or the same names with any prefix ending in `_` |
| Legacy file detail fallback | `detail_users/` | `detail_report_file_<user>.json`, `detail_report_files_<user>.json`, or the same names with any prefix ending in `_` |
| Treemap data | `tree_map_data/` | `treemap.db` (SQLite, DB-only). The API `shard_id` is the decimal `dir_id`; there is no JSON shard fallback |

For user detail, `data_detail.db` takes precedence over legacy per-user JSON files.

### Request Flow

```
Browser
  │
  ├── GET api.php?id=disk_sda               ← snapshot + history
  │
  ├── GET api.php?id=disk_sda&type=users    ← list users with detail reports
  │
  ├── GET api.php?id=disk_sda&type=detail   ← dirs + files for a user (cursor)
  │     &user_b64=YWxpY2U=
  │     &limit=500&dir_cursor=...&file_cursor=...
  │
  ├── GET api.php?id=disk_sda&type=files    ← paginated file list (cursor)
  │     &user_b64=YWxpY2U=&limit=500
  │     &cursor=eyJzaXplIjo...
  │
  ├── GET api.php?id=disk_sda&type=treemap  ← treemap children for a shard
  │     &shard_id=42&offset=0&limit=200
  │
  └── GET api.php?id=disk_sda              ← paginated permission issues
        &type=permissions
        &offset=0&limit=100
        &users=alice,bob
```

---

## 🚀 Setup & Deployment

### Requirements

- Linux web server (Nginx or Apache) with **PHP 5.4+** and `php-fpm` or `mod_php`
- The companion check_disk scanner to generate reports
- Web server process must have **read access** to the report directories

### Steps

```bash
# 1. Clone
git clone https://github.com/hyhy2001/disk_usage.git
cd disk_usage

# 2. Configure disks
# Edit disks.json — group your storage volumes by team:
# [
#   {
#     "name": "Backend Team",
#     "disks": [
#       { "id": "disk_sda", "name": "Primary Storage", "path": "reports_test/disk_sda" }
#     ]
#   }
# ]

# 3. Open in browser
# http://your-server/disk_usage/
```

### Frontend build (optional, local/dev)

Use the local Node build script to regenerate minified JS/CSS bundles:

```bash
# Install dev dependency
npm install

# Build minified assets
npm run build
```

Watch mode is also available:

```bash
npm run build:watch
```

Cache busting is automatic: after emitting the bundles, `build.mjs` stamps the `?v=` query
param on the bundle `<script>`/`<link>` tags in `index.html` with each bundle's content hash
(JS and CSS hashed independently), so browsers refetch only when a bundle actually changes — no
manual version bump. The stamp runs on a full `npm run build` only, not in `build:watch` (CSS
isn't rebuilt there), so run a full build before deploying to finalize the hashes.

### `disks.json` format

```json
[
  {
    "name": "Backend Team",
    "disks": [
      { "id": "disk_nvme0", "name": "Primary NVMe", "path": "reports_test/disk_nvme0" },
      { "id": "disk_sda", "name": "Archive HDD Array", "path": "reports_test/disk_sda" }
    ]
  }
]
```

- `id` — unique identifier used in API calls (`?id=disk_sda`), never exposes the real path
- `name` — display name shown in the disk selector
- `path` — relative path from the web root to the disk report directory

Each `path` directory should contain:
- `disk_usage_report*.json` — one or more dated reports from check_disk
- `permission_issue*.json` — permission scan output (optional)
- `detail_users/data_detail.db` — unified per-user directory and file detail database (optional)
- `tree_map_data/treemap.db` — treemap data database (optional)

### SQLite report schemas

`detail_users/data_detail.db` is the unified Detail User database:

| Table | Columns | Purpose |
|-------|---------|---------|
| `meta` | `key`, `value` | scan_root, scan_timestamp |
| `users` | `uid`, `username`, `team_id`, `total_files`, `total_dirs`, `total_size`, `permission_issues`, `is_target` | Per-user metadata and totals |
| `file_names` | `id`, `name` | Unique file basename dictionary |
| `dirs` | `id`, `uid`, `parent_id`, `path`, `owner_uid`, `size`, `files` | Directory rows — one per (dir, user) pair. `path` is absolute when DB is built fresh; when relative, frontend reconstructs from `scan_root`. `owner_uid` is a reserved placeholder (currently always 0, not populated/consumed — real dir-owner lives in `treemap.db`). PK: `(id, uid)` |
| `files` | `dir_id`, `name_id`, `ext`, `uid`, `size` | File rows — `ext` stored inline (no dictionary) |

Indexes (keyset-pagination optimized):
- `ix_files_uid_size_dir_name` — covers no-filter cursor pagination
- `ix_files_uid_ext_size_dir_name` — covers ext-filter cursor pagination
- `ix_files_dir_uid_ext_size_name` — covers dir_id batch path resolution
- `ix_dirs_uid_size_dir` — covers dir cursor pagination
- `ix_file_names_name` — covers LIKE keyword search

`tree_map_data/treemap.db` stores the directory tree for the treemap explorer:

| Table | Columns | Purpose |
|-------|---------|---------|
| `meta` | `key`, `value` | scan_root, scan_timestamp, max_level, total_size, total_dirs |
| `names` | `id`, `name` | Directory segment dictionary |
| `owners` | `uid`, `username` | UID → username mapping |
| `dirs` | `id`, `parent_id`, `name_id`, `total_size`, `file_count`, `dir_count`, `owner_uid`, `has_files` | Full directory tree (all depths). `owner_uid` is the directory's real inode owner (`st_uid`), resolved via `owners` — not the top space consumer |

### Backend reliability

- **Chunked `dir_id` lookup**: when resolving paths for large export pages, `dir_id IN (...)` queries are chunked to 500 IDs per query to stay well under SQLite's 32766 binding limit. Without chunking, exports of 50K+ rows would silently lose path data, leaving only basenames.
- **Cursor pagination** in `detail.php` uses `(size, dir_id, name_id)` for files and `(size, id)` for dirs, with all WHERE clauses crafted to hit the corresponding covering keyset index. Page fetch is O(limit) regardless of total row count.
- **Keyword search** uses `LIKE` against `file_names.name` (covered by `ix_file_names_name`) for files, and `LIKE` on `dirs.path` for dirs. Multi-token queries are OR'd via `api_keyword_like_clause`.

---

## 📂 File Structure

```
disk_usage/
│
├── index.html                  # Single-page app container
├── setup.html                  # Visual config generator
├── api.php                     # Unified API entrypoint
├── build.mjs                   # Builds minified JS/CSS bundles
├── .htaccess                   # Apache security, SPA fallback, caching, compression
│
├── admin/                      # Browser admin UI for editing disks.json and backups
│   ├── index.html
│   ├── main.js
│   └── style.css
│
├── backend/                    # PHP API implementation
│   ├── bootstrap.php           # Loads backend libs/handlers
│   ├── constants.php           # Filename + report-pattern constants (mirrors check_disk/src/constants.py)
│   ├── router.php              # Dispatches api.php requests by type/action
│   ├── handlers/               # Endpoint handlers: disks, detail, dirs, files, treemap, admin, etc.
│   └── lib/                    # Shared backend libraries:
│       ├── request.php         #   param + b64 + sanitize helpers
│       ├── response.php        #   b64_success / b64_error / api_send_etag_cache (HTTP 304 flow)
│       ├── disks_walker.php    #   api_iterate_disks / api_find_team_disks / api_count_disks
│       ├── keyword.php         #   api_keyword_tokens / api_keyword_like_clause / api_keyword_match_path
│       ├── filesystem.php      #   JSON loaders + report-file discovery
│       ├── cache.php           #   File-backed cache for paginated payloads
│       ├── db_connection.php   #   Read-only SQLite PDO open + PRAGMA tuning
│       └── path_resolver.php   #   dir_id → full path resolution (single + batched)
│
├── css/                        # Source CSS plus generated *.min.css bundles
│   ├── core/                   # Design tokens, font declarations, core bundle
│   ├── layout/                 # Layout bundle and layout parts
│   ├── components/             # Component bundle and component parts
│   └── pages/                  # Page-specific styles
│
├── js/                         # Source ES modules plus generated *.min.js bundles
│   ├── core/                   # App bootstrap, router, data store
│   ├── services/               # Fetch orchestration and API data loading
│   │   ├── api.js              #   createApiClient() — fetchJson with cache + inflight dedup
│   │   ├── normalize.js        #   normalize{Dir,File}Row + payload normalisers (canonicalise legacy field names)
│   │   └── dataFetcher.js      #   Sync flow, scan-status polling, team chart, disk selector
│   ├── renderers/              # Dashboard tab renderers and Chart.js wrapper
│   ├── features/               # Feature modules such as group-user management
│   ├── ui/                     # Modals, tooltip, theme, boot helpers
│   ├── utils/                  # Reusable helpers:
│   │   ├── formatters.js       #   fmt / smartFmt / smartFmtTick / pickUnit / fmtDate
│   │   ├── dom.js              #   escHtml / pct / debounce
│   │   ├── sort.js             #   compareDiskCards + extractFromDataset / extractFromApiDisk
│   │   ├── csvExport.js        #   downloadCsv / toCsv / streamExportGzip
│   │   └── filterStorage.js    #   localStorage-backed filter persistence
│   └── vendor/                 # Self-hosted third-party browser assets
│
├── fonts/                      # Self-hosted Inter/Fira/JetBrains font files
├── tests/                      # Zero-dependency test suites (php/ + js/); see "Automated Tests"
├── playground/                  # Standalone UI playground assets
└── database/                   # Contains .gitkeep; runtime DB/backups are ignored

Local/ignored deployment files commonly present on a server:
├── disks.json                  # Disk/team configuration
├── package.json                # Optional local npm scripts/dependencies for building
├── scripts/                    # Smoke tests, benchmarks, regressions, log rotation helpers
├── docs/                       # Local runbooks, CI examples, architecture notes
├── .github/ and .gitlab-ci.yml # Local CI templates/examples
├── reports_system/             # Production scanner output
├── reports_test/               # Test scanner output
└── *.log, *.gz, database/*.db  # Runtime logs, rotated logs, admin DBs
```

---

## 🔧 Development

### Config Generator

Open `setup.html` in any browser to visually build your config files:

- **Scanner Config tab** — fill in scan directory, teams, and usernames → download `disk_checker_config.json`
- **Dashboard Config tab** — define teams and their disk volumes → download `disks.json`

No server required; everything runs client-side.

### Building frontend assets

The tracked app includes generated `*.min.js` and `*.min.css` bundles. On deployments that have a local `package.json`, rebuild them with:

```bash
npm run build
```

`build.mjs` also stamps a content-hash `?v=` onto the bundle tags in `index.html` on each full
build, so cache invalidation is automatic (see "Frontend build" above).

Because `.gitignore` ignores `*.json`, `package.json`, `package-lock.json`, and `disks.json` are treated as local deployment files unless explicitly force-added.

### Automated Tests

Zero-dependency suites (no Composer, no jest) under `tests/`:

```bash
npm test            # runs both suites
npm run test:php    # PHP — run on the 5.4 CLI so it also guards 5.4 syntax compat
npm run test:js     # JS — Node built-in node:test
```

- **PHP** (`tests/php/`): a tiny hand-rolled assert harness (`helpers.php` + `run.php`) over `*_test.php`. Covers pure logic (request/keyword/disks-walker helpers, base64 cursor codec, group-config sanitize, aggregate JSON validation, admin pbkdf2/hash/CSRF) and keyset cursor pagination against an in-memory SQLite DB (including size-tie boundaries).
- **JS** (`tests/js/`): `node:test`; `setup.mjs` stubs `document`/`window`/`localStorage` for modules that read the DOM at load. Covers formatters, `escHtml` (XSS contract), sort, normalize, the API client, route parsing, `DataStore` aggregation, plus a CSS layout guard asserting global-scope layout invariants.

DOM-heavy code (dataFetcher, renderers) is verified in a browser, not unit-tested.

### API Testing

```bash
# Snapshot + history
curl "http://localhost/disk_usage/api.php?id=disk_sda" | python3 -m json.tool | head -30

# Permission issues with filters
curl "http://localhost/disk_usage/api.php?id=disk_sda&type=permissions&item_type=file&path=/var/log&limit=10" \
  | python3 -m json.tool

# Unified user detail (cursor pagination)
USER_B64="$(printf '%s' 'user1' | base64 | tr -d '\n')"
curl "http://localhost/disk_usage/api.php?id=disk_sda&type=detail&user_b64=${USER_B64}&limit=50" \
  | python3 -m json.tool | head -30

# Per-user files with cursor (first page — no cursor param)
curl "http://localhost/disk_usage/api.php?id=disk_sda&type=files&user_b64=${USER_B64}&limit=50" \
  | python3 -m json.tool | head -30

# Treemap children
curl "http://localhost/disk_usage/api.php?id=disk_sda&type=treemap&shard_id=0&limit=50" \
  | python3 -m json.tool | head -30
```

### CSV Export

Each data tab exposes export buttons:

| Tab | Button | Behaviour |
|-----|--------|-----------|
| Permission Issues | Export Filtered | Downloads all items matching current user/type/path filters |
| Permission Issues | Export All | Downloads raw full permission report |
| Detail User | CSV (in card header) | Downloads dirs or files for the currently selected user |
| Detail User | Dirs CSV / Files CSV (picker bar) | Downloads dirs or files for all users |

Files are named `permissions_<disk_id>_filtered.csv`, `dirs_<disk_id>_<user>.csv`, etc.

### Server Configuration (`.htaccess`)

The bundled `.htaccess` handles three concerns for Apache deployments:

| Concern | What it does |
|---------|-------------|
| **Security** | `Options -Indexes` — prevents directory listing of report files |
| **SPA routing** | Redirects unknown paths to `index.html` so deep-links and refreshes work |
| **Performance** | `mod_expires` caches CSS/JS for 7 days; `mod_deflate` compresses HTML/CSS/JS/JSON responses |

---

## 🗺️ Data Flow

```
check_disk (CLI, server-side)
  └── Scans filesystem → writes JSON to report_dir/
        ├── disk_usage_report_20260322.json      (snapshot + dirs + users)
        ├── permission_issues_20260322.json       (inaccessible paths)
        ├── detail_users/data_detail.db           (unified per-user dirs/files)
        └── tree_map_data/treemap.db              (directory tree for treemap explorer)
api.php (PHP, web server)
  ├── Aggregates all disk_usage_report*.json → history timeline
  ├── Reads detail_users/data_detail.db → cursor-paginated user detail JSON
  ├── Reads tree_map_data/treemap.db → lazy-loaded treemap explorer
  └── Filters permission_issues.db server-side → paginated JSON

Browser (Vanilla JS, no framework)
  ├── Renders charts via Chart.js
  ├── Paginates large lists in-place (no full reload)
  └── Generates CSV entirely client-side from API JSON
```

---

_Built for teams managing large shared storage environments._



## 🧭 Architecture Note

This repository is the **dashboard/UI layer** of a two-part system:
- `check_disk` generates reports (`disk_usage_report*.json`, `permission_issues*.json`, `detail_users/*.db`, `tree_map_data/treemap.db`)
- `disk_usage` reads those reports and serves them via `api.php` + frontend renderers.

For a full end-to-end sequence (scanner → report files → PHP API → UI), see:
- `../system_architecture.md`

## ✅ Git Safety (avoid accidental commits)

The local `.gitignore` is intentionally broad because production deployments keep local config, reports, logs, CI examples, scripts, and runtime databases beside the app. It ignores:

- `*.json` including local `disks.json` and generated scanner/config files
- report output directories such as `reports/`, `reports_system/`, `reports_test/`, and `detail_users/`
- runtime databases and backups such as `database/*.db`, `*.sqlite`, and `*.sqlite3`
- local logs and rotated logs (`*.log`, `*.gz`)
- local ops/dev folders such as `docs/`, `scripts/`, `.github/`, `.agent/`, `.codex/`, and `node_modules/`
- deployment-only files such as `.htaccess`, `.gitlab-ci.yml`, `system_architecture.md`, and local build tooling metadata

Some ignored paths already contain tracked files that were intentionally versioned earlier, such as generated `*.min.js` / `*.min.css` and `build.mjs`. New files under ignored paths will not be added unless explicitly forced with `git add -f <file>`.

## 📄 License

[MIT](LICENSE)
