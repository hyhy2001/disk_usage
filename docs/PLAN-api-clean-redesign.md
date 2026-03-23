# PLAN: api-clean-redesign

> **Project:** Disk Usage Dashboard — Clean API Redesign
> **Type:** BACKEND (PHP 5.4+) + FRONTEND (Vanilla JS)
> **Date:** 2026-03-23
> **Status:** PLANNING COMPLETE — Ready for Implementation
> **Supersedes:** `PLAN-api-permission-refactor.md` (expanded scope)

---

## 📋 Overview

Thiết kế lại `api.php` từ đầu thành **một file sạch, dễ đọc** với:

- **Params đầy đủ, readable** — không viết tắt (`type` thay cho `t`, `user` thay cho `u`, v.v.)
- **Routing pattern rõ ràng** — mỗi endpoint có comment section riêng
- **Permission endpoint hỗ trợ seek/paginate** — giống `t=f` hiện tại
- **WAF-safe** — response base64 cho các endpoint nhỏ có thể bị WAF chặn keywords
- **PHP 5.4+ compatible** — không dùng syntax PHP 7.x+
- **Backward-compatible** — JS hiện tại vẫn chạy trong quá trình migration

---

## 🔍 Phân Tích Hiện Trạng

### Params cũ (cryptic) vs mới (readable)

| Endpoint | Param cũ | Param mới | Mô tả |
|----------|----------|-----------|-------|
| Main reports | `?dir=PATH` (không có `type`) | `?dir=PATH` | Aggregate disk reports |
| Permissions | `?dir=PATH&t=p` | `?dir=PATH&type=permissions` | Permissions paginated |
| User list | `?dir=PATH&t=u` | `?dir=PATH&type=users` | List users with detail reports |
| User dirs | `?dir=PATH&t=d&u=alice` | `?dir=PATH&type=dirs&user=alice` | Dir report for user |
| User files | `?dir=PATH&t=f&u=alice&o=0&n=500` | `?dir=PATH&type=files&user=alice&offset=0&limit=500` | Paginated file report |

### Bug phát hiện trong code hiện tại

1. **`dataFetcher.js` line 219**: gửi `diskConf?.path` tới `api.php?dir=...` — **đúng** vì `disks.json` thực ra chỉ có field `path` không có `dir` (tên gây nhầm lẫn trong plan trước đã được sửa)
2. **`dataFetcher.js` line 219**: stray param `&type=reports` không được `api.php` xử lý
3. **`api.php` main route**: không filter đúng — có thể đọc `permission_issues*.json` nếu regex logic thất bại
4. **`t=p`**: load toàn bộ JSON file vào RAM — không scale với file lớn

### Điều cần giữ nguyên

- Response format: `{ status: 'success', data: {...} }` — frontend đã expect
- Base64 encoding cho non-main endpoints — WAF-safe
- `has_more` flag trong `t=f` (files)
- Error handling: `{ status: 'error', message: '...' }`

---

## 🎯 Success Criteria

- [ ] `api.php` mới: mỗi endpoint dùng `type=X` param thay vì `t=X`
- [ ] Param names đầy đủ: `user`, `offset`, `limit`, `users` (comma-separated filter)
- [ ] Permissions endpoint: streaming pagination với `offset`/`limit`/`users` filter
- [ ] Permissions endpoint: trả `user_summary` (unfiltered) + `total` (sau filter) + `has_more`
- [ ] Main report: chỉ đọc `report_*.json` và `disk_usage_report*.json` (loại trừ permission, detail files)
- [ ] PHP 5.4+ compatible — pass compat checklist
- [ ] JS side updated: `dataFetcher.js` và `permissionRenderer.js` dùng params mới
- [ ] Không có console errors sau migrate

---

## 📐 New API Design

### Base URL pattern

```
GET api.php?dir={relative_disk_path}&type={endpoint}[&params]
```

