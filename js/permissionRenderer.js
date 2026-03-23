// permissionRenderer.js — Renders Permission Issues tab
// Shows permission issues per disk. Renders a filterable, paginated list.
// All pagination and filtering is done client-side (no extra API calls).

import { fmtDateSec as fmtDate } from './formatters.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const PERM_PAGE = 100;

// ── Module state ──────────────────────────────────────────────────────────────
let _allItems    = [];        // full flat list from API (never mutated after load)
let _permPage    = 1;
let _activeUsers = new Set(); // when empty = show all
let _pathQuery   = '';

// ── Icons ─────────────────────────────────────────────────────────────────────
const TYPE_ICON = {
    directory: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    file:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`,
};

function escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Client-side filter ────────────────────────────────────────────────────────
function _filtered() {
    return _allItems.filter(it => {
        const userOk = _activeUsers.size === 0 || _activeUsers.has(it.user ?? '');
        const pathOk = !_pathQuery || (it.path ?? '').toLowerCase().includes(_pathQuery);
        return userOk && pathOk;
    });
}

function _userSummary() {
    const s = {};
    for (const it of _allItems) {
        const u = it.user ?? '__unknown__';
        s[u] = (s[u] ?? 0) + 1;
    }
    return s;
}

// ── Pagination widget ─────────────────────────────────────────────────────────
function renderPagination(current, total) {
    if (total <= 1) return '';
    const delta = 2;
    const range = [];
    for (let i = Math.max(1, current - delta); i <= Math.min(total, current + delta); i++) range.push(i);
    const b = [];
    b.push(`<button class="ud-page-btn${current===1?' disabled':''}" data-page="${current-1}" aria-label="Previous"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>`);
    if (range[0] > 1) { b.push(`<button class="ud-page-btn" data-page="1">1</button>`); if (range[0]>2) b.push(`<span class="ud-page-ellipsis">…</span>`); }
    range.forEach(p => b.push(`<button class="ud-page-btn${p===current?' active':''}" data-page="${p}">${p}</button>`));
    if (range[range.length-1] < total) { if (range[range.length-1]<total-1) b.push(`<span class="ud-page-ellipsis">…</span>`); b.push(`<button class="ud-page-btn" data-page="${total}">${total}</button>`); }
    b.push(`<button class="ud-page-btn${current===total?' disabled':''}" data-page="${current+1}" aria-label="Next"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>`);
    return `<div class="ud-pagination perm-pagination" id="perm-pagination">${b.join('')}</div>`;
}

// ── Row renderer ──────────────────────────────────────────────────────────────
function renderItem(item) {
    const icon  = TYPE_ICON[item.type] ?? TYPE_ICON.file;
    const isUnk = item.user === '__unknown__';
    const badge = isUnk
        ? `<span class="perm-user-badge perm-unk">unknown</span>`
        : `<span class="perm-user-badge">${escHtml(item.user)}</span>`;
    return `<div class="perm-item">
        <span class="perm-item-icon">${icon}</span>
        ${badge}
        <span class="perm-item-path" title="${escHtml(item.path)}">${escHtml(item.path)}</span>
        <span class="perm-item-type">${escHtml(item.type ?? '')}</span>
        <span class="perm-item-error">${escHtml(item.error ?? '')}</span>
    </div>`;
}

// ── Re-render list + pagination (after filter/page change) ────────────────────
function _update() {
    const body = document.getElementById('permissions-body');
    if (!body) return;

    const visible    = _filtered();
    const totalPages = Math.max(1, Math.ceil(visible.length / PERM_PAGE));
    if (_permPage > totalPages) _permPage = totalPages;

    const start = (_permPage - 1) * PERM_PAGE;
    const page  = visible.slice(start, start + PERM_PAGE);

    const list  = body.querySelector('#perm-flat-list');
    const badge = body.querySelector('#perm-total-badge');
    const oldPg = body.querySelector('.perm-pagination');

    if (list) list.innerHTML = page.length
        ? page.map(renderItem).join('')
        : '<div class="perm-empty-filter">No items match current filters.</div>';

    if (badge) badge.textContent = `Page ${_permPage} of ${totalPages} · ${visible.length.toLocaleString()} shown`;

    if (oldPg) {
        oldPg.outerHTML = renderPagination(_permPage, totalPages);
        _attachPagination(body);
    }
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function renderFilterSidebar(userSum) {
    const entries = Object.entries(userSum).sort(([a], [b]) => {
        if (a === '__unknown__') return 1;
        if (b === '__unknown__') return -1;
        return a.localeCompare(b);
    });
    const items = entries.map(([user, count]) => {
        const sel   = _activeUsers.size === 0 || _activeUsers.has(user);
        const label = user === '__unknown__' ? '<span style="opacity:.7">unknown</span>' : escHtml(user);
        return `<div class="user-filter-item${sel?' selected':''}" data-key="${escHtml(user)}" onclick="window._permToggle(this)">
            <span class="user-filter-check">${sel?'✓':''}</span>
            <span class="user-filter-name">${label}</span>
            <span class="result-count" style="font-size:.65rem;padding:1px 5px">${count}</span>
        </div>`;
    }).join('');
    return `<div class="glass-panel user-filter-box">
        <div class="user-filter-header">
            <span class="user-filter-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Users</span>
            <span class="user-filter-count" id="perm-filter-count">${_activeUsers.size === 0 ? entries.length : _activeUsers.size} selected</span>
        </div>
        <div class="perm-filter-searches">
            <input type="text" id="perm-user-search" class="user-filter-search" placeholder="Search user…" oninput="window._permUserSearch(this.value)">
            <input type="text" id="perm-path-search" class="user-filter-search" placeholder="Filter paths…" oninput="window._permPathSearch(this.value)">
        </div>
        <div class="user-filter-list" id="perm-filter-list">${items}</div>
        <div class="user-filter-footer">
            <button class="user-bar-btn" onclick="window._permSelectAll()">All</button>
            <button class="user-bar-btn" onclick="window._permClearAll()">Clear</button>
        </div>
    </div>`;
}

// ── Initial full render ───────────────────────────────────────────────────────
function renderPermissions(data) {
    const body = document.getElementById('permissions-body');
    if (!body) return;

    if (!data || !data.items) {
        body.innerHTML = `<div class="empty-state">
            <div class="empty-state-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg></div>
            <h3>No Permission Data</h3>
            <p>No permission issues file found for this disk.</p>
        </div>`;
        return;
    }

    _allItems    = data.items;
    _permPage    = 1;
    _activeUsers = new Set();  // empty = all selected
    _pathQuery   = '';

    const userSum    = _userSummary();
    const total      = _allItems.length;
    const totalPages = Math.max(1, Math.ceil(total / PERM_PAGE));
    const numUsers   = Object.keys(userSum).filter(u => u !== '__unknown__').length;
    const numUnk     = userSum['__unknown__'] ?? 0;
    const pageItems  = _allItems.slice(0, PERM_PAGE);

    body.innerHTML = `
        <div class="perm-meta">
            <span class="perm-meta-date"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${fmtDate(data.date)}</span>
            <span class="perm-meta-dir"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> ${escHtml(data.directory ?? '—')}</span>
            <span class="result-count" id="perm-total-badge">Page 1 of ${totalPages} · ${total.toLocaleString()} shown</span>
        </div>
        <div class="perm-summary-bar glass-panel">
            <div class="perm-summary-item"><span class="perm-summary-num">${numUsers}</span><span class="perm-summary-label">Users affected</span></div>
            <div class="stat-divider"></div>
            <div class="perm-summary-item"><span class="perm-summary-num">${total - numUnk}</span><span class="perm-summary-label">User inaccessible items</span></div>
            <div class="stat-divider"></div>
            <div class="perm-summary-item"><span class="perm-summary-num">${numUnk}</span><span class="perm-summary-label">Unknown items</span></div>
        </div>
        <div class="history-main-row">
            ${renderFilterSidebar(userSum)}
            <div class="history-content">
                <div class="perm-flat-list glass-panel" id="perm-flat-list">
                    ${pageItems.map(renderItem).join('')}
                </div>
                ${renderPagination(1, totalPages)}
            </div>
        </div>`;

    _attachPagination(body);
}

// ── Pagination clicks ─────────────────────────────────────────────────────────
function _attachPagination(root) {
    const pg = root.querySelector('.perm-pagination');
    if (!pg) return;
    pg.addEventListener('click', e => {
        const btn = e.target.closest('.ud-page-btn');
        if (!btn || btn.classList.contains('disabled') || btn.classList.contains('active')) return;
        const p = parseInt(btn.dataset.page, 10);
        const max = Math.max(1, Math.ceil(_filtered().length / PERM_PAGE));
        if (!isNaN(p) && p >= 1 && p <= max) { _permPage = p; _update(); }
    });
}

// ── Filter callbacks (inline onclick) ─────────────────────────────────────────
window._permToggle = function(el) {
    el.classList.toggle('selected');
    const chk = el.querySelector('.user-filter-check');
    const key = el.dataset.key;
    if (el.classList.contains('selected')) { _activeUsers.add(key);    if (chk) chk.textContent = '✓'; }
    else                                   { _activeUsers.delete(key); if (chk) chk.textContent = ''; }
    document.getElementById('perm-filter-count').textContent = `${_activeUsers.size} selected`;
    _permPage = 1; _update();
};

window._permSelectAll = function() {
    const userSum = _userSummary();
    _activeUsers  = new Set();  // empty = all
    document.querySelectorAll('#perm-filter-list .user-filter-item').forEach(el => {
        el.classList.add('selected');
        const chk = el.querySelector('.user-filter-check'); if (chk) chk.textContent = '✓';
    });
    document.getElementById('perm-filter-count').textContent = `${Object.keys(userSum).length} selected`;
    _permPage = 1; _update();
};

window._permClearAll = function() {
    _activeUsers = new Set(['__NONE__']);  // special sentinel = show nothing
    document.querySelectorAll('#perm-filter-list .user-filter-item').forEach(el => {
        el.classList.remove('selected');
        const chk = el.querySelector('.user-filter-check'); if (chk) chk.textContent = '';
    });
    document.getElementById('perm-filter-count').textContent = '0 selected';
    _permPage = 1; _update();
};

window._permUserSearch = function(q) {
    const lq = q.toLowerCase();
    document.querySelectorAll('#perm-filter-list .user-filter-item').forEach(el => {
        el.style.display = (el.dataset.key || '').toLowerCase().includes(lq) ? '' : 'none';
    });
};

window._permPathSearch = function(val) {
    _pathQuery = val.toLowerCase(); _permPage = 1; _update();
};

// ── Entry point ───────────────────────────────────────────────────────────────
// dataFetcher.js calls api.php?dir=p|path (pipe-prefix, WAF-safe, base64 response)
// and dispatches permissionsLoaded with the full data spread into e.detail.
// We use that data directly — no second API call.
document.addEventListener('permissionsLoaded', (e) => {
    const detail = e.detail ?? {};
    // detail = { diskDir, date, directory, total, items } or just { diskDir }
    renderPermissions(detail.items != null ? detail : null);
});

export { renderPermissions };
