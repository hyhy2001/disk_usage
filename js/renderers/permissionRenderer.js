// permissionRenderer.js — Renders Permission Issues tab
// Server-side pagination + filtering: users, item_type, path search.

import { fmtDateSec as fmtDate } from '../utils/formatters.js';
import { downloadCsv, downloadZip, streamExportGzip, toCsv }   from '../utils/csvExport.js';
import { showProgressToast, updateProgressToast, closeProgressToast, showToast } from '../core/main.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const PERM_PAGE     = 100;
const SEARCH_DELAY = 350;  // debounce ms for path search

// ── Module state ──────────────────────────────────────────────────────────────
let _diskId          = null;    // active disk ID for API calls
let _permPage        = 1;
let _totalItems      = 0;       // total after all filters (from API)
let _userSummary     = {};      // unfiltered counts (from API)
let _pageItems       = [];      // items on current page only
let _activeUsers     = new Set(); // null=all, empty Set=none, else explicit set
let _itemType        = '';      // '' | 'file' | 'directory'
let _pathSearch      = '';      // server-side path substring filter
let _fetchInProgress = false;
let _abortCtrl       = null;
let _searchTimer     = null;    // debounce timer for path search
let _resizeTimer     = null;

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

// ── Pagination widget ─────────────────────────────────────────────────────────
function _renderPagination(current, total) {
    if (total <= 1) return '';
    const delta = 2;
    const range = [];
    for (let i = Math.max(1, current - delta); i <= Math.min(total, current + delta); i++) range.push(i);
    const b = [];
    b.push(`<button class="ud-page-btn${current===1?' disabled':''}" data-page="${current-1}" aria-label="Previous"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>`);
    if (range[0] > 1) { b.push(`<button class="ud-page-btn" data-page="1">1</button>`); if (range[0] > 2) b.push(`<span class="ud-page-ellipsis">…</span>`); }
    range.forEach(p => b.push(`<button class="ud-page-btn${p===current?' active':''}" data-page="${p}">${p}</button>`));
    if (range[range.length-1] < total) { if (range[range.length-1] < total-1) b.push(`<span class="ud-page-ellipsis">…</span>`); b.push(`<button class="ud-page-btn" data-page="${total}">${total}</button>`); }
    b.push(`<button class="ud-page-btn${current===total?' disabled':''}" data-page="${current+1}" aria-label="Next"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>`);
    return `<div class="ud-pagination perm-pagination" id="perm-pagination">${b.join('')}</div>`;
}

// ── Row renderer ──────────────────────────────────────────────────────────────
function _renderItem(item) {
    const icon  = TYPE_ICON[item.type] ?? TYPE_ICON.file;
    const isUnk = item.user === '__unknown__';
    const badge = isUnk
        ? `<span class="perm-user-badge perm-unk">unknown</span>`
        : `<span class="perm-user-badge">${escHtml(item.user)}</span>`;
    return `<div class="perm-item">
        <span class="perm-item-icon">${icon}</span>
        ${badge}
        <span class="perm-item-path" title="${escHtml(item.path)}" style="cursor: pointer;">${escHtml(item.path)}</span>
        <span class="perm-item-type">${escHtml(item.type ?? '')}</span>
        <span class="perm-item-error">${escHtml(item.error ?? '')}</span>
    </div>`;
}