> `dir` luôn là relative path từ webroot tới folder disk (e.g. `mock_reports/disk_sda`)

### Endpoint Table

| `type=` | Params | Response | Encoding |
|---------|--------|----------|----------|
| _(omit)_ | — | Main report aggregate | Plain JSON |
| `permissions` | `offset`, `limit`, `users` | Paginated permission items | Base64 JSON |
| `users` | — | List of users with detail reports | Base64 JSON |
| `dirs` | `user` | Full dir report for user | Base64 JSON |
| `files` | `user`, `offset`, `limit` | Paginated file report | Base64 JSON |

### Response Schemas

**Default (main reports):**
```json
{
  "status": "success",
  "total_files": 10,
  "data": [
    {
      "date": 1737000000,
      "directory": "/var/data/shared",
      "general_system": { "total": 1000000000000, "used": 400000000000, "available": 600000000000 },
      "team_usage": [ { "name": "VN", "used": 100000000000 } ],
      "user_usage": [ { "name": "alice", "used": 50000000000 } ],
      "other_usage": [ { "name": "www-data", "used": 5000000000 } ]
    }
  ]
}
```

**`type=permissions`:**
```json
{
  "status": "success",
  "data": {
    "date": 1737000000,
    "directory": "/var/data/shared",
    "total": 342,
    "offset": 0,
    "limit": 100,
    "has_more": true,
    "items": [
      { "user": "alice", "path": "/data/secrets", "type": "directory", "error": "Permission denied" }
    ],
    "user_summary": { "alice": 150, "bob": 192, "__unknown__": 5 }
  }
}
```

**`type=users`:**
```json
{
  "status": "success",
  "data": { "users": ["alice", "bob", "charlie"] }
}
```

**`type=dirs`:**
```json
{
  "status": "success",
  "data": {
    "dir": {
      "date": 1737000000,
      "user": "alice",
      "total_used": 5000000000,
      "dirs": [ { "path": "/data/alice/projects", "used": 3000000000 } ]
    }
  }
}
```

**`type=files`:**
```json
{
  "status": "success",
  "data": {
    "file": {
      "date": 1737000000,
      "user": "alice",
      "total_files": 2500,
      "total_used": 5000000000,
      "offset": 0,
      "limit": 500,
      "has_more": true,
      "files": [ { "path": "/data/alice/model.bin", "size": 1000000000 } ]
    }
  }
}
```

---

## 📁 Files To Change

```
disk_usage/
├── api.php                     [REWRITE] — clean redesign
├── js/
│   ├── dataFetcher.js          [MODIFY] — update params, fix stray &type=reports
│   ├── userDetailRenderer.js   [MODIFY] — t=d→type=dirs, t=f→type=files, t=u→type=users
│   └── permissionRenderer.js   [REWRITE] — server-side pagination với new API
└── docs/
    └── PLAN-api-clean-redesign.md  [this file]
```

---

## 📊 Task Breakdown

### Phase 1 — Analysis ✅ (done, see above)

---

### Phase 2 — Planning ✅ (this file)

---

### Phase 3 — Solutioning

#### API PHP Structure Design

