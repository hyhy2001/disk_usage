# Dashboard Improvements: Responsive Layout + localStorage + Formatter Refactor

> **Project type:** WEB (Vanilla HTML/CSS/JS)
> **Agent:** `frontend-specialist`
> **Skill:** `frontend-design`, `clean-code`
> **Created:** 2026-03-21

---

## Goal

Ba cải thiện độc lập trên dashboard StorageOS:

1. **Responsive layout** — sidebar + main content luôn nằm gọn trong viewport dù resize bất kỳ
2. **Persist filter state** — time range, user selection, scale toggles lưu vào `localStorage` và khôi phục khi reload
3. **Formatter consolidation** — gộp 4 hàm format bytes rải rác thành 1 module `js/formatters.js`

---

## Affected Files

| File | Thay đổi |
|---|---|
| `css/layout.css` | Responsive breakpoints, sidebar collapse, fluid grid |
| `css/components.css` | Chart containers, panel min-widths, overflow rules |
| `index.html` | Thêm hamburger button cho mobile sidebar |
| `js/formatters.js` | **Tạo mới** — utility module duy nhất cho byte formatting |
| `js/chartManager.js` | Import từ formatters.js, xóa 3 hàm local |
| `js/detailRenderer.js` | Import từ formatters.js, xóa fmt/fmtDate local |
| `js/dataFetcher.js` | Import từ formatters.js, xóa fmtBytes local |
| `js/filterStorage.js` | **Tạo mới** — đọc/ghi filter state vào localStorage |

---

## Tasks

### Phase 1 — Formatter Consolidation

- [x] **T1.1** — Tạo `js/formatters.js`: export fmt, smartFmt, smartFmtTick, pickUnit, fmtDate
- [x] **T1.2** — Update `js/chartManager.js`: import + xóa 3 hàm local (smartFmt, smartFmtTick, pickUnit)
- [x] **T1.3** — Update `js/detailRenderer.js`: import + xóa fmt, fmtDate local
- [x] **T1.4** — Update `js/dataFetcher.js`: import + xóa fmtBytes local

### Phase 2 — localStorage Filter Persistence

- [x] **T2.1** — Tạo `js/filterStorage.js`: saveFilters(state), loadFilters()
- [x] **T2.2** — Hook disk selection (`dataFetcher.js`): save + restore activeDisk
- [x] **T2.3** — Hook page navigation (`router.js`): save + restore activePage
- [x] **T2.4** — Hook filter state (`detailRenderer.js`): save date/users on applyFilters, restore on init
- [x] **T2.5** — Hook tab switching (`detailRenderer.js`): save + restore activeTab

### Phase 3 — Responsive Layout

- [x] **T3.1** — Fix overflow root: `.app-container { overflow: hidden }`, `.main-content { overflow-y: auto; min-width: 0 }`
- [x] **T3.2** — Sidebar collapse: 900px → icon-only (56px), 640px → hidden + overlay
- [x] **T3.3** — Hamburger button: thêm vào `index.html`, toggle `.open` class
- [x] **T3.4** — Chart grid: 1100px → `grid-template-columns: 1fr` (stack dọc)
- [x] **T3.5** — History tab: 900px → `flex-direction: column` cho main-row + charts-row
- [x] **T3.6** — Header stat bar: 768px → `flex-wrap: wrap`, 480px → 2x2 grid

### Phase X — Verification

- [x] DevTools resize: 1440 / 1024 / 768 / 375px — không overflow ngang
- [x] F5 sau filter → disk, page, tab, date range, users còn nguyên
- [x] Charts hiển thị đúng units sau formatter refactor
- [x] No console errors
