# PLAN: check-disk-integration

> **Project:** Disk Usage Checker CLI → Dashboard Integration  
> **Type:** BACKEND (Python CLI) + WEB (Frontend Dashboard)  
> **Date:** 2026-03-22  
> **Status:** ANALYSIS COMPLETE — Ready for Implementation

---

## 📋 Overview

`check_disk` là một Python CLI tool độc lập dùng để **quét disk usage** theo team/user và **xuất report JSON**. Hệ thống tổng thể bao gồm 2 thành phần:

1. **`check_disk/`** — Python CLI tool (backend scanner)
2. **`/` (project root)** — Web dashboard hiển thị dữ liệu từ các report JSON

Mục tiêu plan này: **Hiểu rõ kiến trúc `check_disk` + lộ trình kết nối JSON output với dashboard frontend**.

---

## 🏗️ Kiến Trúc check_disk

### Module Map

```
check_disk/
├── disk_checker.py          # Entry point / CLI router
└── src/
    ├── config_manager.py    # Đọc/ghi disk_checker_config.json
    ├── disk_scanner.py      # Core scanner (multi-thread, psutil)
    ├── report_generator.py  # Tạo JSON reports
    ├── cli_interface.py     # Argparse CLI interface
    ├── utils.py             # Helpers: format_size, parse_size, ScanHelper
    ├── formatter.py         # TableFormatter entry
    └── formatters/
        ├── base_formatter.py
        ├── config_display.py
        ├── report_comparison.py
        ├── report_formatter.py
        └── table_formatter.py
```

### Data Flow

```
disk_checker_config.json
        ↓
  ConfigManager.get_config()
        ↓
  DiskScanner.scan()          ← Multi-thread (ThreadPoolExecutor-like)
   ├── _worker() x N threads  ← scandir() per directory
   ├── ThreadStats (uid_sizes, dir_sizes, permission_issues)
   └── ScanResult (team_usage, user_usage, other_usage, top_dir, permission_issues)
        ↓
  ReportGenerator
   ├── generate_report()              → disk_usage_report.json
   ├── generate_permission_issues_report() → permission_issues.json
   ├── generate_top_user_report()     → top_user.json
   └── generate_check_user_report()  → check_user.json
```

---

## 📄 JSON Report Formats

### 1. `disk_usage_report.json` (Main Report)

```json
{
  "date": 1623456789,
  "directory": "/path/to/scan",
  "general_system": {
    "total": 1000000000000,
    "used": 750000000000,
    "available": 250000000000
  },
  "team_usage": [
    { "name": "JP", "used": 300000000000 },
    { "name": "VN", "used": 250000000000 },
    { "name": "Other", "used": 150000000000 }
  ],
  "user_usage": [
    { "name": "Hirakimoto", "used": 150000000000 },
    { "name": "Binh", "used": 250000000000 }
  ],
  "other_usage": [
    { "name": "unknown_user", "used": 50000000 }
  ]
}
```

### 2. `permission_issues.json` (Auto-generated nếu có issues)

```json
{
  "date": 1623456789,
  "directory": "/path/to/scan",
  "general_system": { "total": ..., "used": ..., "available": ... },
  "permission_issues": {
    "users": [
      {
        "name": "username",
        "inaccessible_items": [
          {
            "path": "/path/to/file",
            "type": "file|directory|unknown",
            "error": "Permission denied"
          }
        ]
      }
    ],
    "unknown_items": [
      { "path": "...", "type": "...", "error": "..." }
    ]
  }
}
```

### 3. `top_user.json` (khi dùng `--top-user N`)

```json
{
  "date": 1623456789,
  "directory": "/path/to/scan",
  "top_user": 20,
  "min_usage": "2.0 TB",
  "user_usage": [ { "name": "...", "used": ... } ],
  "other_usage": [ { "name": "...", "used": ... } ],
  "team_usage": [ { "name": "...", "used": ... } ],
  "detail_dir": [
    { "dir": "/path/dir", "user": "username", "user_usage": 10000000 }
  ]
}
```

### 4. `check_user.json` (khi dùng `--check-user`)

```json
{
  "date": 1623456789,
  "directory": "/path/to/scan",
  "check_users": ["user1", "user2"],
  "user_usage": [ { "name": "user1", "used": 5000000 } ],
  "detail_dir": [ { "dir": "...", "user": "user1", "user_usage": 1000000 } ],
  "permission_issues": { "users": [...] }
}
```