```php
<?php
// api.php - Disk Usage API (PHP 5.4+)
//
// Endpoints:
//   ?dir=PATH                           → main disk reports (JSON)
//   ?dir=PATH&type=permissions          → paginated permission issues (base64 JSON)
//   ?dir=PATH&type=permissions&offset=0&limit=100&users=alice,bob
//   ?dir=PATH&type=users                → list users with detail reports (base64 JSON)
//   ?dir=PATH&type=dirs&user=alice      → user directory report (base64 JSON)
//   ?dir=PATH&type=files&user=alice&offset=0&limit=500 → paginated files (base64 JSON)
//
// Security:
//   - dir param: reject '..' traversal, must be non-empty
//   - user param: sanitized to [a-zA-Z0-9_-]
//   - All paths resolved relative to __DIR__

// ── Helpers ──────────────────────────────────────────────────────────────────

function param($key, $default) {
    return isset($_GET[$key]) ? $_GET[$key] : $default;
}

function respond_b64($payload) {
    echo base64_encode(json_encode($payload));
    exit;
}

function respond_json($payload) {
    echo json_encode($payload);
    exit;
}

function error_b64($message, $code = 400) {
    http_response_code($code);
    respond_b64(array('status' => 'error', 'message' => $message));
}

function sanitize_user($raw) {
    return preg_replace('/[^a-zA-Z0-9_\-]/', '', $raw);
}

// ── Request parsing ──────────────────────────────────────────────────────────

$base_dir = __DIR__;
$req_dir  = trim(param('dir', ''), '/\\');
$type     = param('type', '');

// Security: reject traversal, empty dir
if ($req_dir === '' || strpos($req_dir, '..') !== false) {
    http_response_code(403);
    echo 'Access denied.';
    exit;
}

$disk_path = $base_dir . DIRECTORY_SEPARATOR . $req_dir;

if (!is_dir($disk_path) && !is_link($disk_path)) {
    http_response_code(404);
    echo 'Directory not found.';
    exit;
}

header('Content-Type: text/plain; charset=utf-8');

// ── Route: permissions ───────────────────────────────────────────────────────
if ($type === 'permissions') {
    // ... (see Task 4.2)
}

// ── Route: users ─────────────────────────────────────────────────────────────
if ($type === 'users') {
    // ... (see Task 4.3)
}

// ── Route: dirs ──────────────────────────────────────────────────────────────
if ($type === 'dirs') {
    // ... (see Task 4.3)
}

// ── Route: files ─────────────────────────────────────────────────────────────
if ($type === 'files') {
    // ... (see Task 4.3)
}

// ── Route: main (default) ────────────────────────────────────────────────────
// Aggregate all report_*.json / disk_usage_report*.json files
// ... (see Task 4.1)
```

---

### Phase 4 — Implementation

#### Task 4.1: Rewrite `api.php` — main report route

- **Agent:** `backend-specialist`
- **Priority:** P0
- **File:** `api.php`

**Logic:**
```php
// Default route: aggregate disk usage reports
$dh    = @opendir($disk_path);
$files = array();
while ($dh && ($f = readdir($dh)) !== false) {
    // Only include: report_*.json OR disk_usage_report*.json
    // Exclude: permission_issues*, detail_report*
    $is_report = (strpos($f, 'report_') === 0 || strpos($f, 'disk_usage_report') === 0)
              && substr($f, -5) === '.json'
              && strpos($f, 'permission_issues') === false
              && strpos($f, 'detail_report') === false;
    if ($is_report) {
        $files[] = $disk_path . DIRECTORY_SEPARATOR . $f;
    }
}
if ($dh) closedir($dh);
sort($files);

$agg = array();
foreach ($files as $file) {
    $c = file_get_contents($file);
    if ($c === false) continue;
    $j = json_decode($c, true);
    if ($j !== null) $agg[] = $j;
}

header('Cache-Control: public, max-age=60');
respond_json(array(
    'status'      => 'success',
    'total_files' => count($agg),
    'data'        => $agg,
));
```

- **VERIFY:**
  ```bash
  curl "https://disk.hydev.me/api.php?dir=mock_reports/disk_sda" | python3 -m json.tool | head -5
  # Expect: {"status": "success", "total_files": N, "data": [...]}
  ```

---

#### Task 4.2: Rewrite `api.php` — `type=permissions` route

- **Agent:** `backend-specialist`
- **Priority:** P1 (core feature upgrade)
- **File:** `api.php`

**Algorithm:**
```
1. Scan $disk_path for newest permission_issues*.json (sort by mtime desc)
2. Load file (file_get_contents — permission files ok < 10MB typically)
3. Normalize: support both formats:
   - New flat: permission_issues.items[]
   - Old nested: permission_issues.users[].inaccessible_items[]
4. Build user_summary (UNFILTERED — always full counts)
5. Apply users filter if `users` param provided
6. total = count after filter
7. Return items[offset..offset+limit], has_more, user_summary
```

