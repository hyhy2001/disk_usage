# PLAN: check-disk-refactor

> **Project:** check_disk Python CLI — Code Audit & Refactor  
> **Type:** BACKEND (Python CLI tool)  
> **Agent:** `backend-specialist` + `clean-code`  
> **Date:** 2026-03-22  
> **Status:** ANALYSIS COMPLETE — Ready for Refactor

---

## 📋 Tóm Tắt Audit

Sau khi đọc toàn bộ **9 file** trong check_disk, tôi phát hiện **5 nhóm vấn đề chính**:

| # | Nhóm | Mức độ | Mô tả |
|---|------|--------|-------|
| 1 | **Code Dư Thừa (Duplication)** | 🔴 HIGH | `_create_usage_bar` ở 2 chỗ, filter logic lặp lại |
| 2 | **External Dependency** | 🔴 HIGH | `numpy` import trong `report_comparison.py` nhưng không dùng |
| 3 | **Structural Smell** | 🟡 MEDIUM | `formatter.py` shim thừa, `__init__.py` import quá nhiều |
| 4 | **Logic Rườm Rà** | 🟡 MEDIUM | Filename generation trong `disk_checker.py` (30+ dòng), None-check thừa |
| 5 | **Inconsistency** | 🟢 LOW | CRLF line endings trong `disk_scanner.py`, print statements lộn xộn |

---

## 🔍 Chi Tiết Vấn Đề

### 🔴 BUG 1: numpy import không dùng

```python
# report_comparison.py:11
import numpy as np  # ← NEVER USED — gây lỗi ImportError nếu không install
```

**Impact:** Tool sẽ **crash** ngay khi import trên server không có numpy.

---

### 🔴 DUPLICATION 1: `_create_usage_bar` ở 2 nơi

| File | Dòng | Code |
|------|------|------|
| `base_formatter.py` | L39-43 | `_create_usage_bar(percent, width=20)` |
| `disk_scanner.py` | L666-680 | `_create_usage_bar(percent, width=20)` — **giống hệt** |

`DiskScanner` không kế thừa `BaseFormatter` nhưng copy method. Cần di chuyển vào `utils.py` hoặc `DiskScanner` import `BaseFormatter`.

---

### 🔴 DUPLICATION 2: User filter logic lặp 4 lần

Trong `report_formatter.py`:
- `_display_checked_users_report()` → L74: filter users
- `_display_top_users_report()` → delegates to `_display_user_usage_table()`
- `_display_standard_report()` → L125, L138: filter users lặp lại
- `_display_user_usage_table()` → L149-150: filter lại lần nữa

**Result:** Cùng một list `users` bị filter 2 lần (một lần ở caller, một lần ở callee).

---

### 🟡 STRUCTURAL: `formatter.py` là redundant shim

```python
# src/formatter.py — chỉ 13 dòng, chỉ để re-export
from src.formatters.base_formatter import BaseFormatter
from src.formatters.table_formatter import TableFormatter
from src.formatters.report_formatter import ReportFormatter
```

Được dùng duy nhất trong `src/__init__.py`:
```python
from src.formatter import TableFormatter, ReportFormatter
```

→ Có thể xóa `formatter.py`, import trực tiếp từ `formatters/`.

---

### 🟡 STRUCTURAL: `disk_scanner.py` có CRLF line endings

File `disk_scanner.py` dùng Windows line endings (`\r\n`) trong khi tất cả file khác dùng Unix (`\n`). Gây diff noise và tiềm ẩn lỗi trên Linux.

---

### 🟡 LOGIC: Filename generation trong `disk_checker.py` quá dài

Đoạn code từ dòng 111-148 trong `disk_checker.py` xử lý filename generation với 30+ dòng nested if/else. Logic này nên được encapsulate vào `ReportGenerator` hoặc một helper function.

---

### 🟡 LOGIC: None-check thừa trong `_worker()`

```python
# disk_scanner.py _worker() — L216-218
# Double-check that current_dir is not None before proceeding
if current_dir is None:
    continue
```

Đây là dead code — `current_dir` đã được check L197-214. Nếu `None`, đã `continue` trước đó rồi.

---

### 🟡 LOGIC: `_get_output_filename()` trong `report_generator.py` không chính xác

```python
# report_generator.py L43-48
if "_" in main_filename:
    parts = main_filename.split("_")
    if len(parts) > 1:
        prefix = parts[0]  # ← Luôn lấy phần đầu làm prefix dù không phải prefix thực
```

Nếu file tên là `disk_usage_report.json`, sẽ lấy `disk` làm prefix — sai logic.

---

### 🟢 INCONSISTENCY: `ConfigDisplay` không dùng `BaseFormatter`

`ConfigDisplay` khởi tạo `TableFormatter()` riêng nhưng không kế thừa `BaseFormatter`. Trong khi đó `TableFormatter` và `ReportComparison` đều kế thừa `BaseFormatter`.

