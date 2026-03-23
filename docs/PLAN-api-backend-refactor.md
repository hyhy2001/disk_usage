# PLAN: API Backend Refactor - Fix 403 Forbidden

## Mô tả vấn đề

`dataFetcher.js` hiện đang fetch HTTP trực tiếp vào thư mục `mock_reports/disk_sda/` để lấy danh sách file JSON → webserver chặn directory listing → **403 Forbidden**.

**Giải pháp:** `api.php` làm toàn bộ phần backend (đọc `disks.json`, resolve path, listing, đọc từng JSON), trả về **1 JSON tổng hợp** cho browser. Browser không bao giờ trực tiếp truy cập vào thư mục dữ liệu.

---

## Luồng mới (hoàn toàn qua api.php)

```
Browser JS                      api.php (Server)
──────────                      ────────────────
GET  ?req=list_drives    →      Đọc disks.json → trả danh sách disk
POST drive=<id>          →      Resolve path nội bộ
                                → Liệt kê *.json trong thư mục
                                → Đọc & gộp nội dung
                         ←      Trả 1 JSON tổng hợp
POST req=permissions
     drive=<id>          →      Tương tự, lọc file permission_issues
                         ←      Trả JSON permission
```

> **Chú ý:** `api.php` không chỉ listing—nó đọc và gộp toàn bộ nội dung các JSON rồi trả về 1 lần duy nhất. Browser không bao giờ fetch thẳng vào `mock_reports/`.

---

## Trạng thái hiện tại của api.php

Route `api.php` **đã có sẵn** đầy đủ:

| Route | Params | Mô tả |
|-------|--------|-------|
| ✅ `?req=list_drives` | — | Danh sách disks (từ disks.json) |
| ✅ POST | `drive=<id>` | Gộp tất cả disk_usage*.json của disk |
| ✅ POST | `req=permissions&drive=<id>` | File permission_issues mới nhất |

→ **Không cần sửa `api.php`.**

---

## Thay đổi cần thực hiện

### [MODIFY] [dataFetcher.js](file:///www/wwwroot/disk.hydev.me/disk_usage/js/dataFetcher.js)

| Hàm | Hiện tại | Sau khi sửa |
|-----|----------|-------------|
| `_initDiskSelector()` | `fetch('disks.json')` | `fetch('api.php?req=list_drives')` |
| `startServerSync()` | Nếu có `path/url` → gọi `_fetchDirectoryFiles()` → **403!** | Luôn `POST api.php` với `drive=<id>` |
| `_fetchPermissions()` | Nếu có `path/url` → gọi `_fetchDirectoryFiles()` → **403!** | Luôn `POST api.php` với `req=permissions&drive=<id>` |
| `_fetchDirectoryFiles()` | Fetch HTTP vào thư mục | **Xóa hoàn toàn** |

---

## Verification Plan

### Kiểm tra bằng curl

```bash
# 1. List drives
curl "https://disk.hydev.me/api.php?req=list_drives"

# 2. Data cho disk_sda
curl -X POST "https://disk.hydev.me/api.php" -d "drive=disk_sda"

# 3. Permissions
curl -X POST "https://disk.hydev.me/api.php" -d "req=permissions&drive=disk_sda"
```

Cả 3 phải trả về `{"status":"success",...}`.

### Kiểm tra browser

1. Mở `https://disk.hydev.me` → DevTools → Network tab
2. Reload trang
3. ✅ Không có request nào tới `mock_reports/` (không có 403)
4. ✅ Có POST tới `api.php` → 200 + data
5. ✅ Dashboard hiển thị bình thường, chuyển disk hoạt động