```php
if ($type === 'permissions') {
    $offset = max(0,    (int)param('offset', 0));
    $limit  = min(5000, max(1, (int)param('limit',  100)));
    $users_raw = param('users', '');
    $user_filter = ($users_raw !== '') ? explode(',', $users_raw) : array();

    // Find latest permission file
    $perm_file = null;
    $perm_mtime = 0;
    $dh = @opendir($disk_path);
    while ($dh && ($f = readdir($dh)) !== false) {
        if (strpos($f, 'permission_issues') !== false && substr($f, -5) === '.json') {
            $fp = $disk_path . DIRECTORY_SEPARATOR . $f;
            $mt = @filemtime($fp);
            if ($mt > $perm_mtime) { $perm_file = $fp; $perm_mtime = $mt; }
        }
    }
    if ($dh) closedir($dh);

    if (!$perm_file) {
        respond_b64(array('status' => 'success', 'data' => null));
    }

    $raw_json = @file_get_contents($perm_file);
    if ($raw_json === false) {
        error_b64('Cannot read permission file.', 500);
    }

    $doc = json_decode($raw_json, true);
    $iss = isset($doc['permission_issues']) ? $doc['permission_issues'] : array();

    // Normalize to flat items[]
    if (isset($iss['items'])) {
        $items = $iss['items'];
    } else {
        $items = array();
        foreach (isset($iss['users']) ? $iss['users'] : array() as $u) {
            $uname = isset($u['name']) ? $u['name'] : '';
            foreach (isset($u['inaccessible_items']) ? $u['inaccessible_items'] : array() as $it) {
                $items[] = array(
                    'user'  => $uname,
                    'path'  => isset($it['path'])  ? $it['path']  : '',
                    'type'  => isset($it['type'])  ? $it['type']  : '',
                    'error' => isset($it['error']) ? $it['error'] : '',
                );
            }
        }
        foreach (isset($iss['unknown_items']) ? $iss['unknown_items'] : array() as $it) {
            $items[] = array(
                'user'  => '__unknown__',
                'path'  => isset($it['path'])  ? $it['path']  : '',
                'type'  => isset($it['type'])  ? $it['type']  : '',
                'error' => isset($it['error']) ? $it['error'] : '',
            );
        }
    }

    // Build user_summary BEFORE filtering
    $user_summary = array();
    foreach ($items as $it) {
        $u = isset($it['user']) ? $it['user'] : '__unknown__';
        $user_summary[$u] = isset($user_summary[$u]) ? $user_summary[$u] + 1 : 1;
    }

    // Apply user filter
    if (!empty($user_filter)) {
        $uf = $user_filter; // capture for PHP 5.4 closure
        $items = array_values(array_filter($items, function($it) use ($uf) {
            return in_array(isset($it['user']) ? $it['user'] : '', $uf);
        }));
    }

    $total    = count($items);
    $page     = array_slice($items, $offset, $limit);
    $has_more = ($offset + count($page)) < $total;

    respond_b64(array('status' => 'success', 'data' => array(
        'date'         => isset($doc['date'])      ? $doc['date']      : null,
        'directory'    => isset($doc['directory']) ? $doc['directory'] : null,
        'total'        => $total,
        'offset'       => $offset,
        'limit'        => $limit,
        'has_more'     => $has_more,
        'items'        => $page,
        'user_summary' => $user_summary,
    )));
}
```

