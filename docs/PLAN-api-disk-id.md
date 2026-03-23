# PLAN: api-disk-id

> **Project:** Disk Usage Dashboard — Hide Relative Path via Disk ID
> **Type:** BACKEND (PHP 5.4+) + FRONTEND (Vanilla JS)
> **Date:** 2026-03-23
> **Status:** PLANNING COMPLETE — Ready for Implementation
> **Integrates with:** `PLAN-api-clean-redesign.md` (add-on, implement together)

---

## 📋 Overview

Thay vì expose relative path `?dir=mock_reports/disk_sda` trong mọi API call, chúng ta sẽ:

1. **PHP đọc `disks.json`** để resolve `id → path` server-side
2. **Browser chỉ gửi `?id=disk_sda`** — không bao giờ biết path thực tế
3. **Security improvement**: attacker không thể thử nghiệm path traversal hay đoán cấu trúc thư mục

---

## 🔍 Hiện Trạng

```
Browser → api.php?dir=mock_reports/disk_sda&type=permissions
                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^
                   Path lộ ra ngoài → user có thể thấy cấu trúc server
```

**`disks.json` hiện tại:**
```json
[
  { "id": "disk_sda", "name": "Primary Storage", "path": "mock_reports/disk_sda" },
  { "id": "disk_sdb", "name": "Archive Pool",    "path": "mock_reports/disk_sdb" }
]
```

`id` đã tồn tại sẵn — chỉ cần dùng nó ở phía PHP để resolve path.

---

## 🎯 Success Criteria

- [ ] Mọi API call từ browser chỉ dùng `?id=disk_sda` (không có `?dir=...`)
- [ ] PHP đọc `disks.json` → map `id` → `path` server-side
- [ ] ID không hợp lệ → HTTP 403 hoặc 404
- [ ] `disks.json` tiếp tục là nguồn cấu hình duy nhất
- [ ] Frontend (`dataFetcher.js`, `userDetailRenderer.js`, `permissionRenderer.js`) không còn truyền path
- [ ] Không thể brute-force hay enum path qua URL

---

## 📐 New API Design

### Thay đổi duy nhất ở URL level

| Trước | Sau |
|-------|-----|
| `api.php?dir=mock_reports/disk_sda` | `api.php?id=disk_sda` |
| `api.php?dir=mock_reports/disk_sda&type=permissions` | `api.php?id=disk_sda&type=permissions` |
| `api.php?dir=mock_reports/disk_sda&type=files&user=alice&offset=0&limit=500` | `api.php?id=disk_sda&type=files&user=alice&offset=0&limit=500` |

> `type`, `user`, `offset`, `limit`, `users` params giữ nguyên — chỉ `dir` → `id` thay đổi.

### PHP Resolution Logic

```
Request: ?id=disk_sda
         ↓
PHP: read disks.json (once per request, ~1KB file)
         ↓
Find entry where "id" == "disk_sda"
         ↓
$disk_path = __DIR__ . "/" . $entry["path"]   // "mock_reports/disk_sda"
         ↓
Continue with all existing logic unchanged
```

### Security Model

```
Before: ?dir=mock_reports/disk_sda  → user knows server has mock_reports/
After:  ?id=disk_sda               → user only knows "disk_sda" exists

Traversal attempt: ?id=../../etc/passwd
  → not found in disks.json → 403
  → path never constructed
```

---

## 📁 Files To Change

```
disk_usage/
├── api.php                     [MODIFY] — replace dir-param logic with id→path lookup
├── js/
│   ├── dataFetcher.js          [MODIFY] — send ?id= instead of ?dir=
│   ├── userDetailRenderer.js   [MODIFY] — send ?id= instead of ?dir=
│   └── permissionRenderer.js   [MODIFY] — send ?id= instead of ?dir=
└── disks.json                  [NO CHANGE] — already has "id" field ✅
```

---

## 📊 Task Breakdown

### Task 5.1: Update `api.php` — replace `?dir` with `?id` + disks.json lookup

- **Agent:** `backend-specialist`
- **Priority:** P0
- **File:** `api.php`

**Logic:**
```php
// ── Disk ID resolution ───────────────────────────────────────────────────────

$req_id = trim(param('id', ''));

if ($req_id === '') {
    http_response_code(400);
    echo 'Missing disk id.';
    exit;
}

// Sanitize: only allow [a-zA-Z0-9_-]
$req_id = preg_replace('/[^a-zA-Z0-9_\-]/', '', $req_id);
if ($req_id === '') {
    http_response_code(403);
    echo 'Invalid disk id.';
    exit;
}

// Load disks.json once
$disks_file = __DIR__ . DIRECTORY_SEPARATOR . 'disks.json';
$disks_raw  = @file_get_contents($disks_file);
$disks      = ($disks_raw !== false) ? json_decode($disks_raw, true) : array();

// Find matching disk entry
$disk_entry = null;
if (is_array($disks)) {
    foreach ($disks as $d) {
        if (isset($d['id']) && $d['id'] === $req_id) {
            $disk_entry = $d;
            break;
        }
    }
}

if (!$disk_entry || empty($disk_entry['path'])) {
    http_response_code(404);
    echo 'Disk not found.';
    exit;
}

// Resolve to absolute path — NO user-supplied path ever touches filesystem
$rel_path  = trim($disk_entry['path'], '/\\');
$disk_path = __DIR__ . DIRECTORY_SEPARATOR . $rel_path;

if (!is_dir($disk_path) && !is_link($disk_path)) {
    http_response_code(404);
    echo 'Disk directory not found.';
    exit;
}

// All subsequent routes use $disk_path as before
```

