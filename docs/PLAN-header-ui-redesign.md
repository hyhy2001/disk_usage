## Mục tiêu

Thay thế header riêng lẻ của từng trang bằng **1 shared header chung** nằm ngoài `#page-overview` và `#page-detail`, luôn hiển thị dù đang ở tab nào.

---

## Thiết kế mới

```
┌──────────────────────────────────────────────────────────────────┐
│  Disk Usage Dashboard              /var/data/shared              │
│  Latest snapshot: 15 May 2026                                    │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐       │
│  │ 1.07 TB  │ 0.90 TB  │ 0.84 TB  │ 0.18 TB  │  84.1 %  │       │
│  │  Total   │  Used    │ Scanned  │  Free    │ Usage %  │       │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘       │
├──────────────────────────────────────────────────────────────────┤
│  [Overview tab content]  hoặc  [Detail tab content]             │
└──────────────────────────────────────────────────────────────────┘
```

Header **không bị ẩn** khi chuyển tab — chỉ có phần content bên dưới thay đổi.

**5 blocks riêng biệt trong stat bar:**

| Block | Giá trị | Màu |
|-------|---------|-----|
| Total | Tổng dung lượng disk | trắng |
| Used | Dung lượng đã dùng (df -h) | 🔴 rose |
| Scanned | Team scan usage (sum of teams) | 🟡 amber |
| Free | Còn trống | trắng |
| Usage % | used/total × 100 | đỏ nếu > 80% |

---

## Thay đổi cần thực hiện

### [MODIFY] [index.html](file:///www/wwwroot/disk.hydev.me/disk_usage/index.html)

1. **Tạo shared header** nằm trong `<main>` nhưng **ngoài** `#page-overview` và `#page-detail`:
   ```html
   <header id="shared-header" class="top-header">
     <div class="header-titles">
       <h1>Disk Usage Dashboard</h1>
       <p id="header-disk-path">…</p>
       <p id="data-timerange">…</p>
     </div>
     <div class="page-stat-bar">
       <!-- 5 blocks: total / used / scanned / free / usage% -->
     </div>
   </header>
   ```
2. **Xóa** `<header class="top-header">` riêng trong `#page-overview`
3. **Xóa** `<div class="detail-stat-bar">` trong `#page-detail` (đã được thay bằng shared header)
4. **Xóa** `<div class="metrics-grid">` (3 card to) trong `#page-overview`

---

### [MODIFY] CSS

- Tạo class `.page-stat-bar`: flex row, 5 blocks, có divider giữa các blocks
- `.top-header`: padding hợp lý, sticky hoặc static tùy design

---

### [MODIFY] [dataFetcher.js](file:///www/wwwroot/disk.hydev.me/disk_usage/js/dataFetcher.js)

- `updateMetricCards()`: cập nhật ID trỏ đúng vào shared header elements
- Sau sync: cập nhật `#header-disk-path` bằng `dataStore.latestSnapshot.directory`

```
┌───────────────────────────────────────────────────────────────────┐
│  Disk Usage Overview                     /var/data/shared         │
│  Latest snapshot: 15 May 2026                                     │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐        │
│  │ 1.07 TB  │ 0.90 TB  │ 0.84 TB  │ 0.18 TB  │  84.1 %  │        │
│  │  Total   │  Used    │ Scanned  │  Free    │ Usage %  │        │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘        │
└───────────────────────────────────────────────────────────────────┘
```

Subtitle hiển thị **path thực** (`report.directory`, ví dụ: `/var/data/shared`).

**5 blocks riêng biệt trong stat bar:**

| Block | Giá trị | Màu |
|-------|---------|-----|
| Total | Tổng dung lượng disk | trắng |
| Used | Dung lượng đã dùng (df -h) | 🔴 rose |
| Scanned | Team scan usage (sum of teams) | 🟡 amber |
| Free | Còn trống | trắng |
| Usage % | used/total × 100 | đỏ nếu > 80% |

---

## Thay đổi cần thực hiện

### [MODIFY] [index.html](file:///www/wwwroot/disk.hydev.me/disk_usage/index.html)

1. **Overview header** (`#page-overview .top-header`):
   - Xóa `div.metrics-grid` (3 card lớn)
   - Thêm `div.page-stat-bar` vào trong `.top-header`, ngay dưới subtitle

2. **Detail stat bar** (`#page-detail .detail-stat-bar`):
   - Đổi class từ `detail-stat-bar` → `page-stat-bar` để dùng chung CSS
   - Cho vào trong một `header.top-header` mới (giống Overview)

3. **Thêm title cho Detail page:**
   - Hiện tại Detail không có `<h1>` — thêm "Disk Detail" + subtitle disk_path

---

### [MODIFY] CSS (components.css hoặc layout.css)

- Tạo class `.page-stat-bar` thống nhất: horizontal flex, 4 blocks, glass-panel style
- Xóa hoặc giữ nguyên `.metric-card` (không cần nữa cho Overview)
- Điều chỉnh `.top-header` để chứa stat bar bên dưới

---

### [MODIFY] [dataFetcher.js](file:///www/wwwroot/disk.hydev.me/disk_usage/js/dataFetcher.js)

- `updateMetricCards()`: cập nhật ID của các element phù hợp với HTML mới (nếu đổi ID)
- Sau khi data load xong, lấy `dataStore.latestSnapshot.directory` → cập nhật subtitle header disk path cho cả 2 trang
- `_updateDiskPath()`: hiện tại dùng `disk.dir` (= `disk_sda`) → ở bước khởi tạo vẫn dùng `disk.name`, nhưng **sau khi sync xong**, overwrite bằng path thực từ report

---

## Verification Plan

### Manual — trên browser

1. Mở `https://disk.hydev.me` → Tab Overview
   - ✅ Header có stat bar compact (Total / Used / Free / Usage %)
   - ✅ Không còn 3 card to bên dưới header
   - ✅ Stat bar hiển thị đúng số liệu sau sync

2. Chuyển sang tab Detail
   - ✅ Stat bar cùng style với Overview
   - ✅ Vẫn hiển thị đúng Total / Used / Free / Usage %

3. Chuyển disk (dropdown)
   - ✅ Stat bar ở cả 2 tab cập nhật số liệu mới