- **VERIFY:**
  ```bash
  # Page 1
  curl "https://disk.hydev.me/api.php?dir=mock_reports/disk_sda&type=permissions" \
    | base64 -d | python3 -m json.tool | grep -E '"total|has_more|offset|user_summary"'

  # Page 2
  curl "https://disk.hydev.me/api.php?dir=mock_reports/disk_sda&type=permissions&offset=100&limit=100" \
    | base64 -d | python3 -m json.tool | grep '"offset"'

  # Filtered by user
  curl "https://disk.hydev.me/api.php?dir=mock_reports/disk_sda&type=permissions&users=user1,user2" \
    | base64 -d | python3 -m json.tool | head -20
  ```

---

#### Task 4.3: Migrate `type=users`, `type=dirs`, `type=files` routes

- **Agent:** `backend-specialist`
- **Priority:** P1
- **File:** `api.php`
- **INPUT:** Logic hiện tại của `t=u`, `t=d`, `t=f` — giữ nguyên logic, chỉ rename params
- **OUTPUT:** Same logic, new param names

**Param mapping:**

| Old | New |
|-----|-----|
| `t=u` | `type=users` |
| `t=d` | `type=dirs` |
| `t=f` | `type=files` |
| `u=alice` | `user=alice` |
| `o=N` | `offset=N` |
| `n=N` | `limit=N` |

**Common sanitization:**
```php
$user = sanitize_user(param('user', ''));
// Same as before: preg_replace('/[^a-zA-Z0-9_\-]/', '', $_GET['u'])
```

- **VERIFY:**
  ```bash
  curl "https://disk.hydev.me/api.php?dir=mock_reports/disk_sda&type=users" | base64 -d | python3 -m json.tool
  curl "https://disk.hydev.me/api.php?dir=mock_reports/disk_sda&type=dirs&user=user1" | base64 -d | python3 -m json.tool | head -5
  curl "https://disk.hydev.me/api.php?dir=mock_reports/disk_sda&type=files&user=user1&offset=0&limit=10" | base64 -d | python3 -m json.tool | head -10
  ```

---

#### Task 4.4: Update `js/userDetailRenderer.js` — new param names

- **Agent:** `frontend-specialist`
- **Priority:** P1
- **File:** `js/userDetailRenderer.js`
- **INPUT:** 3 fetch functions dùng param cũ
- **OUTPUT:** Updated fetch functions

**Changes (line 214, 223, 232):**
```js
// _fetchDir: t=d&u=X → type=dirs&user=X
async function _fetchDir(diskDir, user) {
    const url = `api.php?dir=${encodeURIComponent(diskDir)}&type=dirs&user=${encodeURIComponent(user)}`;
    // ...
}

// _fetchFilePage: t=f&u=X&o=N&n=N → type=files&user=X&offset=N&limit=N
async function _fetchFilePage(diskDir, user, offset, limit) {
    const url = `api.php?dir=${encodeURIComponent(diskDir)}&type=files&user=${encodeURIComponent(user)}&offset=${offset}&limit=${limit}`;
    // ...
}

// _fetchUserList: t=u → type=users
async function _fetchUserList(diskDir) {
    const url = `api.php?dir=${encodeURIComponent(diskDir)}&type=users`;
    // ...
}
```

- **VERIFY:** Detail User tab vẫn hoạt động đúng — dir list, file list, pagination

---

#### Task 4.5: Update `js/dataFetcher.js` — fix & clean

- **Agent:** `frontend-specialist`
- **Priority:** P0 (bug fix)
- **File:** `js/dataFetcher.js`

**Changes:**

1. Remove stray `&type=reports` from main fetch (line 219):
```js
// BEFORE:
const response = await fetch(`api.php?dir=${encodeURIComponent(diskPath)}&type=reports`);

// AFTER (diskPath already correct — it's disks.json "path" field):
const response = await fetch(`api.php?dir=${encodeURIComponent(diskPath)}`);
```

2. Update permission fetch (line 292) — new param name:
```js
// BEFORE:
const res = await fetch(`api.php?dir=${encodeURIComponent(diskPath)}&t=p`);

// AFTER:
const res = await fetch(`api.php?dir=${encodeURIComponent(diskPath)}&type=permissions`);
```