// ── Re-render current page list (after fetch) ─────────────────────────────────
function _updateDisplay() {
    const body = document.getElementById('permissions-body');
    if (!body) return;

    const totalPages = Math.max(1, Math.ceil(_totalItems / PERM_PAGE));
    const list   = body.querySelector('#perm-flat-list');
    const badge  = body.querySelector('#perm-total-badge');
    const pgWrap = body.querySelector('#perm-pg-wrap');
    const content = body.querySelector('.history-content');
    const hasSelection = (_activeUsers === null) || (_activeUsers && _activeUsers.size > 0);

    if (content) {
        const oldHint = content.querySelector('#perm-select-user-hint');
        if (oldHint) oldHint.remove();
    }

    if (!hasSelection) {
        if (list) list.style.display = 'none';
        if (pgWrap) pgWrap.style.display = 'none';
        if (content) {
            const hint = document.createElement('div');
            hint.id = 'perm-select-user-hint';
            hint.className = 'perm-empty-filter glass-panel';
            hint.textContent = 'Select at least one user to view permission issues.';
            content.insertBefore(hint, content.firstChild);
        }
    } else {
        if (list) {
            list.style.display = '';
            list.innerHTML = _pageItems.length
                ? _pageItems.map(_renderItem).join('')
                : '<div class="perm-empty-filter">No items match current filters.</div>';
            list.scrollTop = 0;
        }
        if (pgWrap) pgWrap.style.display = '';
    }

    if (badge) badge.textContent = `Page ${_permPage} of ${totalPages} · ${_totalItems.toLocaleString()} items`;

    if (pgWrap && hasSelection) {
        pgWrap.innerHTML = _renderPagination(_permPage, totalPages);
        _attachPagination(pgWrap);
    }
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function _renderFilterSidebar(userSum) {
    const entries = Object.entries(userSum).sort(([a], [b]) => {
        if (a === '__unknown__') return 1;
        if (b === '__unknown__') return -1;
        return a.localeCompare(b);
    });
    const userItems = entries.map(([user, count]) => {
        const sel   = _activeUsers === null || _activeUsers.has(user);
        const label = user === '__unknown__' ? '<span style="opacity:.7">unknown</span>' : escHtml(user);
        return `<div class="user-filter-item${sel?' selected':''}" data-key="${escHtml(user)}" onclick="window._permToggle(this)">
            <span class="user-filter-check">${sel?'✓':''}</span>
            <span class="user-filter-name">${label}</span>
            <span class="result-count" style="font-size:.65rem;padding:1px 5px">${count}</span>
        </div>`;
    }).join('');

    const tb = (val, lbl) =>
        `<button class="perm-type-btn${_itemType===val?' active':''}" onclick="window._permSetType('${val}')">${lbl}</button>`;

    return `<div class="glass-panel user-filter-box">
        <div class="user-filter-header">
            <span class="user-filter-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg> Filters</span>
        </div>

        <div class="perm-filter-section">
            <div class="perm-filter-label">Item type</div>
            <div class="perm-type-group" id="perm-type-group">
                ${tb('','All')} ${tb('file','File')} ${tb('directory','Dir')}
            </div>
        </div>

        <div class="perm-filter-section">
            <div class="perm-filter-label">Path</div>
            <input type="text" id="perm-path-search" class="user-filter-search" placeholder="e.g. /var/log…" value="${escHtml(_pathSearch)}" oninput="window._permPathSearch(this.value)">
        </div>

        <div class="perm-filter-section">
            <div class="perm-filter-label">Users <span class="user-filter-count" id="perm-filter-count">${_activeUsers === null ? entries.length : _activeUsers.size} selected</span></div>
            <input type="text" id="perm-user-search" class="user-filter-search" placeholder="Search user…" oninput="window._permUserSearch(this.value)">
            <div class="user-filter-list" id="perm-filter-list">${userItems}</div>
            <div class="user-filter-footer">
                <button class="user-bar-btn" onclick="window._permSelectAll()">All</button>
                <button class="user-bar-btn" onclick="window._permClearAll()">Clear</button>
            </div>
        </div>
    </div>`;
}

// ── Server fetch ──────────────────────────────────────────────────────────────
async function _fetchPage(page) {
    if (!_diskId) return;

    if (_abortCtrl) _abortCtrl.abort();
    _abortCtrl       = new AbortController();
    _fetchInProgress = true;

    const offset = (page - 1) * PERM_PAGE;

    // null = all users (no filter); empty Set = no users selected = show nothing
    if (_activeUsers !== null && _activeUsers.size === 0) {
        _pageItems  = [];
        _totalItems = 0;
        _fetchInProgress = false;
        _updateDisplay();
        return;
    }

    const params = new URLSearchParams({ id: _diskId, type: 'permissions', offset: offset, limit: PERM_PAGE });
    if (_activeUsers !== null && _activeUsers.size > 0) params.set('users', [..._activeUsers].join(','));
    if (_itemType)   params.set('item_type', _itemType);
    if (_pathSearch) params.set('path', _pathSearch);
    const url = 'api.php?' + params.toString();

    const body   = document.getElementById('permissions-body');
    const list   = body ? body.querySelector('#perm-flat-list') : null;
    const pgWrap = body ? body.querySelector('#perm-pg-wrap')   : null;
    if (list)   list.style.opacity = '0.4';
    if (pgWrap) pgWrap.style.pointerEvents = 'none';

    try {
        const res  = await fetch(url, { signal: _abortCtrl.signal });
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); } catch { json = JSON.parse(atob(text)); }

        if (json?.status !== 'success') throw new Error(json?.message || 'API error');

        const data   = json.data;
        _pageItems   = data.items || [];
        _totalItems  = data.total || 0;
        _permPage    = page;
        if (data.user_summary) {
            _userSummary = data.user_summary;
            _refreshSidebar();
        }

        if (list)   list.style.opacity = '';
        if (pgWrap) pgWrap.style.pointerEvents = '';
        _updateDisplay();

    } catch (err) {
        if (err.name === 'AbortError') return;
        if (list) { list.style.opacity = ''; list.innerHTML = `<div class="perm-empty-filter">Failed to load: ${escHtml(err.message)}</div>`; }
        if (pgWrap) pgWrap.style.pointerEvents = '';
    } finally {
        _fetchInProgress = false;
    }
}

