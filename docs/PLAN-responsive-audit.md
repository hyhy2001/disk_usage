# Responsive Audit: Full Component Sweep

> **Agent:** `frontend-specialist`
> **Skill:** `frontend-design`
> **Created:** 2026-03-21
> **Scope:** Kiểm tra toàn diện responsive tất cả component — **KHÔNG code mới, chỉ plan**

---

## Goal

Audit toàn bộ component trong codebase, xác định chính xác từng vị trí chưa responsive, phân loại severity, và lập task list ưu tiên để fix.

---

## Audit Findings — Danh sách vấn đề phát hiện

Sau khi đọc `css/layout.css`, `css/components.css`, `css/index.css`, `index.html` (343 dòng):

### 🔴 CRITICAL — Gây vỡ layout

| # | Component | Vấn đề | CSS location |
|---|---|---|---|
| C1 | **`.sbar-row`** (Snapshot bars) | `grid-template-columns: 160px 1fr 52px 90px` — cột tên cố định 160px, trên màn 375px tràn ra ngoài | `components.css:1811` |
| C2 | **`.general-subrow`** | `padding-left: 170px` hardcoded — trên mobile bị zero-width content area | `components.css:1901` |
| C3 | **`.detail-layout`** | `grid-template-columns: 240px 1fr` — không có media query, trên tablet (<900px) sidebar filter bị squeeze | `components.css:1921` |
| C4 | **`.perm-item`** | `grid-template-columns: 20px 1fr 80px 1fr` — 4 cột cố định, path column overflow ở 375px | `components.css:2409` |
| C5 | **`.history-timerange`** | `flex-wrap: wrap` nhưng `.timerange-custom` (2 date inputs) không có min-width — wrap sai trên 480px | `components.css:2467` |
| C6 | **`.detail-stat-bar` (Overview header)** | `padding: 20px 28px` — không có responsive padding, stat numbers `2rem` quá lớn trên 375px | `components.css:1705` |
| C7 | **`.perm-summary-bar`** | `padding: 16px 24px` — `perm-summary-num` font-size `1.8rem` tràn trên 375px khi có 4+ items | `components.css:2345` |

---

### 🟡 MODERATE — UI degraded nhưng không vỡ

| # | Component | Vấn đề | CSS location |
|---|---|---|---|
| M1 | **`.timeline-header`** | Range buttons + expand button hàng ngang — trên <480px wrap thành 2 hàng nhưng không align đẹp | `layout.css:181` |
| M2 | **`.history-chart-body`** | `height: 340px` cố định — trên mobile `200px` sẽ đủ, nhưng hiện giữ nguyên làm card quá cao | `components.css:2721` |
| M3 | **`.user-filter-box`** | `width: 210px; max-height: 420px` — khi nhét vào `history-main-row` đã flex-column (từ layout.css) nhưng width không trở về 100% | `components.css:2855` |
| M4 | **`.chart-modal-box`** | `max-width: 1100px; height: min(80vh, 680px)` — trên mobile 375px modal chiếm toàn màn nhưng header text bị truncate | `components.css:2621` |
| M5 | **`.scan-summary-bar`** | `gap: 24px` — `.ssb-right` có `min-width: 200px`, trên 480px sẽ wrap nhưng `.ssb-left` và `.ssb-right` stack xấu | `components.css:1511` |
| M6 | **Tab bar `.detail-tabs`** | `white-space: nowrap` trên tab buttons, 3 tabs chia nhau row — ở 375px `📸 Latest Snapshot` bị cut | `components.css:1757` |
| M7 | **`.metrics-grid`** | `grid-template-columns: repeat(3, 1fr)` — không có breakpoint, tuy nhiên section này không render nữa (legacy) | `layout.css:149` |
| M8 | **`.hrange-btn`** | `padding: 5px 14px` — 6 nút trong 1 hàng trên 375px bị overflow, cần wrap hoặc shrink font | `components.css:2488` |

---

### 🟢 MINOR — Tinh chỉnh UX

