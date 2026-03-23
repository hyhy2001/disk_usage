# PLAN-ux-ui-improvements.md

## 📋 Overview

**Project:** StorageOS Disk Usage Dashboard – UX/UI Improvement Sprint  
**Project Type:** WEB  
**Requested by:** `/plan` – "xem thử hệ thống giờ cần cải tiến gì về UX/UI nữa không"  
**Created:** 2026-03-22  

### Context

Sau khi hoàn thành: CSS cleanup, Lighthouse Best Practices, API fixes, responsive refactoring — hệ thống hiện **ổn định và deploy tốt**. Sprint này tập trung vào **trải nghiệm người dùng** còn lại, dựa trên:

1. Kết quả UX Audit script (`3 issues, 80 warnings`)
2. Code review HTML / CSS / JS toàn bộ
3. Quan sát thực tế các UX pattern còn thiếu

---

## ✅ Success Criteria

| # | Tiêu chí | Cách xác minh |
|---|----------|---------------|
| 1 | UX Audit trả về **0 issues** (hiện 3) | Chạy `python3 .agent/skills/frontend-design/scripts/ux_audit.py .` |
| 2 | Tất cả button/target ≥ 44×44px | Kiểm tra DevTools + audit |
| 3 | Skeleton loading thay thế text "Loading…" | Visual check |
| 4 | Empty state có icon + CTA thay vì text trống | Visual check |
| 5 | Keyboard navigation hoạt động (Tab, Enter, Esc) | Manual test |
| 6 | Toast notification khi Sync Now thành công/thất bại | User test |
| 7 | Fluid typography dùng `clamp()` ≥ 3 nơi quan trọng | CSS review |

---

## 🛠 Tech Stack

| Layer | Tech | Lý do |
|-------|------|-------|
| Markup | Vanilla HTML5 | Đã có sẵn, không thay đổi framework |
| Styling | Vanilla CSS (variables, clamp) | Giữ nguyên design system hiện tại |
| Logic | Vanilla ES Modules | Đã có module system |
| Animation | CSS keyframes + `transition` | Không thêm thư viện ngoài |

---

## 📁 File Structure (các file bị ảnh hưởng)

```
disk_usage/
├── index.html              ← Empty states, Toast markup, ARIA labels
├── css/
│   ├── components.css      ← Skeleton, Toast, Empty state, Touch targets
│   ├── layout.css          ← Fluid typography (clamp), small target fixes
│   └── index.css           ← (ít thay đổi)
└── js/
    ├── main.js             ← Toast notification logic
    ├── dataFetcher.js      ← Trigger toast sau fetch
    └── detailRenderer.js   ← Empty state rendering
```

---

## 🗂 Task Breakdown

### 🔴 PRIORITY 1 – Issues từ UX Audit (phải fix)

---

#### TASK-01: Fix Small Touch Targets (Fitts' Law)

**Agent:** `frontend-specialist`  
**Skill:** `frontend-design`  
**Priority:** P0 (Issue, không phải Warning)  

**Vấn đề:**  
UX Audit phát hiện buttons nhỏ hơn 44px. Cụ thể:
- `.range-btn`: padding `3px 10px` → height ≈ 26px ❌
- `.detail-tab-btn`: height ≈ 38px (gần đủ nhưng chưa đạt mobile)
- `.hrange-btn` trong History tab: nhỏ tương tự range-btn

**INPUT:** `css/layout.css`, `css/components.css`  
**OUTPUT:** Tất cả interactive elements ≥ 32px min-height (với context spacing)  
**VERIFY:**
```
- Chạy UX audit → Fitts' Law warning giảm
- Kiểm tra bằng tay trên mobile (DevTools 375px)
```

**Thay đổi cụ thể:**
```css
/* layout.css */
.range-btn {
    padding: 6px 10px;   /* tăng từ 3px → 6px */
    min-height: 32px;    /* thêm min-height */
}

.hrange-btn {
    min-height: 32px;
    padding: 6px 10px;
}
```

---

#### TASK-02: Fix Form Inputs Without Labels (Cognitive Load / Accessibility)

**Agent:** `frontend-specialist`  
**Skill:** `frontend-design`  
**Priority:** P0  

**Vấn đề:**  
UX Audit: `Form inputs without labels` — các input `disk-search`, `user-filter-search`, `filter-date-start/end` không có `<label>` liên kết đúng.