// ── Refresh sidebar user list (keeps type/path section intact) ────────────────
function _refreshSidebar() {
    const listEl = document.querySelector('#perm-filter-list');
    if (!listEl) return;
    const entries = Object.entries(_userSummary).sort(([a], [b]) => {
        if (a === '__unknown__') return 1;
        if (b === '__unknown__') return -1;
        return a.localeCompare(b);
    });
    listEl.innerHTML = entries.map(([user, count]) => {
        const sel   = _activeUsers === null || _activeUsers.has(user);
        const label = user === '__unknown__' ? '<span style="opacity:.7">unknown</span>' : escHtml(user);
        return `<div class="user-filter-item${sel?' selected':''}" data-key="${escHtml(user)}" onclick="window._permToggle(this)">
            <span class="user-filter-check">${sel?'✓':''}</span>
            <span class="user-filter-name">${label}</span>
            <span class="result-count" style="font-size:.65rem;padding:1px 5px">${count}</span>
        </div>`;
    }).join('');
    const countEl = document.getElementById('perm-filter-count');
    if (countEl) countEl.textContent = `${_activeUsers === null ? entries.length : _activeUsers.size} selected`;
}

// ── Initial full render (called once on permissionsLoaded) ────────────────────
function renderPermissions(data, diskId) {
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

    if (!body._hasCopyEvent) {
        body.addEventListener('click', e => {
            const pathEl = e.target.closest('.perm-item-path');
            if (pathEl) {
                const path = pathEl.getAttribute('title');
                if (path) {
                    navigator.clipboard.writeText(path).then(() => {
                        showToast('Path Copied', `Successfully copied to clipboard.`, 'success', 2500);
                    }).catch(err => {
                        showToast('Failed to copy', err.message, 'error', 2500);
                    });
                }
            }
        });
        body._hasCopyEvent = true;
    }

    // Reset all state
    _diskId      = diskId;
    _userSummary = data.user_summary || {};
    _permPage    = 1;
    _pathSearch  = '';
    _itemType    = '';

    // Default: select only first named user (not __unknown__)
    const sortedUsers = Object.keys(_userSummary).filter(u => u !== '__unknown__').sort();
    const firstUser   = sortedUsers.length > 0 ? sortedUsers[0] : null;
    _activeUsers = firstUser ? new Set([firstUser]) : new Set();

    _pageItems  = [];
    _totalItems = data.total || 0;

    const totalPages = Math.max(1, Math.ceil(_totalItems / PERM_PAGE));
    const numUsers   = Object.keys(_userSummary).filter(u => u !== '__unknown__').length;
    const numUnk     = _userSummary['__unknown__'] || 0;

    body.innerHTML = `
        <div class="perm-meta">
            <span class="perm-meta-date"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${fmtDate(data.date)}</span>
            <span class="perm-meta-dir"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> ${escHtml(data.directory || '—')}</span>
            <span class="result-count" id="perm-total-badge">Page 1 of ${totalPages} · ${_totalItems.toLocaleString()} items</span>
            <div class="perm-export-group">
                <button class="perm-export-btn" onclick="window._permExportFiltered()" data-tooltip="Download CSV — current filters applied">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Export Filtered
                </button>
                <button class="perm-export-btn" onclick="window._permExportAll()" data-tooltip="Download full permission report as CSV">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Export All
                </button>
            </div>
        </div>
        <div class="perm-summary-bar glass-panel">
            <div class="perm-summary-item"><span class="perm-summary-num">${numUsers}</span><span class="perm-summary-label">Users affected</span></div>
            <div class="stat-divider"></div>
            <div class="perm-summary-item"><span class="perm-summary-num">${_totalItems - numUnk}</span><span class="perm-summary-label">User inaccessible</span></div>
            <div class="stat-divider"></div>
            <div class="perm-summary-item"><span class="perm-summary-num">${numUnk}</span><span class="perm-summary-label">Unknown items</span></div>
        </div>
        <div class="history-main-row">
            ${_renderFilterSidebar(_userSummary)}
            <div class="history-content">
                <div class="perm-flat-list glass-panel" id="perm-flat-list">
                    <div class="perm-empty-filter" style="opacity:.5">Loading…</div>
                </div>
                <div id="perm-pg-wrap">${_renderPagination(1, totalPages)}</div>
            </div>
        </div>`;

    _attachPagination(body.querySelector('#perm-pg-wrap'));
    _fetchPage(1);

    if (!window._permResizeBound) {
        window.addEventListener('resize', function() {
            if (!_diskId) return;
            clearTimeout(_resizeTimer);
            _resizeTimer = setTimeout(function() {
                _fetchPage(1);
            }, 160);
        });
        window._permResizeBound = true;
    }
}