3. Pass `diskPath` (not `diskPath`) to `initUserDetailTab` — already correct, verify:
```js
// line 57-59: initUserDetailTab(diskPath, otherUsers) — diskPath = diskConf?.path
// This is CORRECT since disks.json only has "path" field
```

- **VERIFY:** Network tab in DevTools — no stray params, no 404s

---

#### Task 4.6: Rewrite `js/permissionRenderer.js` — server-side pagination

- **Agent:** `frontend-specialist`
- **Priority:** P1
- **File:** `js/permissionRenderer.js`

**Architecture change:**

```
BEFORE (client-side):
  Event: permissionsLoaded → full items[] from 1 API call
  _allItems = all items
  _filtered() = slice from _allItems
  _update()   = no API call

AFTER (server-side):
  Event: permissionsLoaded → initial page 1 data (50-100 items)
  _diskDir    = disk path (for subsequent API calls)
  _allItems   = current page only
  async _fetchPage(page, users) → API call → update display
  _update()   = calls _fetchPage()
```

**New module state:**
```js
let _diskDir      = null;   // for API calls
let _permPage     = 1;
let _totalItems   = 0;      // from API response (after filter)
let _hasMore      = false;
let _userSummary  = {};     // from API response (unfiltered)
let _activeUsers  = new Set();
let _fetchInProgress = false;
let _abortCtrl    = null;
```

**New fetch function:**
```js
async function _fetchPage(page) {
    if (_fetchInProgress) { if (_abortCtrl) _abortCtrl.abort(); }
    _abortCtrl = new AbortController();
    _fetchInProgress = true;

    const offset   = (page - 1) * PERM_PAGE;
    const usFilter = _activeUsers.size > 0
        ? '&users=' + encodeURIComponent([..._activeUsers].join(','))
        : '';
    const url = `api.php?dir=${encodeURIComponent(_diskDir)}&type=permissions&offset=${offset}&limit=${PERM_PAGE}${usFilter}`;

    try {
        const res  = await fetch(url, { signal: _abortCtrl.signal });
        const json = JSON.parse(atob(await res.text()));
        if (json?.status !== 'success') throw new Error('API error');

        const data     = json.data;
        _allItems      = data.items || [];
        _totalItems    = data.total || 0;
        _hasMore       = data.has_more || false;
        _permPage      = page;
        if (data.user_summary) _userSummary = data.user_summary;

        _renderCurrentPage();
    } catch (err) {
        if (err.name !== 'AbortError') _renderError(err);
    } finally {
        _fetchInProgress = false;
    }
}
```

**Initial render flow:**
```js
document.addEventListener('permissionsLoaded', function(e) {
    const detail = e.detail || {};
    _diskDir = detail.diskDir;

    if (!detail.items) {
        renderEmpty();
        return;
    }

    // First paint uses data from event (page 1)
    _allItems      = detail.items || [];
    _totalItems    = detail.total || 0;
    _hasMore       = detail.has_more || false;
    _userSummary   = detail.user_summary || {};
    _permPage      = 1;
    _activeUsers   = new Set(); // all = empty set
    _pathQuery     = '';

    _renderLayout();  // renders sidebar + list + pagination
});
```

**User filter → reset page + re-fetch:**
```js
window._permToggle = function(el) {
    // toggle _activeUsers set
    // ...
    _permPage = 1;
    _fetchPage(1); // server re-fetch
};
```

**Pagination click → fetch new page:**
```js
// pager click → _fetchPage(newPage)
```

> **Note:** `_pathQuery` (path search) tetap client-side filter trên `_allItems` (current page only).
> Nếu search khớp partial page results — đây là acceptable UX trade-off vs extra server round-trip.

- **VERIFY:**
  - Permission tab mở → load page 1 ngay ✅
  - Click page 2 → server fetch offset=100 ✅
  - Filter user → reset page 1, filter server-side ✅
  - Đổi disk → permission state reset ✅
  - `user_summary` sidebar đúng counts ✅

