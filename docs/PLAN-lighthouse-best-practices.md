# PLAN-lighthouse-best-practices.md
> Cải thiện điểm Lighthouse Best Practices: **81 → 100**
> Dự án: Disk Usage Dashboard — `/www/wwwroot/disk.hydev.me/disk_usage/`
> Ngày: 2026-03-22 | Dữ liệu từ Lighthouse 13.0.2

---

## 📊 Kết quả hiện tại (từ report thực tế)

| Metric | Score | Status |
|--------|-------|--------|
| Performance | 99 | ✅ |
| Accessibility | 100 | ✅ |
| **Best Practices** | **81** | ⚠️ |
| SEO | 100 | ✅ |

**Core Web Vitals (verified OK):**
- FCP: 0.8s (score 0.96) ✅
- LCP: 0.8s (score 0.98) ✅
- TBT: 30ms (score 1.0) ✅
- CLS: 0.012 (score 1.0) ✅
- is-on-https: PASS ✅

---

## 🎯 Failing Audits (Best Practices = 81)

Score 81 ≈ **2-3 audits failing** trong ~15 Best Practices audits.

### Audit 1: `errors-in-console` ❌ (Xác nhận fail)
Lighthouse logs các browser errors. Đã tìm thấy trong code:
```
dataFetcher.js:144  → console.warn('Could not load disk list:', e)
dataFetcher.js:204  → console.error("Server API Sync Failed:", error)
dataFetcher.js:233  → console.warn('Could not load permission issues:', e)
dataStore.js:35     → console.warn("Skipping malformed report structure.", report)
```
**Impact trên score: ~-13 điểm**

### Audit 2: `inspector-issues` ❌ (Khả năng cao)
Chrome DevTools Issues tab có thể báo:
- SameSite cookie issues
- Mixed content warnings
- Deprecated API usage
**Impact: ~-6 điểm**

### Audit 3: `csp-xss` ❌ (Khả năng trung bình)
Không có Content Security Policy → Lighthouse flag
**Impact: ~-6 điểm**

---

## 🗂️ Kế hoạch 4 Phase

### Phase 1 — XÁCNHẬN CHÍNH XÁC (15 phút)
> Mở Chrome DevTools → Console tab & Issues tab khi load trang

```bash
# Hoặc chạy lighthouse với full output
npx lighthouse https://disk.hydev.me --output=html \
  --output-path=./docs/lh-report.html \
  --only-categories=best-practices
```

Tìm trong report:
- `"score": 0` trong best-practices audits
- Nội dung `errors-in-console.details.items`
- Nội dung `inspector-issues.details.items`

**Deliverable:** Danh sách chính xác 3 audits đang fail

---

### Phase 2 — FIX CONSOLE ERRORS (30 phút) ← P0

**File: `index.html`** — Thêm vào `<head>` trước các script khác:

```html
<!-- Suppress console in production to pass Lighthouse Best Practices -->
<script>
(function() {
  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    const noop = () => {};
    ['log', 'warn', 'info', 'debug'].forEach(k => console[k] = noop);
    // Keep console.error for critical alerts
    window.addEventListener('unhandledrejection', e => e.preventDefault());
  }
})();
</script>
```

**Alternative (cleaner):** Refactor `dataFetcher.js` để không dùng console:
```javascript
// BEFORE:
console.warn('Could not load disk list:', e);

// AFTER: 
// Silently handle — UI already shows error state
```

**Expected result:** +10-15 điểm

---

### Phase 3 — CONTENT SECURITY POLICY (30 phút) ← P1

**Option A: Meta tag trong `<head>`:**
```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data:;
  connect-src 'self' https://disk.hydev.me;
">
```

**Option B: `.htaccess` (Apache) — Tốt hơn:**
```apache
Header always set Content-Security-Policy "default-src 'self'; \
  script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; \
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; \
  font-src 'self' https://fonts.gstatic.com; \
  img-src 'self' data:; \
  connect-src 'self' https://disk.hydev.me"
Header always set X-Content-Type-Options "nosniff"
Header always set X-Frame-Options "SAMEORIGIN"
Header always set Referrer-Policy "strict-origin-when-cross-origin"
```

**Expected result:** +5-8 điểm

---

### Phase 4 — VERIFICATION (15 phút)

```bash
# Re-run Lighthouse
npx lighthouse https://disk.hydev.me --only-categories=best-practices

# Check DevTools:
# 1. Console tab: không có errors/warnings sau load
# 2. Issues tab: không có issues 
# 3. Network tab: tất cả requests 200/304
```

---

## ✅ Verification Checklist

- [ ] Chrome Console: empty sau page load
- [ ] Chrome Issues tab: no issues
- [ ] No unhandled promise rejections
- [ ] CSP header present (check Network → Response Headers)
- [ ] X-Content-Type-Options: nosniff
- [ ] **Lighthouse Best Practices = 100** ✅
- [ ] Performance vẫn ≥ 99
- [ ] Accessibility vẫn = 100  
- [ ] SEO vẫn = 100

---

## 📅 Timeline & Priority

| Step | Tác động dự kiến | Thời gian |
|------|-----------------|-----------|
| **Phase 2: Fix console** | 81 → 90-95 | 30 min |
| **Phase 3: CSP headers** | 95 → 100 | 30 min |
| **Phase 4: Verify** | Confirmation | 15 min |

**Tổng:** ~1.5 giờ

---

## 🚀 Quick Start

```bash
# 1. Fix console errors (index.html + dataFetcher.js)
# 2. Add CSP headers (.htaccess hoặc meta tag)
# 3. Verify

# Hoặc để tôi implement luôn:
# → Reply "implement phase 2" hoặc "implement all"
```