// ── Pagination click events ───────────────────────────────────────────────────
function _attachPagination(root) {
    if (!root) return;
    const pg = root.querySelector ? root.querySelector('.perm-pagination') : null;
    if (!pg) return;
    pg.addEventListener('click', e => {
        const btn = e.target.closest('.ud-page-btn');
        if (!btn || btn.classList.contains('disabled') || btn.classList.contains('active')) return;
        const p = parseInt(btn.dataset.page, 10);
        const totalPages = Math.max(1, Math.ceil(_totalItems / PERM_PAGE));
        if (!isNaN(p) && p >= 1 && p <= totalPages) _fetchPage(p);
    });
}

// ── Filter callbacks ──────────────────────────────────────────────────────────
window._permToggle = function(el) {
    const key = el.dataset.key;
    if (_activeUsers === null) {
        _activeUsers = new Set(Object.keys(_userSummary));
    }
    el.classList.toggle('selected');
    const chk = el.querySelector('.user-filter-check');
    if (el.classList.contains('selected')) {
        _activeUsers.add(key);
        if (chk) chk.textContent = '✓';
    } else {
        _activeUsers.delete(key);
        if (chk) chk.textContent = '';
    }
    const countEl = document.getElementById('perm-filter-count');
    if (countEl) countEl.textContent = `${_activeUsers.size} selected`;
    _permPage = 1;
    _fetchPage(1);
};

window._permSelectAll = function() {
    _activeUsers = null;
    document.querySelectorAll('#perm-filter-list .user-filter-item').forEach(el => {
        el.classList.add('selected');
        const chk = el.querySelector('.user-filter-check'); if (chk) chk.textContent = '✓';
    });
    const countEl = document.getElementById('perm-filter-count');
    if (countEl) countEl.textContent = `${Object.keys(_userSummary).length} selected`;
    _permPage = 1;
    _fetchPage(1);
};

window._permClearAll = function() {
    _activeUsers = new Set();
    document.querySelectorAll('#perm-filter-list .user-filter-item').forEach(el => {
        el.classList.remove('selected');
        const chk = el.querySelector('.user-filter-check'); if (chk) chk.textContent = '';
    });
    const countEl = document.getElementById('perm-filter-count');
    if (countEl) countEl.textContent = '0 selected';
    _permPage = 1;
    _fetchPage(1);
};

window._permUserSearch = function(q) {
    const lq = q.toLowerCase();
    document.querySelectorAll('#perm-filter-list .user-filter-item').forEach(el => {
        el.style.display = (el.dataset.key || '').toLowerCase().includes(lq) ? '' : 'none';
    });
};

window._permPathSearch = function(val) {
    _pathSearch = val.trim();
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => { _permPage = 1; _fetchPage(1); }, SEARCH_DELAY);
};

window._permSetType = function(val) {
    _itemType = val;
    document.querySelectorAll('#perm-type-group .perm-type-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent.trim().toLowerCase() === (val || 'all').toLowerCase());
    });
    _permPage = 1;
    _fetchPage(1);
};

// ── CSV Export ────────────────────────────────────────────────────────────────
const PERM_CSV_HEADERS = ['User', 'Path', 'Type', 'Error'];
const BTN_SPINNER_SVG = `
<span class="btn-inline-spinner" aria-hidden="true">
    <svg width="13" height="13" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2" opacity="0.28"></circle>
        <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path>
    </svg>
</span>`;