**Điểm quan trọng:**
- `$req_id` được sanitize trước khi dùng để lookup
- `$disk_entry['path']` đến từ server-side `disks.json` — không bao giờ từ user input
- Không cần check `strpos($path, '..')` nữa vì path không đến từ request

- **VERIFY:**
  ```bash
  # Valid ID
  curl "https://disk.hydev.me/api.php?id=disk_sda" | python3 -m json.tool | head -3

  # Invalid ID (traversal attempt)
  curl "https://disk.hydev.me/api.php?id=../../etc" -v
  # Expect: 403 or 404

  # Unknown ID
  curl "https://disk.hydev.me/api.php?id=nonexistent" -v
  # Expect: 404 Disk not found.

  # Old ?dir= param (should fail / be ignored)
  curl "https://disk.hydev.me/api.php?dir=mock_reports/disk_sda" -v
  # Expect: 400 Missing disk id.
  ```

---

### Task 5.2: Update `js/dataFetcher.js` — `diskPath` → `diskId`

- **Agent:** `frontend-specialist`
- **Priority:** P0
- **File:** `js/dataFetcher.js`

**Concept:** Thay vì lưu và dùng `diskConf.path` để build URL, dùng `diskConf.id` (hoặc `d.id` từ `disks.json`).

**Changes:**

```js
// _initDiskSelector: disks.json đã trả về { id, name, path }
// Trong activate():
const activate = (id) => {
    this._activeDisk = id;         // id là disk_sda, disk_sdb, v.v.
    // Không cần lưu path nữa
    const disk = disks.find(d => d.id === id);
    this._updateDiskPath(disk);    // chỉ dùng disk.name cho display
    saveFilters({ activeDisk: id });
    // ...
};

// startServerSync():
// BEFORE:
const diskConf = this.disksConfig?.find(d => d.id === this._activeDisk);
const diskPath = diskConf?.path || this._activeDisk;
const response = await fetch(`api.php?dir=${encodeURIComponent(diskPath)}`);

// AFTER:
const response = await fetch(`api.php?id=${encodeURIComponent(this._activeDisk)}`);
```

```js
// _fetchPermissions():
// BEFORE:
const diskConf = this.disksConfig?.find(d => d.id === this._activeDisk);
const diskPath = diskConf?.path || this._activeDisk;
const res = await fetch(`api.php?dir=${encodeURIComponent(diskPath)}&type=permissions`);

// AFTER:
const res = await fetch(`api.php?id=${encodeURIComponent(this._activeDisk)}&type=permissions`);
```

```js
// User detail tab init:
// BEFORE:
const diskConf = this.disksConfig?.find(d => d.id === this._activeDisk);
const diskPath = diskConf?.path || this._activeDisk;
initUserDetailTab(diskPath, otherUsers);

// AFTER:
initUserDetailTab(this._activeDisk, otherUsers);
// _activeDisk IS the id — pass it directly
```

- **VERIFY:** Network tab — all requests use `?id=disk_sda`, no `?dir=` visible

---

### Task 5.3: Update `js/userDetailRenderer.js` — replace `diskDir` with `diskId`

- **Agent:** `frontend-specialist`
- **Priority:** P0
- **File:** `js/userDetailRenderer.js`

**Rename:** `_currentDisk` (was a path, now is an id) — semantics unchanged, value changes.

```js
// _fetchDir: was ?dir=...&type=dirs → now ?id=...&type=dirs
async function _fetchDir(diskId, user) {
    const url = `api.php?id=${encodeURIComponent(diskId)}&type=dirs&user=${encodeURIComponent(user)}`;
    // ...
}

// _fetchFilePage: was ?dir=...&type=files → now ?id=...&type=files
async function _fetchFilePage(diskId, user, offset, limit) {
    const url = `api.php?id=${encodeURIComponent(diskId)}&type=files&user=${encodeURIComponent(user)}&offset=${offset}&limit=${limit}`;
    // ...
}

// _fetchUserList: was ?dir=...&type=users → now ?id=...&type=users
async function _fetchUserList(diskId) {
    const url = `api.php?id=${encodeURIComponent(diskId)}&type=users`;
    // ...
}

// Public API:
export async function initUserDetailTab(diskId, otherUsers = []) {
    // diskId = "disk_sda", "disk_sdb", etc.
    const isNewDisk = diskId !== _currentDisk;
    _currentDisk = diskId;    // store id, not path
    // ...
}
```

- **VERIFY:** Detail user tab vẫn load dir + file reports đúng

---

### Task 5.4: Update `js/permissionRenderer.js` — replace `diskDir` with `diskId`

