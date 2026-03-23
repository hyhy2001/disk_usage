# PLAN: detail-report-redesign

> **Project:** check_disk — Detail Report Redesign  
> **Type:** BACKEND (Python CLI)  
> **Agent:** `backend-specialist` + `python-patterns`  
> **Date:** 2026-03-22  
> **Status:** ✅ READY TO IMPLEMENT

---

## ✅ Câu Trả Lời Đã Xác Nhận

| # | Câu hỏi | Trả lời |
|---|---------|---------|
| **Q1** | `detail_report_file` format? | **Option A: Tất cả files per user (không giới hạn Top N)** |
| **Q2** | Giới hạn N = bao nhiêu? | **Không giới hạn — track tất cả files** |
| **Q3** | `--check-user` flag? | **Xóa flag CLI, chuyển sang đọc JSON per-user files** |

---

## 📋 Tóm Tắt Thay Đổi

| Hiện tại | Sau thay đổi |
|----------|-------------|
| `--top-user N` → `top_user.json` | ❌ Remove |
| `--min-usage SIZE` | ❌ Remove |
| `--check-user` → `check_user.json` | ❌ Remove flag CLI |
| `permission_issues.json` | Giữ, **không có date trong tên file** |
| `check_user.json` | Giữ format, **không có date trong tên file** |
| `detail_dir` chỉ trong top_user/check_user | ✅ **Always generated** cho mọi user |
| Không có file-level tracking | ✅ **Mới**: per-user file detail report (tất cả files) |
| Global `inode_lock` per-file | ✅ **Tối ưu**: per-thread local sets, merge sau |

---

## 🏛️ Quyết Định: Per-User Files

**Chọn per-user files** (không phải combined):

| Tiêu chí | Per-user ✅ | Combined ❌ |
|----------|-----------| -----------|
| File size | Nhỏ, tỷ lệ user | 100MB+ không kiểm soát |
| API serving | On-demand per user | Load tất cả |
| Dashboard | Lazy load khi click user | All-or-nothing |
| Parallel write | Có thể | Không |

---

## 📄 File Naming Convention Mới

```
Main report:        {prefix}_disk_usage_report{_date}.json   ← date optional
Permission issues:  {prefix}_permission_issues.json           ← NO date
Check user:         {prefix}_check_user.json                  ← NO date
Detail dir (user):  {prefix}_detail_report_dir_{user}.json   ← NO date
Detail file (user): {prefix}_detail_report_file_{user}.json  ← NO date
```

**Ví dụ** với prefix `sda1` và date `20260322`:

```
sda1_disk_usage_report_20260322.json   ← main (có date)
sda1_permission_issues.json            ← no date
sda1_check_user.json                   ← no date
sda1_detail_report_dir_Binh.json       ← no date
sda1_detail_report_file_Binh.json      ← no date
```

---

## 📄 JSON Format

### `{prefix}_detail_report_dir_{user}.json`

```json
{
  "date": 1742600000,
  "directory": "/data/users",
  "user": "Binh",
  "total_used": 2748779069440,
  "dirs": [
    { "path": "/data/users/Binh/projects", "used": 1649267441664 },
    { "path": "/data/users/Binh/datasets", "used": 824633720832 }
  ]
}
```

### `{prefix}_detail_report_file_{user}.json` — Option A (All files)

```json
{
  "date": 1742600000,
  "user": "Binh",
  "total_files": 15420,
  "total_used": 2748779069440,
  "files": [
    { "path": "/data/users/Binh/model.h5",   "size": 549755813888 },
    { "path": "/data/users/Binh/data.tar.gz", "size": 274877906944 }
  ]
}
```

> ⚠️ **Lưu ý:** `files` sorted by size descending. Đây là tất cả files (không top N).

---

## 🚀 Scanner Performance Optimization

### Bottleneck Analysis

| # | Vấn đề | Mức độ | Vị trí |
|---|--------|--------|--------|
| **B1** | Global `inode_lock` per-file — serialize TẤT CẢ threads | 🔴 CRITICAL | `disk_scanner.py:280` |
| **B2** | `processed_inodes` shared global set — lock contention + memory growth | 🔴 HIGH | `disk_scanner.py:94` |
| **B3** | `global_queue.extend()` với lock — tranh nhau nhiều | 🟡 MEDIUM | `disk_scanner.py:342` |

### Giải pháp Tối Ưu Inode (B1 + B2)

**Thay vì global lock per-file, dùng per-thread local sets:**