---

## 🏗️ Đề Xuất Cấu Trúc Mới

### Trước (Hiện Tại)

```
src/
├── __init__.py          ← over-export, mixed concerns
├── formatter.py         ← redundant shim
├── cli_interface.py     ← OK
├── config_manager.py    ← OK
├── disk_scanner.py      ← CRLF, duplicated _create_usage_bar
├── report_generator.py  ← broken prefix logic
├── utils.py             ← ScanHelper class mixed với standalone functions
└── formatters/
    ├── __init__.py
    ├── base_formatter.py        ← _create_usage_bar lives here
    ├── table_formatter.py       ← OK
    ├── config_display.py        ← không kế thừa BaseFormatter
    ├── report_comparison.py     ← unused numpy import
    └── report_formatter.py      ← double-filter bug
```

### Sau (Đề Xuất)

```
src/
├── __init__.py              ← clean, chỉ export public API
├── cli/
│   └── interface.py         ← renamed cli_interface.py
├── core/
│   ├── scanner.py           ← disk_scanner.py (fix CRLF, remove dead code)
│   ├── config.py            ← config_manager.py
│   └── reporter.py          ← report_generator.py (fix prefix logic)
├── output/
│   ├── base.py              ← base_formatter.py
│   ├── table.py             ← table_formatter.py
│   ├── config_view.py       ← config_display.py (inherit BaseFormatter)
│   ├── comparison.py        ← report_comparison.py (remove numpy)
│   └── report_view.py       ← report_formatter.py (fix double-filter)
└── shared/
    ├── utils.py             ← standalone utility functions
    └── helpers.py           ← ScanHelper class (tách khỏi utils.py)
```

> **Lưu ý:** Nếu muốn giữ flat structure (không đổi nhiều), chỉ cần fix 5 bug cụ thể cũng đủ mà không cần restructure toàn bộ folder.

---

## ✅ Success Criteria

- [ ] `numpy` import được xóa → tool chạy được không cần numpy
- [ ] `_create_usage_bar` chỉ ở 1 nơi
- [ ] User filter không bị apply 2 lần
- [ ] `_get_output_filename()` prefix logic đúng
- [ ] `disk_scanner.py` chuyển sang LF line endings
- [ ] Dead code `None-check` thứ 2 được xóa
- [ ] `formatter.py` shim được xóa
- [ ] Tests pass sau refactor (nếu có)

---

## 📊 Task Breakdown

### Phase 1 — Bug Fixes Ngay (No Structure Change)

> Những thứ này nên fix **trước** vì có thể gây runtime error.

**Task 1.1: Xóa `numpy` import**
- **Agent:** `backend-specialist`
- **File:** `src/formatters/report_comparison.py` L11
- **INPUT:** `import numpy as np`
- **OUTPUT:** Dòng đó bị xóa
- **VERIFY:** `python -c "from src.formatters.report_comparison import ReportComparison"` không lỗi
- **Priority:** P0 🔴
- **Risk:** None — numpy không được dùng

**Task 1.2: Fix `_get_output_filename()` prefix logic**
- **Agent:** `backend-specialist`
- **File:** `src/report_generator.py` L37-81
- **INPUT:** Logic sai — lấy phần đầu của filename làm prefix
- **OUTPUT:** Chỉ lấy prefix nếu main output file thực sự có prefix (từ config)
- **VERIFY:** `permission_issues.json` và `top_user.json` có tên đúng khi main output là `disk_sda_disk_usage_report_20260322.json`
- **Priority:** P0 🔴

**Task 1.3: Xóa dead None-check trong `_worker()`**
- **Agent:** `backend-specialist`
- **File:** `src/disk_scanner.py` L216-218
- **INPUT:** Second `if current_dir is None: continue`
- **OUTPUT:** Dòng dead code bị xóa
- **VERIFY:** Tool vẫn chạy bình thường
- **Priority:** P1 🟡

**Task 1.4: Fix CRLF → LF trong `disk_scanner.py`**
- **Agent:** `backend-specialist`
- **Command:** `dos2unix src/disk_scanner.py`
- **INPUT:** File với CRLF endings
- **OUTPUT:** File với LF endings
- **VERIFY:** `file src/disk_scanner.py` không còn hiện "CRLF"
- **Priority:** P1 🟡

---

### Phase 2 — Code Deduplication

**Task 2.1: Hợp nhất `_create_usage_bar`**
- **Agent:** `backend-specialist`
- **INPUT:** Method tồn tại ở `base_formatter.py` VÀ `disk_scanner.py`
- **OUTPUT:**
  - Giữ nguyên trong `base_formatter.py`
  - Trong `DiskScanner._display_scan_summary()`: import từ `BaseFormatter` hoặc move vào `utils.py` như standalone function `create_usage_bar()`