**INPUT:** `index.html`  
**OUTPUT:** Tất cả inputs có `aria-label` attribute  
**VERIFY:**
```
- Chạy UX audit → Cognitive Load issue biến mất
```

---

#### TASK-03: Reduce Nav Item Count (Hick's Law)

**Agent:** `frontend-specialist`  
**Skill:** `frontend-design`  
**Priority:** P0  

**Vấn đề:**  
UX Audit: `8-9 nav items (Max 7)` — có thể do CSS build-up đếm nhiều class `.nav-item`. Cần kiểm tra xem audit đang đếm gì và clean up nếu cần.

**INPUT:** `index.html`, `css/components.css`  
**OUTPUT:** Nav items ≤ 7 theo audit  
**VERIFY:** UX Audit → Hick's Law issue biến mất

---

### 🟡 PRIORITY 2 – UX Improvements (fix quan trọng nhất)

---

#### TASK-04: Skeleton Loading States (thay "Loading…" text)

**Agent:** `frontend-specialist`  
**Skill:** `frontend-design`  
**Priority:** P1  

**Vấn đề hiện tại:**
```html
<div class="disk-list-item loading">Loading disks…</div>
<div id="tab-snapshot-body" class="snapshot-body">Loading…</div>
<span class="table-empty">Loading…</span>
```

Trải nghiệm kém: text "Loading…" trông thô, không premium.

**INPUT:** `index.html`, `css/components.css`, `js/detailRenderer.js`  
**OUTPUT:** Skeleton pulse animation thay thế loading text  
**VERIFY:** Visual check — không còn text loading thô; shimmer animation mượt

**CSS cần thêm:**
```css
.skeleton {
    background: linear-gradient(90deg, 
        rgba(255,255,255,0.05) 25%, 
        rgba(255,255,255,0.1) 50%, 
        rgba(255,255,255,0.05) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: 6px;
}

@keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}
```

---

#### TASK-05: Empty State Design (khi không có data)

**Agent:** `frontend-specialist`  
**Skill:** `frontend-design`  
**Priority:** P1  

**Vấn đề hiện tại:**
```html
<p class="table-empty">Select a disk, then click this tab to load permission issues.</p>
```

Text đơn thuần, không có visual hierarchy.

**INPUT:** `index.html`, `css/components.css`, `js/permissionRenderer.js`  
**OUTPUT:** Empty state với icon SVG + heading + description  
**VERIFY:** Visual check trên Permissions tab khi chưa chọn disk

**Design spec:**
```
    🔒  (SVG lock icon, 48px, amber tint)
  No Data Yet
  Select a disk from the sidebar to analyze permission issues.
```

---

#### TASK-06: Toast Notification System

**Agent:** `frontend-specialist`  
**Skill:** `frontend-design`  
**Priority:** P1  

**Vấn đề hiện tại:**  
Khi click "Sync Now" → không có feedback rõ ràng ngoài status bar nhỏ trong sidebar.

**INPUT:** `js/main.js`, `js/dataFetcher.js`, `css/components.css`, `index.html`  
**OUTPUT:** Toast notification xuất hiện góc phải dưới, auto-dismiss sau 3s  
**VERIFY:**
- Click Sync Now → Toast "✓ Data synced successfully" xuất hiện
- Network error → Toast "✗ Sync failed – check connection" xuất hiện
- Toast tự biến mất sau 3 giây

**CSS spec:**
```css
.toast-container {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
}

.toast {
    background: var(--bg-surface-elevated);
    border: 1px solid rgba(16,185,129,0.3);
    border-left: 3px solid var(--emerald-500);
    border-radius: 10px;
    padding: 12px 16px;
    min-width: 260px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    animation: toastIn 0.3s ease, toastOut 0.3s ease 2.7s forwards;
    pointer-events: auto;
}

@keyframes toastIn {
    from { transform: translateX(100%); opacity: 0; }
    to   { transform: translateX(0); opacity: 1; }
}
@keyframes toastOut {
    from { transform: translateX(0); opacity: 1; }
    to   { transform: translateX(100%); opacity: 0; }
}
```

---

#### TASK-07: Fluid Typography với `clamp()`

**Agent:** `frontend-specialist`  
**Skill:** `frontend-design`  
**Priority:** P2  

**Vấn đề:**  
UX Audit: `Fixed font sizes without clamp()` — headings và key stats dùng px cứng.

