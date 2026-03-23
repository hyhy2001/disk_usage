// permissionRenderer.js — Renders Permission Issues tab (flat paginated format)

import { fmtDateSec as fmtDate } from './formatters.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const PERM_PAGE = 100;  // items per page

// ── State ─────────────────────────────────────────────────────────────────────
let _permPage       = 1;
let _permTotalPages = 1;
let _permTotal      = 0;
let _permDiskDir    = null;
let _activeUsers    = new Set();   // selected user filters
let _pathQuery      = '';

// ── Icons ─────────────────────────────────────────────────────────────────────
const TYPE_ICON = {
    directory: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    file:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`,
};

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Pagination widget (reused from userDetailRenderer pattern) ─────────────────
function renderPagination(current, total, id = 'perm-pagination') {
    if (total <= 1) return '';
    const delta   = 2;
    const range   = [];
    for (let i = Math.max(1, current - delta); i <= Math.min(total, current + delta); i++) range.push(i);

    const btns = [];
    btns.push(`<button class="ud-page-btn${current === 1 ? ' disabled' : ''}" data-page="${current - 1}" aria-label="Previous">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>`);

    if (range[0] > 1) {
        btns.push(`<button class="ud-page-btn" data-page="1">1</button>`);
        if (range[0] > 2) btns.push(`<span class="ud-page-ellipsis">…</span>`);
    }
    range.forEach(p => btns.push(
        `<button class="ud-page-btn${p === current ? ' active' : ''}" data-page="${p}">${p}</button>`
    ));
    if (range[range.length - 1] < total) {
        if (range[range.length - 1] < total - 1) btns.push(`<span class="ud-page-ellipsis">…</span>`);
        btns.push(`<button class="ud-page-btn" data-page="${total}">${total}</button>`);
    }
    btns.push(`<button class="ud-page-btn${current === total ? ' disabled' : ''}" data-page="${current + 1}" aria-label="Next">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>`);

    return `<div class="ud-pagination perm-pagination" id="${id}">${btns.join('')}</div>`;
}

// ── Render a single flat item row ─────────────────────────────────────────────
function renderItem(item) {
    const icon    = TYPE_ICON[item.type] ?? TYPE_ICON.file;
    const isUnk   = item.user === '__unknown__';
    const userBadge = isUnk
        ? `<span class="perm-user-badge perm-unk">unknown</span>`
        : `<span class="perm-user-badge">${escHtml(item.user)}</span>`;
    return `
        <div class="perm-item">
            <span class="perm-item-icon">${icon}</span>
            ${userBadge}
            <span class="perm-item-path" title="${escHtml(item.path)}">${escHtml(item.path)}</span>
            <span class="perm-item-type">${escHtml(item.type ?? '')}</span>
            <span class="perm-item-error">${escHtml(item.error ?? '')}</span>
        </div>`;
}

// ── Fetch one page from the API ───────────────────────────────────────────────
async function fetchPermPage(diskDir, offset = 0, userFilter = [], pathQ = '') {
    const params = new URLSearchParams({
        dir:    diskDir,
        offset,
        limit:  PERM_PAGE,
    });
    // Pass active user filter to... actually we filter client-side since
    // user_summary tells us counts; backend returns ALL items for selected page.
    // For server-side user filtering we'd need more API params — keep it simple.
    const res  = await fetch(`permission_api.php?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.status !== 'success') throw new Error(json.message || 'API error');
    return json.data;
}