- **VERIFY:** `DiskScanner` vẫn hiển thị usage bar đúng
- **Priority:** P1 🟡

**Task 2.2: Fix double-filter bug trong `report_formatter.py`**
- **Agent:** `backend-specialist`
- **File:** `src/formatters/report_formatter.py`
- **INPUT:** `_display_standard_report()` filter users ở L125/138, rồi pass filter_users xuống `_display_user_usage_table()` lại filter lần nữa ở L149
- **OUTPUT:** Chỉ filter ở một nơi — trong `_display_user_usage_table()`, không filter ở caller
- **VERIFY:** `--show-report --user username` hiển thị đúng user
- **Priority:** P1 🟡

---

### Phase 3 — Structural Cleanup

**Task 3.1: Xóa `src/formatter.py` shim**
- **Agent:** `backend-specialist`
- **INPUT:** `src/formatter.py` — 13 dòng chỉ re-export
- **OUTPUT:**
  - Xóa `src/formatter.py`
  - Update `src/__init__.py` import directly từ `src.formatters.*`
  - Update `disk_scanner.py` L580: `from src.formatter import TableFormatter` → `from src.formatters.table_formatter import TableFormatter`
- **VERIFY:** `python disk_checker.py --list` vẫn chạy
- **Priority:** P2 🟢

**Task 3.2: Làm `ConfigDisplay` kế thừa `BaseFormatter`**
- **Agent:** `backend-specialist`
- **File:** `src/formatters/config_display.py`
- **INPUT:** `class ConfigDisplay:` không kế thừa, có `self.table_formatter = TableFormatter()` riêng
- **OUTPUT:** `class ConfigDisplay(BaseFormatter):` — xóa `TableFormatter()` riêng, dùng `self.table_formatter` từ `BaseFormatter` (hoặc inject)
- **VERIFY:** `--list` hiển thị đúng
- **Priority:** P2 🟢

**Task 3.3: Tách `ScanHelper` ra khỏi `utils.py`**
- **Agent:** `backend-specialist`
- **INPUT:** `utils.py` trộn lẫn standalone functions (`format_size`, `parse_size`...) với `class ScanHelper`
- **OUTPUT:** `ScanHelper` move sang `src/helpers.py` hoặc `src/scan_helper.py`
- **VERIFY:** All imports vẫn hoạt động
- **Priority:** P2 🟢

**Task 3.4: Refactor filename logic trong `disk_checker.py`**
- **Agent:** `backend-specialist`
- **INPUT:** L96-153 trong `disk_checker.py` — 50+ dòng xử lý output filename
- **OUTPUT:** Encapsulate vào `ReportGenerator.resolve_output_path(args)` method
- **VERIFY:** `--output`, `--output-dir`, `--prefix`, `--date` vẫn hoạt động đúng
- **Priority:** P2 🟢

---

### Phase 4 — Optional: Restructure (Nếu muốn folder rõ ràng hơn)

> Chỉ làm nếu user muốn thay đổi cấu trúc thư mục. Không cần thiết cho correctness.

**Task 4.1: Tổ chức lại thành `cli/`, `core/`, `output/`, `shared/`**
- **Agent:** `backend-specialist`
- **INPUT:** Flat structure hiện tại
- **OUTPUT:** 4-layer structure như đề xuất ở trên
- **VERIFY:** `python disk_checker.py --run` vẫn chạy
- **Priority:** P3 🔵 (Optional)
- **Risk:** Phải update tất cả import paths

---

### Phase X — Verification

```bash
# 1. No numpy required
python -c "import sys; sys.path.insert(0, '.'); from src.formatters.report_comparison import ReportComparison; print('OK')"

# 2. Basic CLI works
python disk_checker.py --help

# 3. Config commands work
python disk_checker.py --list

# 4. Report display works (với file mock)
python disk_checker.py --show-report --files mock_report.json

# 5. No duplicate method
grep -rn "_create_usage_bar" src/  # Should appear in only base_formatter.py
```

- [ ] `import numpy` không còn trong codebase
- [ ] `_create_usage_bar` chỉ ở 1 file
- [ ] Filter logic không bị duplicate
- [ ] `formatter.py` shim đã xóa
- [ ] CRLF không còn trong `disk_scanner.py`
- [ ] Dead code None-check đã xóa
- [ ] Prefix logic trong `_get_output_filename()` đúng

---

## 🚀 Recommended Order

```
Task 1.1 → Task 1.2 → Task 1.3 → Task 1.4   (Phase 1: Critical fixes)
    ↓
Task 2.1 → Task 2.2                            (Phase 2: Dedup)
    ↓
Task 3.1 → Task 3.2 → Task 3.3 → Task 3.4    (Phase 3: Cleanup)
    ↓
[Optional] Task 4.1                            (Phase 4: Restructure)
```

> **Next Step:** Run `/enhance` và tham chiếu plan này để bắt đầu implement.