- **Agent:** `frontend-specialist`
- **Priority:** P0
- **File:** `js/permissionRenderer.js`

```js
// Module state
let _diskId = null;  // was _diskDir (relative path), now disk ID

// In _fetchPage():
const url = `api.php?id=${encodeURIComponent(_diskId)}&type=permissions&offset=${offset}&limit=${PERM_PAGE}${usFilter}`;

// In permissionsLoaded handler:
_diskId = detail.diskId;  // renamed from detail.diskDir
```

**`dataFetcher.js` phải dispatch `diskId` trong event:**
```js
// dataFetcher.js — _fetchPermissions():
document.dispatchEvent(new CustomEvent('permissionsLoaded', {
    detail: json.data
        ? { diskId: this._activeDisk, ...json.data }  // was diskDir: diskPath
        : { diskId: this._activeDisk },
}));
```

- **VERIFY:** Permission tab loads, pagination works, filter works

---

### Task 5.5: Response cleanup — không leak path trong response

- **Agent:** `backend-specialist`
- **Priority:** P2
- **File:** `api.php`

Hiện tại response có thể chứa `"directory": "/var/data/shared"` — đây là filesystem path từ trong file JSON (check_disk để lại). Đây là data thực từ scan nên chấp nhận được. Nhưng `api.php` **không được** echo lại `$rel_path` hay `$disk_path` vào response.

**Kiểm tra:** Tất cả response chỉ chứa data từ JSON files, không phải từ `$disk_path` variable.

```php
// ĐÚNG: data từ JSON file
'directory' => isset($doc['directory']) ? $doc['directory'] : null,

// SAI: leak server path
'directory' => $disk_path,  // NEVER do this
```

- **VERIFY:** Grep response không chứa `mock_reports`:
  ```bash
  curl "https://disk.hydev.me/api.php?id=disk_sda" | grep -o 'mock_reports' | wc -l
  # Expect: 0
  ```

---

## 📐 Full URL Reference (Final State)

Tất cả API calls sau khi implement 2 plans (`api-clean-redesign` + `api-disk-id`):

```
# Main disk data
GET api.php?id=disk_sda

# Permissions (paginated, filterable)
GET api.php?id=disk_sda&type=permissions
GET api.php?id=disk_sda&type=permissions&offset=100&limit=100
GET api.php?id=disk_sda&type=permissions&users=alice,bob

# User list
GET api.php?id=disk_sda&type=users

# User directory report
GET api.php?id=disk_sda&type=dirs&user=alice

# User file report (paginated)
GET api.php?id=disk_sda&type=files&user=alice&offset=0&limit=500
GET api.php?id=disk_sda&type=files&user=alice&offset=500&limit=500
```

---

## ⚠️ Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **`disks.json` read per request** | IO overhead ~1KB/req | File nhỏ, OS cache; acceptable. Dùng `opcache` nếu cần |
| **`disks.json` not found** | All APIs break | Graceful error: 500 + log |
| **ID enum attack** | Attacker tries `disk_sda`, `disk_sdb`, etc. | IDs không phải secret — chỉ cần hide path. Rate limit nếu cần. |
| **Old `?dir=` still accessible** | Path leak survives | `api.php` phải reject request nếu không có `?id=` |
| **`directory` field in JSON responses** | Exposes scan path | Từ check_disk output — data thật, không phải server path. Document là intended. |

---

## 🔗 Integration với PLAN-api-clean-redesign.md

Plan này **bổ sung** thêm 1 layer vào plan trước. Thứ tự implement:

```
[PLAN-api-clean-redesign] Tasks 4.1–4.3 (rewrite api.php routes)
        +
[PLAN-api-disk-id]        Task 5.1     (thêm id→path resolution ở đầu file)
        ↓
api.php hoàn chỉnh — deploy
        ↓
[PLAN-api-clean-redesign] Tasks 4.4–4.5 (userDetailRenderer, dataFetcher)
        +
[PLAN-api-disk-id]        Tasks 5.2–5.4 (rename diskDir → diskId in JS)
        ↓
[PLAN-api-disk-id]        Task 5.5     (verify no path leak in responses)
        ↓
Phase X verification
```

**Một file `api.php` duy nhất** sẽ chứa tất cả logic từ cả 2 plans — không cần file riêng.

---

### Phase X — Verification Checklist

- [ ] `?id=disk_sda` → 200, data trả về đúng
- [ ] `?id=../../etc` → 403/404, không có path leak
- [ ] `?dir=mock_reports/disk_sda` (không có `?id=`) → 400 Missing disk id
- [ ] `?id=nonexistent` → 404 Disk not found
- [ ] Network tab: không có `?dir=` trong bất kỳ request nào
- [ ] Network tab: không có `mock_reports` trong URL
- [ ] `grep "mock_reports" api_response.json` → 0 matches (body không leak)
- [ ] All tabs (Overview, Users, History, Detail, Permissions) load đúng

---

> **Next:** Implement cả 2 plans (`api-clean-redesign` + `api-disk-id`) cùng một lần.
> Run `/enhance` hoặc "bắt đầu implement api.php" để tiến hành.