// ── Filter sidebar ────────────────────────────────────────────────────────────
function renderFilterSidebar(userSummary) {
    const entries = Object.entries(userSummary).sort(([a], [b]) => {
        if (a === '__unknown__') return 1;
        if (b === '__unknown__') return -1;
        return a.localeCompare(b);
    });

    const items = entries.map(([user, count]) => {
        const sel     = _activeUsers.has(user);
        const label   = user === '__unknown__' ? '<span style="opacity:.7">unknown</span>' : escHtml(user);
        return `<div class="user-filter-item${sel ? ' selected' : ''}" data-key="${escHtml(user)}"
                    onclick="window._permToggle(this)">
            <span class="user-filter-check">${sel ? '✓' : ''}</span>
            <span class="user-filter-name">${label}</span>
            <span class="result-count" style="font-size:.65rem;padding:1px 5px">${count}</span>
        </div>`;
    }).join('');

    return `
        <div class="glass-panel user-filter-box">
            <div class="user-filter-header">
                <span class="user-filter-title">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    Users
                </span>
                <span class="user-filter-count" id="perm-filter-count">${_activeUsers.size} selected</span>
            </div>
            <div class="perm-filter-searches">
                <input type="text" id="perm-user-search" class="user-filter-search"
                    placeholder="Search user…"
                    oninput="window._permUserSearch(this.value)">
                <input type="text" id="perm-path-search" class="user-filter-search"
                    placeholder="Filter paths…"
                    oninput="window._permPathSearch(this.value)">
            </div>
            <div class="user-filter-list" id="perm-filter-list">${items}</div>
            <div class="user-filter-footer">
                <button class="user-bar-btn" onclick="window._permSelectAll()">All</button>
                <button class="user-bar-btn" onclick="window._permClearAll()">Clear</button>
            </div>
        </div>`;
}

// ── Render items honoring active filters ──────────────────────────────────────
function renderItemList(items) {
    const filtered = items.filter(it => {
        const userOk  = _activeUsers.size === 0 || _activeUsers.has(it.user);
        const pathOk  = !_pathQuery || it.path.toLowerCase().includes(_pathQuery);
        return userOk && pathOk;
    });
    if (!filtered.length) return '<div class="perm-empty-filter">No items match current filters.</div>';
    return filtered.map(renderItem).join('');
}