```
Cũ:
  Thread 1 ──→ acquire global_inode_lock ──→ check/add to global set ──→ release
  Thread 2 ──→ WAIT ──→ acquire ──→ check/add ──→ release
  Thread N ──→ WAIT ──→ ...

Mới:
  Thread 1 ──→ check/add local set (no lock!) ──→ process file
  Thread 2 ──→ check/add local set (no lock!) ──→ process file
  Thread N ──→ check/add local set (no lock!) ──→ process file
  Merge ──→ post-process: find và remove cross-thread duplicates
```

**Trade-off:** Hard links across directories có thể bị đếm 2 lần (nếu 2 threads gặp cùng inode). Nhưng hard links thực tế rất hiếm → chấp nhận được. Hoặc có thể merge sau khi scan xong (exact).

**Implementation:**

```python
# ThreadStats: thêm field
processed_inodes: Set[Tuple[int, int]] = field(default_factory=set)

# Trong _worker: XÓA global lock, dùng local
inode_key = (st.st_ino, st.st_dev)
if inode_key not in my_stats.processed_inodes:
    my_stats.processed_inodes.add(inode_key)
    # process file...
```

### Giải pháp File Tracking (cho detail_report_file)

Thêm `file_paths` vào `ThreadStats`:
```python
# Per-thread: Dict[uid, List[Tuple[path, size]]]
file_paths: Dict[int, List[Tuple[str, int]]] = field(default_factory=lambda: defaultdict(list))
```

Sau scan, merge và sort by size:
```python
# _process_scan_results:
merged_file_paths = defaultdict(list)
for stats in thread_stats:
    for uid, files in stats.file_paths.items():
        merged_file_paths[uid].extend(files)
# Sort per user
for uid in merged_file_paths:
    merged_file_paths[uid].sort(key=lambda x: x[1], reverse=True)
```

---

## 🔧 Impact Analysis

| File | Thay đổi | Mức độ |
|------|----------|--------|
| `src/disk_scanner.py` | **Tối ưu inode** (per-thread sets) + thêm file-level tracking | 🔴 HIGH |
| `src/report_generator.py` | Thêm `generate_detail_reports()`, xóa `generate_top_user_report()`, fix date trong sibling filenames | 🔴 HIGH |
| `disk_checker.py` | Xóa top_user/min_usage/check_user handling; wire up detail reports | 🟡 MEDIUM |
| `src/cli_interface.py` | Xóa `--top-user`, `--min-usage`, `--check-user` args | 🟡 MEDIUM |
| `README.md` | Update CLI reference + report formats | 🟢 LOW |

---

## 📊 Task Breakdown

### Phase 0 — Scanner Performance (Làm TRƯỚC)

**Task 0.1: Refactor inode deduplication — per-thread local sets**
- Add `processed_inodes: Set[Tuple[int, int]]` vào `ThreadStats`
- Xóa `self.processed_inodes` và `self.inode_lock` khỏi `DiskScanner.__init__`
- Trong `_worker`: thay `with self.inode_lock:` bằng check local `my_stats.processed_inodes`
- **VERIFY:** Scan speed tăng đáng kể (không còn lock contention)
- **Priority:** P0 🔴

**Task 0.2: Thêm file path tracking vào `ThreadStats` và `_worker()`**
- Thêm `file_paths: Dict[int, List[Tuple[str, int]]]` vào `ThreadStats`
- Trong `_worker`, khi `process_file = True`: thêm `(entry.path, size)` vào `my_stats.file_paths[uid]`
- **Priority:** P0 🔴

**Task 0.3: Merge file paths trong `_process_scan_results()`**
- Merge `file_paths` từ tất cả threads
- Sort by size descending per UID
- Store vào `self.file_paths_results: Dict[str, List[Tuple[str, int]]]` (uid → username conversion)
- **Priority:** P0 🔴

---

### Phase 1 — ScanResult Update

**Task 1.1: Cập nhật `ScanResult` dataclass**
- Thêm `detail_files: Dict[str, List[Tuple[str, int]]]` field (username → list of (path, size))
- **Priority:** P0 🔴

---

### Phase 2 — ReportGenerator

**Task 2.1: Viết `_get_user_detail_filename(base, user)`**

```python
def _get_user_detail_filename(self, base: str, user: str) -> str:
    """Build path for per-user detail report — never includes date."""
    dir_part = os.path.dirname(self.output_file)
    prefix = self.config.get('output_prefix', '')
    parts = [p for p in [prefix, base, user] if p]
    fname = '_'.join(parts) + '.json'
    return os.path.join(dir_part, fname) if dir_part else fname
```

- **VERIFY:** `_get_user_detail_filename('detail_report_dir', 'Binh')` == `'sda1_detail_report_dir_Binh.json'`
- **Priority:** P0 🔴

**Task 2.2: Fix `_get_output_filename` — remove date từ sibling reports**
- `permission_issues` và `check_user` không dùng `output_date_suffix`
- **VERIFY:** `_get_output_filename('permission_issues')` == `'sda1_permission_issues.json'`
- **Priority:** P0 🔴