---

### Phase X — Verification Checklist

#### PHP Compat Check (manual)

- [ ] No `??` (null coalescing — PHP 7.0+)
- [ ] No `...` spread (PHP 5.6+ cho arrays, OK; nhưng trong function call PHP 5.6+)
- [ ] No `fn() =>` arrow functions (PHP 7.4+)
- [ ] No `match` expression (PHP 8.0+)
- [ ] No `array_key_first()` (PHP 7.3+)
- [ ] `array()` hoặc `[]` — cả hai OK từ PHP 5.4
- [ ] Closures với `use ($var)` — OK từ PHP 5.3
- [ ] `array_filter` với closure — OK từ PHP 5.3

#### API Tests (curl)

```bash
BASE="https://disk.hydev.me/api.php?dir=mock_reports/disk_sda"

# 1. Main reports
curl "$BASE" | python3 -m json.tool | grep -E '"status|total_files"'

# 2. Permissions page 1
curl "$BASE&type=permissions" | base64 -d | python3 -m json.tool | grep -E '"total|has_more|offset|user_summary"' | head -10

# 3. Permissions page 2
curl "$BASE&type=permissions&offset=100&limit=100" | base64 -d | python3 -m json.tool | grep '"offset"'

# 4. Permissions with user filter
curl "$BASE&type=permissions&users=user1,user3" | base64 -d | python3 -m json.tool | head -15

# 5. User list
curl "$BASE&type=users" | base64 -d | python3 -m json.tool

# 6. User dirs
curl "$BASE&type=dirs&user=user1" | base64 -d | python3 -m json.tool | head -10

# 7. User files page 1
curl "$BASE&type=files&user=user1&offset=0&limit=10" | base64 -d | python3 -m json.tool | grep -E '"has_more|total_files"'
```

#### Browser Tests

- [ ] Dashboard loads, Overview tab renders ✅
- [ ] Segment disk → all tabs reload ✅
- [ ] Detail User tab: user picker, dir card, file card ✅
- [ ] Detail User tab: pagination (page 2, 3) ✅
- [ ] Permission Issues tab: auto-loads on click ✅
- [ ] Permission Issues tab: pagination navigates (server fetch) ✅
- [ ] Permission Issues tab: user filter works ✅
- [ ] Permission Issues tab: `user_summary` sidebar shows correct totals ✅
- [ ] DevTools Network: no `&type=reports` stray params ✅
- [ ] DevTools Console: no errors ✅

---

## ⚠️ Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Permission file > 50MB** | `file_get_contents` tốn RAM | Current mock files < 2MB. Flag for future: implement fgets seek nếu files grow |
| **Concurrent permission fetches** | Race condition, stale render | `_abortCtrl` + `_fetchInProgress` flag trong JS |
| **WAF block `type=permissions` keyword** | API requests blocked | Base64 response đã dùng; nếu URL bị chặn → dùng POST hoặc encode param |
| **Backward compat với JS cũ** | Detail tab broken | Update all 3 files trong cùng deploy |
| **`_pathQuery` client-side** | Search chỉ filter current page | Acceptable UX; document trong code comment |

---

## 🔗 Task Dependency Graph

```
4.1 (main route)     ──┐
4.2 (permissions)    ──┤
4.3 (users/dirs/files)─┤── deploy api.php ──► 4.4 (userDetailRenderer)
                        │                  ├─► 4.5 (dataFetcher)
                        │                  └─► 4.6 (permissionRenderer)
                        │
                        └── All PHP done before ANY JS update
```

**Recommended order:**
1. `4.1 + 4.2 + 4.3` — Toàn bộ `api.php` trong một lần edit
2. `4.4 + 4.5 + 4.6` — Toàn bộ JS sau khi API deployed
3. Phase X verification

---

> **Next:** Run `/enhance` hoặc "bắt đầu implement" để tiến hành theo task order.