// ── Main render ───────────────────────────────────────────────────────────────
function renderPermissions(data) {
    const body = document.getElementById('permissions-body');
    if (!body) return;

    if (!data) {
        body.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/>
                    </svg>
                </div>
                <h3>No Permission Data</h3>
                <p>No permission issues file found for this disk.</p>
            </div>`;
        return;
    }

    const total      = data.total       ?? 0;
    const items      = data.items       ?? [];
    const userSum    = data.user_summary ?? {};
    const dateStr    = fmtDate(data.date);
    const dir        = data.directory   ?? '—';
    const offset     = data.offset      ?? 0;

    // Init state
    _permTotal      = total;
    _permTotalPages = Math.max(1, Math.ceil(total / PERM_PAGE));
    _permPage       = Math.floor(offset / PERM_PAGE) + 1;

    // Init active users (all by default on first load)
    if (_activeUsers.size === 0) {
        _activeUsers = new Set(Object.keys(userSum));
    }

    const numUsers  = Object.keys(userSum).filter(u => u !== '__unknown__').length;
    const numUnk    = userSum['__unknown__'] ?? 0;
    const badge     = `Page ${_permPage} of ${_permTotalPages} · ${total.toLocaleString()} total`;

    body.innerHTML = `
        <div class="perm-meta">
            <span class="perm-meta-date"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${dateStr}</span>
            <span class="perm-meta-dir"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> ${escHtml(dir)}</span>
            <span class="result-count" id="perm-total-badge">${badge}</span>
        </div>

        <div class="perm-summary-bar glass-panel">
            <div class="perm-summary-item">
                <span class="perm-summary-num">${numUsers}</span>
                <span class="perm-summary-label">Users affected</span>
            </div>
            <div class="stat-divider"></div>
            <div class="perm-summary-item">
                <span class="perm-summary-num">${total - numUnk}</span>
                <span class="perm-summary-label">User inaccessible items</span>
            </div>
            <div class="stat-divider"></div>
            <div class="perm-summary-item">
                <span class="perm-summary-num">${numUnk}</span>
                <span class="perm-summary-label">Unknown items</span>
            </div>
        </div>

        <div class="history-main-row">
            <!-- Left: Filter sidebar -->
            ${renderFilterSidebar(userSum)}

            <!-- Right: Flat item list + pagination -->
            <div class="history-content">
                <div class="perm-flat-list glass-panel" id="perm-flat-list">
                    ${renderItemList(items)}
                </div>
                ${renderPagination(_permPage, _permTotalPages)}
            </div>
        </div>`;

    _attachPaginationEvents(body);
}

// ── Pagination event wiring ───────────────────────────────────────────────────
function _attachPaginationEvents(root) {
    const pg = root.querySelector('.perm-pagination');
    if (!pg) return;
    pg.addEventListener('click', e => {
        const btn = e.target.closest('.ud-page-btn');
        if (!btn || btn.classList.contains('disabled') || btn.classList.contains('active')) return;
        const page = parseInt(btn.dataset.page, 10);
        if (!isNaN(page) && page >= 1 && page <= _permTotalPages) _goToPage(root, page);
    });
}

async function _goToPage(root, page) {
    if (!_permDiskDir) return;
    const list  = root.querySelector('#perm-flat-list');
    const pager = root.querySelector('.perm-pagination');
    const badge = root.querySelector('#perm-total-badge');
    if (list)  list.style.opacity  = '0.4';
    if (pager) pager.style.pointerEvents = 'none';

    try {
        const offset = (page - 1) * PERM_PAGE;
        const data   = await fetchPermPage(_permDiskDir, offset);
        _permPage    = page;

        if (list)  { list.innerHTML = renderItemList(data.items ?? []); list.style.opacity = ''; }
        if (badge) badge.textContent = `Page ${page} of ${_permTotalPages} · ${_permTotal.toLocaleString()} total`;

        // Replace pagination
        const oldPg = root.querySelector('.perm-pagination');
        if (oldPg)  {
            oldPg.outerHTML = renderPagination(page, _permTotalPages);
            _attachPaginationEvents(root);
        }
    } catch (err) {
        if (list)  list.style.opacity = '';
        if (pager) pager.style.pointerEvents = '';
    }
}

// ── Filter callbacks (called from inline onclick) ─────────────────────────────
window._permToggle = function(el) {
    el.classList.toggle('selected');
    const chk = el.querySelector('.user-filter-check');
    const key = el.dataset.key;
    if (el.classList.contains('selected')) { _activeUsers.add(key); if (chk) chk.textContent = '✓'; }
    else { _activeUsers.delete(key); if (chk) chk.textContent = ''; }
    document.getElementById('perm-filter-count').textContent = `${_activeUsers.size} selected`;
    _refilter();
};

window._permSelectAll = function() {
    document.querySelectorAll('#perm-filter-list .user-filter-item').forEach(el => {
        el.classList.add('selected');
        const chk = el.querySelector('.user-filter-check'); if (chk) chk.textContent = '✓';
        _activeUsers.add(el.dataset.key);
    });
    document.getElementById('perm-filter-count').textContent = `${_activeUsers.size} selected`;
    _refilter();
};

window._permClearAll = function() {
    document.querySelectorAll('#perm-filter-list .user-filter-item').forEach(el => {
        el.classList.remove('selected');
        const chk = el.querySelector('.user-filter-check'); if (chk) chk.textContent = '';
    });
    _activeUsers.clear();
    document.getElementById('perm-filter-count').textContent = '0 selected';
    _refilter();
};

window._permUserSearch = function(q) {
    const lq = q.toLowerCase();
    document.querySelectorAll('#perm-filter-list .user-filter-item').forEach(el => {
        el.style.display = (el.dataset.key || '').toLowerCase().includes(lq) ? '' : 'none';
    });
};

window._permPathSearch = function(val) {
    _pathQuery = val.toLowerCase();
    _refilter();
};

function _refilter() {
    const list = document.getElementById('perm-flat-list');
    if (!list) return;
    // Re-render the cached items with new filter
    // We store the raw items on the list element as data
    const rawItems = list._rawItems;
    if (rawItems) list.innerHTML = renderItemList(rawItems);
}

// ── Entry point ───────────────────────────────────────────────────────────────
document.addEventListener('permissionsLoaded', async (e) => {
    const diskDir = e.detail?.diskDir;
    _permDiskDir  = diskDir;
    _permPage     = 1;
    _activeUsers  = new Set();
    _pathQuery    = '';

    if (!diskDir) { renderPermissions(null); return; }

    try {
        const data = await fetchPermPage(diskDir, 0);
        // Store raw items on the list for client-side refilter
        renderPermissions(data);
        const list = document.getElementById('perm-flat-list');
        if (list) list._rawItems = data.items ?? [];
    } catch {
        renderPermissions(null);
    }
});

export { renderPermissions };