| # | Component | Vấn đề | CSS location |
|---|---|---|---|
| N1 | **`.panel-header`** chart title | Expand button + range buttons có thể wrap sang hàng mới không đúng cách trên 560px narrow | `layout.css:181` |
| N2 | **`.perm-meta`** | `flex-wrap: wrap` đã có, nhưng `.perm-meta-dir` monospace path không truncate | `components.css:2330` |
| N3 | **`.stat-block`** header bar | Trên 960px (icon-only sidebar mode) margin-left của `page-stat-bar` bị chiếm bởi shrink | `components.css:545` |
| N4 | **`.header-top-row`** | `flex-wrap: wrap` có rồi nhưng khi 2 hàng, stat bar không có `width: 100%` → không chiếm full row | `layout.css:92` |
| N5 | **Canvas charts** | Không có `max-height` trên mobile — chart bị collapse nếu container quá nhỏ | N/A |

---

## Tasks

### Phase 1 — Critical Fixes (layout breaking)

- [ ] **T1.1** — Fix `sbar-row` responsive:
  ```css
  /* Thay cố định 160px bằng relative */
  .sbar-row { grid-template-columns: minmax(80px, 140px) 1fr 48px auto; }
  @media (max-width: 600px) {
    .sbar-row { grid-template-columns: minmax(70px, 100px) 1fr 44px auto; }
  }
  @media (max-width: 480px) {
    .sbar-row { grid-template-columns: 90px 1fr 40px; }
    .sbar-val  { display: none; } /* ẩn value col, giữ % */
  }
  ```
  → Verify: 375px → bar rows không tràn ngang

- [ ] **T1.2** — Fix `general-subrow` padding-left hardcode:
  ```css
  .general-subrow { padding-left: 90px; }  /* giữ nguyên desktop */
  @media (max-width: 600px) { .general-subrow { padding-left: 0; flex-wrap: wrap; } }
  ```
  → Verify: 375px → legend row hiện đúng dưới bar

- [ ] **T1.3** — Fix `detail-layout` sidebar filter:
  ```css
  @media (max-width: 900px) {
    .detail-layout { grid-template-columns: 1fr; }
    .filter-sidebar { position: static; max-height: none; }
  }
  ```
  → Verify: 900px → filter sidebar stack trên content

- [ ] **T1.4** — Fix `perm-item` 4-col grid mobile:
  ```css
  @media (max-width: 640px) {
    .perm-item {
      grid-template-columns: 20px 1fr;
      grid-template-rows: auto auto;
    }
    .perm-item-type  { grid-column: 2; }
    .perm-item-error { grid-column: 1 / -1; font-size: 0.68rem; }
  }
  ```
  → Verify: 375px → permission items không overflow ngang

- [ ] **T1.5** — Fix `history-timerange` date inputs mobile:
  ```css
  @media (max-width: 640px) {
    .history-timerange { flex-direction: column; align-items: flex-start; }
    .timerange-presets { flex-wrap: wrap; }
    .timerange-custom  { width: 100%; }
    .timerange-custom .date-input { flex: 1; min-width: 0; }
  }
  ```
  → Verify: 375px → date inputs stack, không overflow

- [ ] **T1.6** — Fix `detail-stat-bar` font scaling:
  ```css
  @media (max-width: 768px) {
    .stat-number { font-size: 1.4rem; }
    .detail-stat-bar { padding: 14px 16px; }
  }
  @media (max-width: 480px) {
    .stat-number { font-size: 1.1rem; }
    .detail-stat-bar {
      display: grid;
      grid-template-columns: 1fr 1fr;
      padding: 10px 12px;
      gap: 8px;
    }
    .stat-divider { display: none; }
  }
  ```
  → Verify: 375px → 4 stats hiện dạng 2x2 grid, không truncate

- [ ] **T1.7** — Fix `perm-summary-bar` font:
  ```css
  @media (max-width: 640px) {
    .perm-summary-num { font-size: 1.3rem; }
    .perm-summary-bar { padding: 12px 16px; }
  }
  @media (max-width: 480px) {
    .perm-summary-bar { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .stat-divider { display: none; }
  }
  ```
  → Verify: 375px → perm stats không tràn

---

### Phase 2 — Moderate Fixes (UX degraded)

- [ ] **T2.1** — Fix `user-filter-box` width khi stack:
  ```css
  @media (max-width: 900px) {
    .user-filter-box {
      width: 100%;
      max-height: 200px;
      align-self: stretch;
    }
    .user-filter-list { max-height: 120px; }
  }
  ```
  → Verify: 900px → filter box chiếm full width trên chart row