**Task 2.3: Viết `generate_detail_reports(scan_result)`**

```python
def generate_detail_reports(self, scan_result: ScanResult) -> List[str]:
    """Generate per-user dir + file detail reports. Returns created paths."""
    users = {entry['user'] for entry in scan_result.top_dir}
    created = []
    for user in sorted(users):
        # Dir report
        dirs = [e for e in scan_result.top_dir if e['user'] == user]
        total = sum(d['user_usage'] for d in dirs)
        dir_data = {
            'date': scan_result.timestamp,
            'directory': self.config.get('directory', ''),
            'user': user,
            'total_used': total,
            'dirs': [{'path': d['dir'], 'used': d['user_usage']}
                     for d in sorted(dirs, key=lambda x: x['user_usage'], reverse=True)]
        }
        dir_path = self._get_user_detail_filename('detail_report_dir', user)
        save_json_report(dir_data, dir_path)
        created.append(dir_path)

        # File report — all files sorted by size
        user_files = scan_result.detail_files.get(user, [])
        file_data = {
            'date': scan_result.timestamp,
            'user': user,
            'total_files': len(user_files),
            'total_used': sum(s for _, s in user_files),
            'files': [{'path': p, 'size': s} for p, s in user_files]
        }
        file_path = self._get_user_detail_filename('detail_report_file', user)
        save_json_report(file_data, file_path)
        created.append(file_path)

    return created
```

- **VERIFY:** Files `sda1_detail_report_dir_Binh.json` và `sda1_detail_report_file_Binh.json` tồn tại sau scan
- **Priority:** P0 🔴

**Task 2.4: Xóa `generate_top_user_report()`**
- **VERIFY:** `grep -r "generate_top_user" src/` == empty
- **Priority:** P1 🟡

---

### Phase 3 — CLI

**Task 3.1: Xóa `--top-user`, `--min-usage`, `--check-user` khỏi `cli_interface.py`**
- **VERIFY:** `python disk_checker.py --help` không còn 3 flags này
- **Priority:** P1 🟡

**Task 3.2: Cleanup `disk_checker.py`**
- Xóa: `top_user_count`, `min_usage`, `check_users` variables
- Xóa: `DiskScanner(top_user_count=..., min_usage=..., check_users=...)` params
- Thêm: `report_generator.generate_detail_reports(scan_results)`
- **Priority:** P1 🟡

---

### Phase 4 — Scanner Cleanup

**Task 4.1: Xóa `top_user_count`, `min_usage`, `check_users` khỏi `DiskScanner.__init__()`**
- Xóa `check_users`, `check_user_uids`, `top_user_count`, `min_usage` params và logic
- Xóa `_build_check_user_uids()`
- **Priority:** P2 🟢

---

### Phase 5 — README

**Task 5.1: Update README**
- Xóa `--top-user`, `--min-usage`, `--check-user` khỏi CLI Reference
- Thêm `detail_report_dir` và `detail_report_file` vào Report Formats
- **Priority:** P2 🟢

---

### Phase X — Verification

```bash
# Flags removed
python3 disk_checker.py --help | grep "top-user"    # → empty
python3 disk_checker.py --help | grep "min-usage"   # → empty
python3 disk_checker.py --help | grep "check-user"  # → empty

# Sibling reports have no date
python3 -c "
from src.report_generator import ReportGenerator
rg = ReportGenerator({'output_file': 'sda1_report_20260322.json',
                      'output_prefix': 'sda1', 'output_date_suffix': '20260322'})
assert rg._get_output_filename('permission_issues') == 'sda1_permission_issues.json'
assert rg._get_user_detail_filename('detail_report_dir', 'Binh') == 'sda1_detail_report_dir_Binh.json'
assert rg._get_user_detail_filename('detail_report_file', 'Binh') == 'sda1_detail_report_file_Binh.json'
print('ALL PASS')
"

# Verify no global inode_lock usage
grep -n "inode_lock" check_disk/src/disk_scanner.py  # → empty (or only in comments)
```

---

## 🚀 Implementation Order

```
Phase 0: Scanner Optimization (inode lock + file tracking)
    ↓
Task 1.1 (ScanResult dataclass — thêm detail_files)
    ↓
Task 2.1 + 2.2 (Filename helpers)
    ↓
Task 2.3 (generate_detail_reports)
    ↓
Task 2.4 + 3.1 (Remove old code)
    ↓
Task 3.2 (wire up disk_checker.py)
    ↓
Task 4.1 (Scanner param cleanup)
    ↓
Task 5.1 (README)
    ↓
Phase X Verification
```