**INPUT:** `css/layout.css`, `css/components.css`  
**OUTPUT:** Ít nhất 3 heading/stat quan trọng dùng `clamp()`  
**VERIFY:** Resize viewport 320px → 1440px, text scale mượt

**Thay đổi cụ thể:**
```css
/* layout.css */
.top-header h1 {
    font-size: clamp(1.1rem, 2.5vw, 1.5rem);
}

/* components.css */
.stat-number {
    font-size: clamp(1rem, 2vw, 1.35rem);
}

.tsh-value {
    font-size: clamp(1rem, 2vw, 1.3rem);
}
```

---

#### TASK-08: Keyboard Navigation & Focus Styles

**Agent:** `frontend-specialist`  
**Skill:** `frontend-design`  
**Priority:** P2  

**Vấn đề:**  
- Không có visible focus ring style nhất quán
- Chart modal không có focus trap (Esc)
- Disk list không navigatable bằng Arrow Keys

**INPUT:** `css/components.css`, `css/layout.css`, `js/chartModal.js`  
**OUTPUT:**
- Custom focus ring: `outline: 2px solid var(--emerald-500); outline-offset: 2px`
- Esc key đóng chart modal
- Disk items có basic keyboard access

**VERIFY:**
- Tab qua tất cả interactive elements → rõ ràng highlighted
- Esc khi modal mở → modal đóng

---

### 🟢 PRIORITY 3 – Polish

---

#### TASK-09: Sidebar Micro-animations

**Agent:** `frontend-specialist`  
**Skill:** `frontend-design`  
**Priority:** P3  

**Vấn đề:** Disk list items khi switch disk không có transition, cảm giác "bật/tắt" đột ngột.

**OUTPUT:** Active disk item highlight với smooth color transition

---

#### TASK-10: Progress Bar Shimmer khi Syncing

**Agent:** `frontend-specialist`  
**Skill:** `frontend-design`  
**Priority:** P3  

**OUTPUT:** Progress bar có indeterminate animation khi đang loading (không cần % thực).

---

## 📊 Dependency Graph

```
TASK-01 ──→ [independent]
TASK-02 ──→ [independent]  
TASK-03 ──→ [independent]
TASK-04 ──→ [independent]
TASK-05 ──→ [independent]
TASK-06 ──→ TASK-04 (cùng loading flow, nên làm sau)
TASK-07 ──→ [independent]
TASK-08 ──→ TASK-05 (cần empty state xong để test đúng)
TASK-09 ──→ [independent]
TASK-10 ──→ [independent]
```

**Parallel-safe:** `01, 02, 03, 04, 05, 07, 09, 10`  
**Sequential:** `06` sau `04`, `08` sau `05`

---

## 🏁 Phase X — Verification Checklist

```bash
# UX Audit (target: 0 issues)
python3 .agent/skills/frontend-design/scripts/ux_audit.py .

# Security (no regression)
python3 .agent/skills/vulnerability-scanner/scripts/security_scan.py .
```

### Manual Checks
- [ ] Toast hiện khi sync success/error
- [ ] Skeleton loading hiện khi fetch disks
- [ ] Empty state đẹp trong Permissions tab
- [ ] Keyboard Tab navigation hoạt động
- [ ] Esc đóng chart modal
- [ ] Mobile (375px): touch targets đủ lớn
- [ ] Light mode: contrast tốt
- [ ] Không có console errors mới

### Rule Compliance
- [ ] Không dùng purple/violet mới
- [ ] Animations ≤ 0.4s

---

## 📋 Implementation Order (Recommended)

| Bước | Tasks | Ước tính |
|------|-------|---------|
| 1 | TASK-01 + TASK-02 + TASK-03 (Audit fixes) | 20 phút |
| 2 | TASK-07 (Typography clamp) | 15 phút |
| 3 | TASK-04 (Skeleton loading) | 25 phút |
| 4 | TASK-05 (Empty State) | 20 phút |
| 5 | TASK-06 (Toast system) | 30 phút |
| 6 | TASK-08 (Keyboard nav + focus) | 25 phút |
| 7 | TASK-09 + TASK-10 (Polish) | 20 phút |
| 8 | Phase X verification | 15 phút |

**Tổng:** ~170 phút (3-4 giờ)

---

*Kế hoạch tạo bởi `@project-planner` — 2026-03-22*  
*Tiếp theo: Chạy `/enhance` để implement hoặc confirm task muốn bắt đầu trước.*
