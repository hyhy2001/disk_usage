# PLAN: api-permission-refactor

> **Project:** Disk Usage Dashboard — API Performance & Permission Seek Upgrade
> **Type:** BACKEND (PHP) + FRONTEND (Vanilla JS)
> **Date:** 2026-03-23
> **Status:** PLANNING COMPLETE — Ready for Implementation

---

## 📋 Overview

Ba mục tiêu chính trong plan này:

1. **Cải thiện `api.php`** — hỗ trợ tốt hơn việc lấy JSON, đảm bảo PHP 5.4+ compatible, fix URL parameter không nhất quán (`diskPath` vs `dir`), tối ưu aggregation main reports.
2. **Thêm seek-line cho `t=p` (permission API)** — hiện tại `t=p` load _toàn bộ file_ vào RAM trước khi paginate. Cần refactor theo mô hình `t=f` (line-by-line streaming với offset/limit) để xử lý permission files lớn hiệu quả.
3. **Refactor & clean up code** — codebase ở nhiều conversation khác nhau đã tích lũy code không nhất quán (orphaned `permission_api.php` reference trong docs, `diskPath` vs `dir` parameter mismatch, unused variables trong `dataFetcher.js`).

---

## 🏗️ Kiến Trúc Hiện Tại

### Request Flow

```
Browser JS                      api.php (PHP 5.4+)
──────────                      ──────────────────
fetch(api.php?dir=PATH)      →  [default] aggregate disk_usage_report*.json
fetch(api.php?dir=PATH&t=p)  →  [t=p] load ENTIRE permission file → paginate
fetch(api.php?dir=PATH&t=u)  →  [t=u] list detail users
fetch(api.php?dir=PATH&t=d&u=X) → [t=d] full dir JSON
fetch(api.php?dir=PATH&t=f&u=X&o=N&n=500) → [t=f] STREAMING file JSON
```

### Vấn đề với `t=p` hiện tại

```
File permission_issues_20250101.json (có thể 50MB+)
        ↓
file_get_contents() → load TOÀN BỘ vào RAM
        ↓
json_decode(entire file) → parse all
        ↓
return $items[$offset..$offset+$limit]  ← paginate AFTER load
```

**So sánh với `t=f` (user file API) — cách đúng:**

```
File detail_report_file_alice.json
        ↓
fopen() → fgets() line-by-line
        ↓
skip header → count items until $offset
        ↓
collect $limit items → break early
        ↓
return collected items + has_more flag
```

---

## 🎯 Success Criteria

- [ ] `api.php?dir=PATH&t=p` trả về paginated data với `offset` và `limit` params (như `t=f`)
- [ ] Permission file lớn (50MB+) không load toàn bộ vào RAM
- [ ] `user_summary` được tính mà không load toàn bộ items (hoặc cached trong 1 pass)
- [ ] API response format nhất quán giữa `t=p` và hiện tại
- [ ] `permissionRenderer.js` chuyển sang server-side pagination (gọi API mỗi lần đổi page)
- [ ] PHP 5.4+ compatible (không dùng `??`, arrow functions, `match`, v.v.)
- [ ] Không có breaking changes với mock data hiện tại
- [ ] Main report aggregation hoạt động đúng với các tên file hiện tại (`report_YYYYMMDD.json`)

---

## 🛠️ Tech Stack

| Layer | Tech | Lý do |
|-------|------|-------|
| Backend API | PHP 5.4+ | Constraint từ server |
| Streaming | `fopen`/`fgets` | Line-by-line, O(page_size) RAM |
| Frontend Pagination | Vanilla JS fetch | Nhất quán với `userDetailRenderer.js` |
| Data Format | JSON over base64 | WAF-safe, đã dùng cho t=p |

---

## 📁 Files Affected

