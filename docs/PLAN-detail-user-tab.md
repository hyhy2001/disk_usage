# PLAN: Detail User Tab

## Mục tiêu

Thêm tab **"Detail User"** nằm giữa tab "History & Analysis" và "Permission Issues"
trong trang `page-detail`. Tab chỉ hiện user picker ban đầu, sau khi chọn user mới
lazy-load dữ liệu chi tiết (top dirs + top files) qua API PHP riêng.

---

## Cấu trúc tab hiện tại (Detail page)

```
Latest Snapshot | History & Analysis | [Detail User] <-- thêm vào đây | Permission Issues
```

---

## Folder structure — mock & real

| Source | Path |
|---|---|
| **Mock** | `mock_reports/{disk}/detail_users/detail_report_dir_{user}.json` |
| **Mock** | `mock_reports/{disk}/detail_users/detail_report_file_{user}.json` |
| **Real (check_disk)** | `{output_dir}/detail_users/{prefix}_detail_report_dir_{user}.json` |
| **Real (check_disk)** | `{output_dir}/detail_users/{prefix}_detail_report_file_{user}.json` |

> Mock folder mirrors cấu trúc thật của `check_disk` (`report_generator.py` line 58)

---

## Schemas

### `detail_report_dir_{user}.json`
```json
{
  "date": 1742600000,
  "directory": "/var/data/shared",
  "user": "user1",
  "total_used": 2748779069440,
  "dirs": [
    { "path": "/var/data/shared/user1/projects", "used": 1099511627776 }
  ]
}
```

### `detail_report_file_{user}.json`
```json
{
  "date": 1742600000,
  "user": "user1",
  "total_files": 12345,
  "total_used": 2748779069440,
  "files": [
    { "path": "/var/data/shared/user1/model.bin", "size": 536870912 }
  ]
}
```

---

## Phase 1 — Update `generate_mock_json.py`

- Với mỗi disk, tạo thư mục `mock_reports/{disk}/detail_users/`
- Tạo **1 cặp file** (dir + file) cho mỗi user (không theo ngày — luôn là snapshot mới nhất)
- Top 20 dirs, top 30 files với fake paths realistic
- Fake paths dạng: `/{base_dir}/{user}/{subdir}/{subsubdir}` (3-4 level deep)
- Size ngẫu nhiên nhưng tổng phải match `user_usage[user].used`

## Phase 2 — `user_detail_api.php` (PHP API mới)

**Pattern giống hệt `api.php` và `permission_api.php`** để tránh 403:
- `$baseDir = __DIR__`
- Block `..` traversal giống nhau
- Header: `Content-Type: text/plain; charset=utf-8` (giống hai API kia)
- Response envelope: `['status' => 'success', 'data' => ...]`

**Endpoints (tất cả GET):**
```
# List users có detail report trong disk đó
GET user_detail_api.php?dir=mock_reports/disk_sda

# Detail dirs của user (đọc detail_report_dir_{user}.json)
GET user_detail_api.php?dir=mock_reports/disk_sda&user=user1&type=dir

# Detail files của user (đọc detail_report_file_{user}.json)
GET user_detail_api.php?dir=mock_reports/disk_sda&user=user1&type=file

# Cả dir lẫn file trong 1 request
GET user_detail_api.php?dir=mock_reports/disk_sda&user=user1&type=both
```

**Logic PHP:**
```php
$baseDir = __DIR__;
$reqDir  = isset($_GET['dir']) ? trim($_GET['dir'], '/\\') : '';

// Block traversal (same as api.php)
if (strpos($reqDir, '..') !== false || $reqDir === '') { 403 }

$rawPath    = $baseDir . DIRECTORY_SEPARATOR . $reqDir;
$detailPath = $rawPath . DIRECTORY_SEPARATOR . 'detail_users';

// Validate user param (alphanumeric + dash + underscore only)
$user = isset($_GET['user']) ? preg_replace('/[^a-zA-Z0-9_\-]/', '', $_GET['user']) : '';
$type = isset($_GET['type']) ? $_GET['type'] : '';

// Mode A: list users (no user param)
if ($user === '') { scan detail_users/, extract usernames from filenames }

// Mode B: get detail for user
if ($type === 'dir' || $type === 'both') { read detail_report_dir_{user}.json }
if ($type === 'file' || $type === 'both') { read detail_report_file_{user}.json }

header('Content-Type: text/plain; charset=utf-8');
echo json_encode(['status' => 'success', 'data' => $data]);
```

**Error cases:**
- 403: `..` trong path
- 404: dir không tồn tại, hoặc `detail_users/` folder không tồn tại
- 404: file không tồn tại cho user cụ thể
- 400: `type` không hợp lệ

## Phase 3 — `index.html`

Thêm tab button vào `div.detail-tabs`:
```html
<!-- sau button data-tab="history", trước data-tab="permissions" -->
<button class="detail-tab-btn" data-tab="user-detail">
  <svg><!-- user icon --></svg>
  Detail User
</button>
```

Thêm tab pane:
```html
<div class="detail-tab-pane" id="tab-pane-user-detail">
  <!-- user picker + lazy content injected by JS -->
</div>
```

## Phase 4 — `js/userDetailRenderer.js` (module mới)

```
export function initUserDetailTab(store)
  └─ renderPicker()          -- dropdown + search từ store.getTopUsers()
       └─ onSelect(userName)
            ├─ showSkeleton()
            ├─ fetch API dir + file
            └─ renderDetail(dirData, fileData)
                 ├─ renderDirCard(dirs)   -- top dirs bảng với size bar
                 └─ renderFileCard(files) -- top files bảng với extension badge
```

**State management:**
- `_selectedUser` — user đang chọn
- `_currentDisk` — disk đang active (reset picker khi đổi disk)
- AbortController để cancel fetch khi đổi user nhanh

## Phase 5 — Đăng ký vào `js/main.js` / `js/detailRenderer.js`

- Import `initUserDetailTab` trong module quản lý detail tabs
- Gọi `initUserDetailTab(store)` khi tab được activate lần đầu
- Reset khi disk thay đổi: `_selectedUser = null`, clear content

## Phase 6 — CSS trong `css/components.css`

| Class | Mục đích |
|---|---|
| `.ud-picker-wrap` | Container của user picker |
| `.ud-picker-select` | Styled select/dropdown |
| `.ud-empty-state` | Placeholder trước khi chọn user |
| `.ud-detail-grid` | 2-column grid: dirs card + files card |
| `.ud-card` | Glass card cho mỗi section |
| `.ud-path-row` | Mỗi dòng path + size bar |
| `.ud-ext-badge` | Badge extension file (`.bin`, `.log`...) |
| `.ud-skeleton` | Loading skeleton khi fetch |

---

## Verification Checklist

- [ ] Mock tạo đúng `detail_users/` trong mỗi disk folder
- [ ] File count: mỗi disk có `{num_users * 2}` files trong `detail_users/`
- [ ] API trả JSON đúng schema, block `..` traversal
- [ ] Tab "Detail User" xuất hiện đúng vị trí
- [ ] Mặc định: chỉ hiện user picker, chưa có content
- [ ] Chọn user → skeleton → render dirs + files
- [ ] Đổi disk → user picker reset về mặc định
- [ ] Đổi user nhanh → request cũ bị abort

---

## Thứ tự implement

1. `generate_mock_json.py` → tạo `detail_users/`
2. `user_detail_api.php` → API mới
3. `index.html` → tab button + pane
4. `js/userDetailRenderer.js` → module mới
5. Wire vào `js/detailRenderer.js` + `js/main.js`
6. `css/components.css` → styles