---

## 🔗 Liên Kết Với Dashboard Frontend

### Hiện Tại (Dashboard đang dùng)

Dashboard tại project root đọc reports từ `mock_reports/` (qua PHP API hoặc filesystem):

| Dashboard cần | check_disk xuất |
|---------------|-----------------|
| Disk capacity (total/used/available) | `general_system` field |
| Team usage pie chart | `team_usage` array |
| User usage bar chart | `user_usage` + `other_usage` |
| Directory detail (top dirs) | `detail_dir` array (top_user/check_user) |
| Permission issues tab | `permission_issues.json` |

### Gap Analysis

| Gap | Vấn đề | Giải pháp |
|-----|--------|-----------|
| `other_usage` field | Dashboard có thể không merge với `user_usage` | Cần frontend merge hoặc backend pre-merge |
| File naming | `--prefix --date` tạo tên động, dashboard cần biết tên file | Standardize output path hoặc dùng symlink |
| `permission_issues` format | Nested structure `users[].inaccessible_items[]` | Frontend cần parse đúng format |
| `detail_dir` chỉ có trong top_user/check_user | Main report không có directory detail | Cân nhắc thêm option hoặc always generate |

---

## ✅ Success Criteria

- [ ] Dashboard đọc được `disk_usage_report.json` từ check_disk scan thật
- [ ] Tab Permission Issues hiển thị đúng data từ `permission_issues.json`
- [ ] File path convention rõ ràng (không dùng mock reports nữa)
- [ ] Date/Time hiển thị từ `date` (Unix timestamp) chính xác
- [ ] `other_usage` được merge hoặc hiển thị riêng đúng cách

---

## 🛠️ Tech Stack

| Layer | Technology | Lý do |
|-------|-----------|-------|
| Scanner | Python 3.6+ stdlib + psutil | Multi-thread, no external deps (trừ psutil) |
| Config | JSON file | Simple, human-readable |
| Output | JSON files | Dễ đọc từ bất kỳ frontend nào |
| Dashboard | Vanilla JS + HTML + CSS | Đã có sẵn |
| API bridge | PHP (`api.php`, `permission_api.php`) | Đã có sẵn |

---

## 📁 File Structure (Hiện Tại)

```
/www/wwwroot/disk.hydev.me/disk_usage/
├── check_disk/                    # Python CLI tool
│   ├── disk_checker.py            # Entry point
│   ├── disk_checker_config.json   # (cần tạo --init)
│   └── src/
│       ├── disk_scanner.py        # Core logic
│       ├── report_generator.py    # JSON output
│       ├── config_manager.py
│       ├── cli_interface.py
│       ├── utils.py
│       └── formatters/
├── mock_reports/                  # Mock data hiện tại
│   └── disk_sda/
│       ├── disk_usage_report.json
│       └── permission_issues.json
├── index.html                     # Dashboard
├── js/                            # Frontend JS
├── api.php                        # PHP API bridge
└── permission_api.php             # Permission issues API
```

---

## 📊 Task Breakdown

### Phase 1 — ANALYSIS ✅ (Đã hoàn thành)

**Task 1.1: Đọc và phân tích check_disk codebase**
- **INPUT:** Source code check_disk/
- **OUTPUT:** Hiểu đầy đủ data flow, JSON formats, edge cases
- **VERIFY:** Document này
- **Status:** ✅ DONE

---

### Phase 2 — PLANNING

**Task 2.1: Xác định JSON output path convention**
- **Agent:** `backend-specialist`
- **INPUT:** Hiện tại check_disk xuất file vào thư mục chạy script
- **OUTPUT:** Convention: `mock_reports/{disk_name}/disk_usage_report.json`
- **VERIFY:** Check file được tạo đúng path sau khi `--run --output-dir mock_reports/disk_sda/`
- **Dependencies:** None
- **Priority:** P0

**Task 2.2: Verify permission_issues.json format khớp với frontend**
- **Agent:** `backend-specialist`
- **INPUT:** `permission_issues.json` từ check_disk + `permission_api.php` code
- **OUTPUT:** Xác nhận hoặc patch format mismatch
- **VERIFY:** Tab Permission Issues render đúng trên dashboard
- **Dependencies:** Task 2.1
- **Priority:** P1