```
disk_usage/
├── api.php                     [MODIFY] — thêm seek/paginate cho t=p
├── js/
│   ├── dataFetcher.js          [MODIFY] — fix diskPath→dir mismatch, permission fetch
│   ├── permissionRenderer.js   [MODIFY] — chuyển sang server-side pagination
│   └── userDetailRenderer.js   [REFERENCE] — mô hình pagination cần follow
└── docs/
    └── PLAN-api-permission-refactor.md  [this file]
```

**Files NOT touched:**
- `css/` — không thay đổi styling
- `index.html` — không thay đổi markup
- `generate_mock_json.py` — không thay đổi format
- `check_disk/` — không liên quan

---

## 📊 Task Breakdown

### Phase 1 — ANALYSIS ✅

**Task 1.1: Map parameter mismatch (already done)**
- `dataFetcher.js` line 219: `api.php?dir=${diskConf?.path}` — dùng `path` (filesystem path như `/var/data/shared`)
- `api.php` line 22: `$reqDir = $_GET['dir']` — expect relative directory từ webroot (như `mock_reports/disk_sda`)
- `disks.json`: có cả `dir` (relative path) và `path` (filesystem path)
- **Issue:** JS đang dùng `diskConf?.path` thay vì `diskConf?.dir`
- **Status:** ✅ Identified

**Task 1.2: Map permission file format (already done)**
- Mock format: `{ date, directory, general_system, permission_issues: { total, items: [...] } }`
- `api.php t=p`: đọc `permission_issues.items` hoặc Convert từ old `users[].inaccessible_items[]`
- `permissionRenderer.js`: nhận `{ date, directory, total, items }` qua `permissionsLoaded` event
- **Status:** ✅ Identified

---

### Phase 2 — PLANNING ✅ (this file)

---

### Phase 3 — SOLUTIONING

**Task 3.1: Design t=p seek API**

**New params cho `t=p`:**

| Param | Default | Description |
|-------|---------|-------------|
| `o` | `0` | Offset (row index) |
| `n` | `100` | Limit per page, max `5000` |
| `us` | _(omit)_ | Comma-separated user filter (e.g. `alice,bob`) |

**Response format (base64 JSON):**

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
      { "user": "alice", "path": "/data/...", "type": "directory", "error": "Permission denied" }
    ],
    "user_summary": { "alice": 150, "bob": 192 }
  }
}
```

**Streaming algorithm cho t=p:**

```
1. fopen permission file
2. Skip header lines (find "items" array start)
3. Collect ALL items vào một mảng nhỏ (bắt buộc để build user_summary)
   → Alternative: 2-pass (pass 1: count per user, pass 2: paginate)
   → Chọn: 1-pass nếu file < 10MB, else lazy user_summary từ first_page_only
4. Apply user filter (nếu có `us` param)
5. Return items[offset..offset+limit] + has_more + user_summary
```

> **Note:** Permission files thường nhỏ hơn detail file (< 5MB so với 100MB+). 
> Option A (full load + paginate): OK cho files < 10MB, đơn giản, vẫn giữ `user_summary` chính xác.
> Option B (seek line): phức tạp hơn nhưng handle large files.
> **Decision: Implement Option A với memory guard; Option B chỉ nếu real files > 10MB.**

**Task 3.2: Design JS pagination flow**

```
permissionRenderer.js (hiện tại — client-side):
  _allItems = data.items (toàn bộ data từ 1 API call)
  _filtered() → slice by page → render

permissionRenderer.js (mới — server-side):
  _currentPage = 1
  _activeUsers = Set()
  
  loadPage(page, users):
    params = { t:'p', dir:diskPath, o:(page-1)*100, n:100, us:users.join(',') }
    fetch(api.php?...) → base64 decode → render items
    update pagination với total + has_more