async function _exportCsv(useFilters, btn) {
    if (!_diskId) return;
    const orig = btn.innerHTML;
    btn.disabled   = true;
    btn.innerHTML = `${BTN_SPINNER_SVG}<span>Loading…</span>`;

    try {
        let offset = 0;
        const limit = 5000;
        let totalLoaded = 0;
        
        const suffix = useFilters ? 'filtered' : 'all';
        const suggestedName = `permissions_${_diskId}_${suffix}`;
        const progId = `export-perm-${Date.now()}`;
        
        showProgressToast(progId, 'Exporting Permissions');

        let fetchError = null;
        const fetchChunk = async () => {
            try {
                const params = new URLSearchParams({ id: _diskId, type: 'permissions', offset: offset, limit: limit });
                
                if (useFilters) {
                    if (_activeUsers !== null && _activeUsers.size > 0) params.set('users', [..._activeUsers].join(','));
                    if (_itemType)   params.set('item_type', _itemType);
                    if (_pathSearch) params.set('path', _pathSearch);
                }
                
                const res  = await fetch('api.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                });
                
                const text = await res.text();
                let json;
                try { json = JSON.parse(text); } catch { try { json = JSON.parse(atob(text)); } catch { throw new Error('Invalid JSON response'); } }

                if (json?.status !== 'success') throw new Error(json?.message || 'API error');

                const items = json.data.items || [];
                totalLoaded += items.length;
                
                // We don't have total_count, so we render a generic progress
                updateProgressToast(progId, 100, `${totalLoaded} items exported`);
                btn.innerHTML = `${BTN_SPINNER_SVG}<span>${totalLoaded}</span>`;
                
                offset += limit;
                return { rows: items, isLast: (!json.data.has_more || items.length === 0) };
            } catch (err) {
                fetchError = err;
                throw err;
            }
        };

        const formatRow = (row, h) => {
            const map = { User: 'user', Path: 'path', Type: 'type', Error: 'error' };
            return row[map[h]] ?? '';
        };

        // Try Native Streaming First
        let streamed = false;
        try {
            streamed = await streamExportGzip(suggestedName, PERM_CSV_HEADERS, fetchChunk, formatRow);
        } catch(e) {
            if (e.message !== 'AbortError' && !fetchError) console.error(e);
            streamed = true; // prevent fallback if it was a fetch error or aborted
        }

        if (streamed) {
             if (!fetchError) showToast('Export Complete', 'Exported directly to .gz file', 'success');
             closeProgressToast(progId);
             if (btn) { btn.disabled = false; btn.textContent = orig; }
             return;
        }

        // FALLBACK: ZIP Chunking
        offset = 0;
        totalLoaded = 0;
        const MAX_ROWS = 500000;
        let fileIndex = 1;
        let zipFiles = [];
        let allItems = [];

        while (true) {
            const { rows, isLast } = await fetchChunk();
            allItems = allItems.concat(rows);
            
            // Chunking to avoid Excel limits and OOM
            while (allItems.length >= MAX_ROWS) {
                const chunk = allItems.splice(0, MAX_ROWS);
                const csv   = toCsv(PERM_CSV_HEADERS, chunk, formatRow);
                zipFiles.push({
                    name: `${suggestedName}_part${fileIndex}.csv`,
                    content: '\uFEFF' + csv
                });
                fileIndex++;
            }
            if (isLast) break;
        }

        if (allItems.length > 0) {
            const csv   = toCsv(PERM_CSV_HEADERS, allItems, formatRow);
            const filename = fileIndex === 1 
                ? `${suggestedName}.csv` 
                : `${suggestedName}_part${fileIndex}.csv`;
            
            if (fileIndex === 1) {
                downloadCsv(filename, csv);
            } else {
                zipFiles.push({ name: filename, content: '\uFEFF' + csv });
            }
        }
        
        if (zipFiles.length > 0) {
            btn.innerHTML = `${BTN_SPINNER_SVG}<span>Compressing...</span>`;
            updateProgressToast(progId, 0, 'Zipping chunks...');
            await new Promise(r => setTimeout(r, 50)); // let UI render
            await downloadZip(`${suggestedName}.zip`, zipFiles, (pct) => {
                updateProgressToast(progId, pct, `Zipping chunks (${Math.round(pct)}%)...`);
            });
            closeProgressToast(progId);
            showToast('Export Complete', 'Downloaded ZIP file.', 'success');
        }
    } catch (err) {
        alert('Export failed: ' + err.message);
    } finally {
        btn.disabled    = false;
        btn.innerHTML = orig;
    }
}

window._permExportFiltered = function() {
    const btn = document.querySelector('.perm-export-btn[onclick*="Filtered"]');
    _exportCsv(true, btn);
};

window._permExportAll = function() {
    const btn = document.querySelector('.perm-export-btn[onclick*="All"]');
    _exportCsv(false, btn);
};

// ── Entry point ───────────────────────────────────────────────────────────────
document.addEventListener('permissionsLoaded', (e) => {
    const detail = e.detail ?? {};
    renderPermissions(detail.items != null ? detail : null, detail.diskId);
});

export { renderPermissions };