**Task 2.3: Handle `other_usage` trong frontend**
- **Agent:** `frontend-specialist`
- **INPUT:** `other_usage` array từ main report
- **OUTPUT:** Quyết định merge vào `user_usage` hay show riêng
- **VERIFY:** Biểu đồ không bị thiếu data
- **Dependencies:** Task 2.1
- **Priority:** P1

---

### Phase 3 — SOLUTIONING

**Task 3.1: Standardize output command**
- **Agent:** `backend-specialist`
- **INPUT:** check_disk CLI options
- **OUTPUT:** Script/command chuẩn để chạy scan và deposit file đúng chỗ
- **VERIFY:** Command cho ra đúng file structure
- **Example:**
  ```bash
  python check_disk/disk_checker.py --run \
    --output-dir mock_reports/disk_sda/ \
    --prefix disk_sda --date
  ```
- **Priority:** P1

**Task 3.2: Cron job hoặc automation setup**
- **Agent:** `backend-specialist`
- **INPUT:** Server Linux, cron availability
- **OUTPUT:** Cronjob chạy scan định kỳ (daily/weekly)
- **VERIFY:** Report mới xuất hiện sau mỗi lần chạy
- **Priority:** P2

---

### Phase 4 — IMPLEMENTATION

**Task 4.1: Patch api.php nếu cần với real scan path**
- **Agent:** `backend-specialist`
- **INPUT:** `api.php`, output path từ Task 3.1
- **OUTPUT:** `api.php` đọc đúng file
- **VERIFY:** `GET /api.php?disk=disk_sda` returns valid JSON
- **Priority:** P1

**Task 4.2: Patch permission_api.php nếu format mismatch**
- **Agent:** `backend-specialist`  
- **INPUT:** `permission_api.php` + actual `permission_issues.json`
- **OUTPUT:** API response đúng format mà frontend expect
- **VERIFY:** Permission Issues tab load đúng data
- **Priority:** P1

**Task 4.3: Test end-to-end với real scan**
- **Agent:** `backend-specialist`
- **INPUT:** Môi trường thực tế
- **OUTPUT:** Dashboard hiển thị data từ scan thực
- **VERIFY:** All tabs (Overview, Teams, Users, History, Permissions) hiển thị
- **Priority:** P2

---

### Phase X — VERIFICATION

- [ ] `disk_usage_report.json` từ real scan được parsed đúng
- [ ] `permission_issues.json` format khớp với `permission_api.php`
- [ ] `other_usage` được xử lý (không bị mất)
- [ ] `detail_dir` (nếu cần) hiển thị trong tab phù hợp
- [ ] Timestamp `date` hiển thị đúng timezone
- [ ] Không có console errors khi load real data
- [ ] API responses đúng Content-Type và status code

---

## ⚠️ Known Risks & Edge Cases

| Risk | Mô tả | Mitigation |
|------|--------|-----------|
| **psutil dependency** | check_disk import psutil — cần install trên server | `pip install psutil` trước khi chạy |
| **Permission trong scan** | Scanner cần run với quyền đủ để đọc directories | Chạy với `sudo` hoặc user có quyền |
| **Large scan time** | Scan ổ đĩa lớn có thể mất hàng giờ | Dùng cron job off-peak, có stall detection sẵn có |
| **File naming với --prefix --date** | Tên file động khiến frontend không biết file nào mới nhất | Dùng `--output disk_usage_report.json` để fix tên |
| **other_usage vs user_usage** | Frontend hiện tại có thể chỉ đọc `user_usage` | Kiểm tra `dataFetcher.js` để xem có merge không |
| **CRLF line endings** | `disk_scanner.py` có CRLF — có thể gây issue trên Linux | Convert với `dos2unix` hoặc editor setting |

---

## 🚀 Quick Start Command

```bash
# 1. Setup
cd /www/wwwroot/disk.hydev.me/disk_usage/check_disk
pip install psutil

# 2. Init config
python disk_checker.py --init --dir /path/to/scan

# 3. Add teams/users
python disk_checker.py --add-team JP
python disk_checker.py --add-user Hirakimoto --team JP

# 4. Run scan → output vào đúng chỗ dashboard đọc
python disk_checker.py --run \
  --output /www/wwwroot/disk.hydev.me/disk_usage/mock_reports/disk_sda/disk_usage_report.json

# 5. Verify output
cat /www/wwwroot/disk.hydev.me/disk_usage/mock_reports/disk_sda/disk_usage_report.json | python -m json.tool
```

---

> **Next Step:** Review plan này → Run `/create` hoặc `/enhance` để bắt đầu implementation.