```

---

### Phase 4 — IMPLEMENTATION

> **Thứ tự:** Backend trước (api.php) → Frontend sau (dataFetcher + permissionRenderer)

---

#### Task 4.1: Fix `diskPath` → `dir` mismatch trong `dataFetcher.js`

- **Agent:** `frontend-specialist`
- **Priority:** P0 (blocker nếu production dùng wrong path)
- **File:** `js/dataFetcher.js`
- **INPUT:** `disks.json` có `{ id, name, dir, path }` — `dir` là relative API path, `path` là filesystem path
- **OUTPUT:** Tất cả `api.php` calls dùng `diskConf.dir` thay vì `diskConf.path`

**Changes:**
```js
// Line 219 in dataFetcher.js — startServerSync()
// BEFORE:
const diskPath = diskConf?.path || this._activeDisk;
const response = await fetch(`api.php?dir=${encodeURIComponent(diskPath)}&type=reports`);

// AFTER:
const diskDir = diskConf?.dir || this._activeDisk;
const response = await fetch(`api.php?dir=${encodeURIComponent(diskDir)}`);
```

```js
// Line 292 in dataFetcher.js — _fetchPermissions()
// BEFORE:
const diskPath = diskConf?.path || this._activeDisk;
const res = await fetch(`api.php?dir=${encodeURIComponent(diskPath)}&t=p`);

// AFTER:
const diskDir = diskConf?.dir || this._activeDisk;
const res = await fetch(`api.php?dir=${encodeURIComponent(diskDir)}&t=p`);
```

Also in user detail tab (line 57-59):
```js
// BEFORE:
const diskPath = diskConf?.path || this._activeDisk;
initUserDetailTab(diskPath, otherUsers);