- [ ] **T2.2** — Fix `detail-tabs` mobile text truncate:
  ```css
  @media (max-width: 640px) {
    .detail-tab-btn { font-size: 0.74rem; padding: 7px 10px; }
  }
  @media (max-width: 480px) {
    .detail-tabs { overflow-x: auto; flex-wrap: nowrap; padding-bottom: 8px; }
    .detail-tab-btn { white-space: nowrap; flex-shrink: 0; }
  }
  ```
  → Verify: 375px → tabs scrollable ngang horizontal, không bị cut

- [ ] **T2.3** — Fix `chart-modal-box` mobile:
  ```css
  @media (max-width: 640px) {
    .chart-modal-overlay { padding: 0; align-items: flex-end; }
    .chart-modal-box {
      border-radius: 16px 16px 0 0;
      height: min(85vh, 600px);
      max-width: 100%;
    }
  }
  ```
  → Verify: 375px → modal sheet từ bottom, không chiếm toàn màn hình

- [ ] **T2.4** — Fix `hrange-btn` wrap trên mobile:
  ```css
  @media (max-width: 500px) {
    .timerange-presets { flex-wrap: wrap; gap: 4px; }
    .hrange-btn { padding: 4px 10px; font-size: 0.72rem; }
  }
  ```
  → Verify: 375px → 6 preset buttons wrap sang 2 hàng đẹp

- [ ] **T2.5** — Fix `history-chart-body` height mobile:
  ```css
  @media (max-width: 640px) {
    .history-chart-body { height: 220px; }
  }
  @media (max-width: 480px) {
    .history-chart-body { height: 180px; }
  }
  ```
  → Verify: 375px → chart card height không quá lớn, scroll ổn

- [ ] **T2.6** — Fix `scan-summary-bar` mobile:
  ```css
  @media (max-width: 640px) {
    .scan-summary-bar { flex-direction: column; gap: 10px; }
    .ssb-right { width: 100%; min-width: 0; }
  }
  ```
  → Verify: 375px → scan bar stack dọc, không tràn

---

### Phase 3 — Minor Polish

- [ ] **T3.1** — Fix `header-top-row` stat bar full-width khi wrap:
  ```css
  @media (max-width: 768px) {
    .page-stat-bar { width: 100%; }
  }
  ```

- [ ] **T3.2** — Fix `perm-meta-dir` path truncation:
  ```css
  .perm-meta-dir {
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (max-width: 640px) { .perm-meta-dir { max-width: 180px; } }
  ```

- [ ] **T3.3** — Fix `timeline-header` button wrap mobile:
  ```css
  @media (max-width: 560px) {
    .timeline-header { flex-wrap: wrap; }
    .chart-range-btns { flex-wrap: wrap; gap: 3px; }
    .range-btn { font-size: 0.68rem; padding: 3px 7px; }
  }
  ```

- [ ] **T3.4** — Fix canvas min-height mobile:
  ```css
  @media (max-width: 640px) {
    .canvas-wrapper { min-height: 180px; }
    .large-span .canvas-wrapper { min-height: 220px; }
  }
  ```

---

### Phase X — Verification Checklist

- [ ] Chrome DevTools Responsive tại **1440px** — không có horizontal scroll, tất cả visible
- [ ] **1024px** — chart grid 1-col, sidebar icon-only, stat bar đúng
- [ ] **768px** — snapshot bars không tràn, detail-stat-bar font nhỏ lại
- [ ] **640px** — sidebar hidden, hamburger visible, tabs scrollable, perm items 2-col
- [ ] **375px (iPhone SE)** — ZERO horizontal overflow, tất cả text readable, không bị cut
- [ ] **Landscape 568px** — history timerange wraps đẹp, chart heights hợp lý
- [ ] Check light mode tại mỗi breakpoint — tất cả vẫn nhìn được
- [ ] Check chart modal ở 375px — bottom sheet behavior

---

## Notes

> [!NOTE]
> Tất cả fixes nên được thêm vào **cuối** `css/components.css` (hoặc `css/layout.css` cho layout stuff) trong một block **`/* ── RESPONSIVE FIXES ──*/`** riêng, tránh chỉnh sửa inline vào CSS hiện có để dễ review.

> [!WARNING]
> Component `metrics-grid` (3-col) hiện dùng legacy nên **không** cần fix. Chỉ fix những gì thực sự render.

> [!TIP]
> Fix theo thứ tự: **C1 → C2 → C3 → C4 → C5 → C6 → C7** trước, sau đó Phase 2. Phase 3 là polish cuối cùng.