// AFTER:
const diskDir = diskConf?.dir || this._activeDisk;
initUserDetailTab(diskDir, otherUsers);
```

- **VERIFY:** `curl "https://disk.hydev.me/api.php?dir=mock_reports/disk_sda"` → 200 với data

---

#### Task 4.2: Cải thiện `api.php` — main report aggregation

- **Agent:** `backend-specialist`
- **Priority:** P1
- **File:** `api.php`
- **INPUT:** Hiện tại filter file với `strpos($f, 'permission_issues') === false` — cần cũng exclude `detail_users/` path và các file không liên quan
- **OUTPUT:** Clean aggregation, chỉ đọc `report_*.json` hoặc `disk_usage_report*.json`

**Changes:**
```php
// BEFORE: accept bất kỳ .json file nào không có 'permission_issues' trong tên
if (substr($f, -5) === '.json' && strpos($f, 'permission_issues') === false) {

// AFTER: chỉ accept files khớp pattern report_*.json
if (substr($f, -5) === '.json' 
    && strpos($f, 'permission_issues') === false
    && strpos($f, 'detail_report') === false
    && (strpos($f, 'report_') === 0 || strpos($f, 'disk_usage_report') === 0)) {
```

Also thêm **cache header** cho response:
```php
// Add after Content-Type header in default route
header('Cache-Control: public, max-age=60'); // 1 min cache
```

- **VERIFY:** `curl` returns only `report_YYYYMMDD.json` data, không lẫn permission files

---

#### Task 4.3: Refactor `t=p` — thêm pagination params

- **Agent:** `backend-specialist`
- **Priority:** P1
- **File:** `api.php` — section `t=p` (lines 44-96)
- **INPUT:** Hiện tại load toàn bộ items, không paginate
- **OUTPUT:** Support `o` (offset) và `n` (limit) params, `us` (users filter), `user_summary`

**New `t=p` logic:**

```php
if ($t === 'p') {
    $off  = max(0,    (int)_g($_GET, 'o', 0));
    $lim  = min(5000, max(1, (int)_g($_GET, 'n', 100)));
    $usf  = isset($_GET['us']) && $_GET['us'] !== '' 
            ? explode(',', $_GET['us']) : array();

    // [existing: find latest permission file]
    // [existing: load and normalize items array]
    
    // Build user_summary (always unfiltered)
    $user_summary = array();
    foreach ($items as $it) {
        $u = _g($it, 'user', '__unknown__');
        $user_summary[$u] = isset($user_summary[$u]) ? $user_summary[$u] + 1 : 1;
    }
    
    // Apply user filter
    if (!empty($usf)) {
        $items = array_values(array_filter($items, function($it) use ($usf) {
            return in_array(_g($it, 'user', ''), $usf);
        }));
    }
    
    $total    = count($items);
    $page     = array_slice($items, $off, $lim);
    $has_more = ($off + count($page)) < $total;
    
    $data = array(
        'date'         => _g($raw2, 'date', null),
        'directory'    => _g($raw2, 'directory', null),
        'total'        => $total,
        'offset'       => $off,
        'limit'        => $lim,
        'has_more'     => $has_more,
        'items'        => $page,
        'user_summary' => $user_summary,
    );
    echo base64_encode(json_encode(array('status' => 'success', 'data' => $data)));
    exit;
}
```

- **VERIFY:**
  ```bash
  curl "https://disk.hydev.me/api.php?dir=mock_reports/disk_sda&t=p" | base64 -d | python3 -m json.tool | head -20
  curl "https://disk.hydev.me/api.php?dir=mock_reports/disk_sda&t=p&o=100&n=50" | base64 -d | python3 -m json.tool | head -10
  ```

---

#### Task 4.4: Update `permissionRenderer.js` — server-side pagination

- **Agent:** `frontend-specialist`
- **Priority:** P1
- **File:** `js/permissionRenderer.js`
- **INPUT:** Hiện tại client-side: `_allItems` = full array từ 1 API call
- **OUTPUT:** Server-side: fetch per page, `_allItems` chỉ chứa current page

**Key changes:**

1. Thêm module-level state: `_diskDir`, `_totalCount`, `_hasMore`
2. Hàm `_fetchPage(page, users)` — async fetch page từ API
3. `_update()` → gọi `_fetchPage()` thay vì slice local array
4. `renderPermissions(data)` → nhận initial data từ event, render page 1
5. User filter (sidebar toggle) → reset `_permPage = 1` → `_fetchPage()`
6. `user_summary` từ API response (không tính client-side nữa)

**API call pattern:**
```js
async function _fetchPage(page, users) {
    const off = (page - 1) * PERM_PAGE;
    const usParam = users.size > 0
        ? '&us=' + encodeURIComponent([...users].join(','))
        : '';
    const url = `api.php?dir=${encodeURIComponent(_diskDir)}&t=p&o=${off}&n=${PERM_PAGE}${usParam}`;
    const res = await fetch(url);
    const json = JSON.parse(atob(await res.text()));
    return json?.data ?? null;
}
```

- **VERIFY:**
  - Click Permission tab → page 1 loads ✅
  - Click page 2 → server returns offset=100 data ✅
  - Filter by user → resets to page 1, filters server-side ✅
  - `user_summary` sidebar shows correct counts ✅

---

#### Task 4.5: Clean up `dataFetcher.js` — remove stale code

- **Agent:** `frontend-specialist`
- **Priority:** P2
- **File:** `js/dataFetcher.js`
- **INPUT:** `type=reports` param trong URL (line 219) không được `api.php` dùng → stray param
- **OUTPUT:** Remove unused params, clean error messages

**Changes:**
- Remove `&type=reports` from URL (unused)
- Ensure `_permissionsLoaded` flag reset properly on disk change (already done, verify)
- Clean up: `dataStore.permissionIssues` assignment (line 297) — no longer used since permissionRenderer is server-driven

- **VERIFY:** No console errors, network tab shows clean URLs

---

### Phase X — VERIFICATION CHECKLIST

#### API Tests (curl)

```bash
# 1. Main report
curl "https://disk.hydev.me/api.php?dir=mock_reports/disk_sda" | python3 -m json.tool | head -5

# 2. Permission page 1 (default)
curl "https://disk.hydev.me/api.php?dir=mock_reports/disk_sda&t=p" | base64 -d | python3 -m json.tool | grep -E '"total|has_more|offset'

# 3. Permission page 2
curl "https://disk.hydev.me/api.php?dir=mock_reports/disk_sda&t=p&o=100&n=100" | base64 -d | python3 -m json.tool | grep -E '"total|has_more|offset'

# 4. Permission with user filter
curl "https://disk.hydev.me/api.php?dir=mock_reports/disk_sda&t=p&us=user1,user2" | base64 -d | python3 -m json.tool | head -10

# 5. User list
curl "https://disk.hydev.me/api.php?dir=mock_reports/disk_sda&t=u" | base64 -d | python3 -m json.tool

# 6. User dir
curl "https://disk.hydev.me/api.php?dir=mock_reports/disk_sda&t=d&u=user1" | base64 -d | python3 -m json.tool | head -10

# 7. User file streaming page 1
curl "https://disk.hydev.me/api.php?dir=mock_reports/disk_sda&t=f&u=user1&o=0&n=500" | base64 -d | python3 -m json.tool | grep -E '"has_more|total_files'
```

#### Browser Tests (manual)

- [ ] Load dashboard → No console errors
- [ ] Switch disks → data loads correctly
- [ ] Overview tab → team chart, user chart, top dirs visible
- [ ] Users tab → table renders
- [ ] History tab → line chart renders
- [ ] Detail tab → pick user → dir/file tables render, pagination works
- [ ] Permission tab → loads page 1 automatically
- [ ] Permission tab → click page 2 → new data loads from server
- [ ] Permission tab → filter by user → data filters correctly + shows page 1
- [ ] Permission tab → `user_summary` sidebar shows correct counts

#### PHP 5.4 Compatibility Check

- [ ] No `??` null coalescing (use `isset() ? : `)
- [ ] No `...` spread operator
- [ ] No arrow functions `fn() =>`
- [ ] No `match` expression
- [ ] No `array_key_first()` or other PHP 7.3+ functions
- [ ] No `json_encode(JSON_THROW_ON_ERROR)` (PHP 7.3+)
- [ ] `array()` syntax (not `[]` — PHP 5.4+ actually supports `[]`, OK)

---

## ⚠️ Known Risks & Edge Cases

| Risk | Mô tả | Mitigation |
|------|--------|-----------|
| **First-load `user_summary`** | Khi filter user, `user_summary` cần phản ánh TỔNG không phải chỉ page hiện tại | API luôn trả `user_summary` unfiltered |
| **`_activeUsers` empty = all** | Logic hiện tại `_activeUsers.size === 0 → show all` conflicts với server-side filter | Maintain sentinel logic — empty = send no `us` param |
| **Page reset on filter** | Đổi user filter phải reset page = 1 | `_permPage = 1` trước mỗi fetch khi filter change |
| **Concurrent fetches** | User click page nhanh → nhiều requests đồng thời | Add `_fetchInProgress` flag, abort previous fetch |
| **PHP 5.4 `array_filter`** | `array_filter` với closure OK từ PHP 5.3+ | ✅ Safe |
| **Large permission file** | Nếu file > 50MB, `file_get_contents` vẫn tốn RAM | Monitor; implement true line-by-line if needed |

---

## 🔗 Dependencies & Order

```
Task 4.1 (fix diskPath→dir)  ←── P0, no deps
Task 4.2 (api.php aggregation) ←── P1, no deps
Task 4.3 (t=p pagination)   ←── P1, no deps (can parallel with 4.2)
Task 4.4 (permissionRenderer) ←── P1, DEPENDS ON Task 4.3 (needs new API shape)
Task 4.5 (cleanup)           ←── P2, DEPENDS ON 4.1 + 4.4 done
```

**Recommended implementation order:**
1. `Task 4.1` — Fix parameter mismatch (quick win, blocks nothing)
2. `Task 4.2 + 4.3` — Both PHP changes in `api.php` together (one file)
3. `Task 4.4` — JS permissionRenderer after API is updated
4. `Task 4.5` — Final cleanup

---

> **Next:** Review plan → Run `/enhance` để bắt đầu implementation theo task order trên.
