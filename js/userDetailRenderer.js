// userDetailRenderer.js — Detail User tab (Tab Pane 3 in Detail page)
// userDetailRenderer.js — Renders per-user detail reports (dirs + files)

import { fmt, fmtDateSec }                  from './formatters.js';
import { AppState }             from './main.js';
import { downloadCsv, downloadZip, streamExportGzip, toCsv }  from './csvExport.js';
import { showToast, showProgressToast, updateProgressToast, closeProgressToast } from './main.js';

// ── State ─────────────────────────────────────────────────────────────────────
let _selectedUser   = null;
let _currentDisk    = null;
let _abortCtrl      = null;
let _otherUsers     = [];   // [{ name, used }] from snapshot
let _filePage       = 1;    // current page (1-indexed)
let _fileTotalPages = 1;    // total pages for file report
let _dirPage        = 1;
let _dirTotalPages  = 1;
const FILE_PAGE     = 500;  // rows per page

// ── Helpers ───────────────────────────────────────────────────────────────────

function _ext(path) {
    const m = path.match(/\.([a-zA-Z0-9]+)$/);
    return m ? m[1].toLowerCase() : '?';
}

function _extColor(ext) {
    const map = {
        bin: '#f59e0b', log: '#64748b', gz: '#8b5cf6',
        csv: '#10b981', json: '#06b6d4', txt: '#94a3b8',
    };
    return map[ext] || '#475569';
}

function _shortPath(path, maxLen = 55) {
    if (path.length <= maxLen) return path;
    const parts = path.split('/');
    // Keep last 3 segments, prefix with …
    return '\u2026/' + parts.slice(-3).join('/');
}

// ── Render helpers ────────────────────────────────────────────────────────────

function _renderDirCard(dirData) {
    if (!dirData || !dirData.dirs?.length) return '';
    const total = dirData.total_used || 1;
    const rows  = dirData.dirs.map(d => {
        const pct = Math.min((d.used / total) * 100, 100).toFixed(1);
        const cls = parseFloat(pct) > 70 ? 'ud-fill-rose' : parseFloat(pct) > 40 ? 'ud-fill-amber' : 'ud-fill-sky';
        return `
        <div class="ud-path-row">
            <div class="ud-path-name" title="${d.path}">${_shortPath(d.path)}</div>
            <div class="ud-path-bar-wrap" data-tooltip="${fmt(d.used)} · ${pct}% of user total">
                <div class="ud-path-bar-fill ${cls}" style="width:${pct}%"></div>
            </div>
            <span class="ud-path-val">${fmt(d.used)}</span>
        </div>`;
    }).join('');

    const totalDirs   = dirData.total_dirs ?? dirData.dirs.length;
    const totalPages  = Math.max(1, Math.ceil(totalDirs / FILE_PAGE));
    const currentPage = _dirPage;
    const badge       = `Page ${currentPage} of ${totalPages} · ${totalDirs.toLocaleString()} dirs`;

    return `
    <div class="ud-card glass-panel" id="ud-dir-card">
        <div class="ud-card-header">
            <span class="ud-card-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                Top Directories
            </span>
            <div class="ud-card-actions">
                <span class="ud-card-badge" id="ud-dir-badge">${badge}</span>
                <button class="ud-export-btn" id="ud-export-dirs-user" data-tooltip="Download this user's top directories as CSV">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    CSV
                </button>
            </div>
        </div>
        <div class="ud-path-list" id="ud-dir-list">${rows}</div>
        ${_renderPagination(currentPage, totalPages, 'dir')}
    </div>`;
}

function _renderPagination(current, total, type) {
    if (total <= 1) return '';

    const pages = [];
    const delta = 2;  // pages around current

    // Build visible page numbers with ellipsis
    const range = [];
    for (let i = Math.max(1, current - delta); i <= Math.min(total, current + delta); i++) range.push(i);

    const buttons = [];

    // Prev button
    buttons.push(`<button class="ud-page-btn${current === 1 ? ' disabled' : ''}" data-page="${current - 1}" aria-label="Previous page">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>`);

    // First page + ellipsis
    if (range[0] > 1) {
        buttons.push(`<button class="ud-page-btn" data-page="1">1</button>`);
        if (range[0] > 2) buttons.push(`<span class="ud-page-ellipsis">…</span>`);
    }

    // Range
    range.forEach(p => buttons.push(
        `<button class="ud-page-btn${p === current ? ' active' : ''}" data-page="${p}">${p}</button>`
    ));

    // Last page + ellipsis
    if (range[range.length - 1] < total) {
        if (range[range.length - 1] < total - 1) buttons.push(`<span class="ud-page-ellipsis">…</span>`);
        buttons.push(`<button class="ud-page-btn" data-page="${total}">${total}</button>`);
    }

    // Next button
    buttons.push(`<button class="ud-page-btn${current === total ? ' disabled' : ''}" data-page="${current + 1}" aria-label="Next page">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>`);

    return `<div class="ud-pagination" id="ud-pagination-${type}">${buttons.join('')}</div>`;
}

function _renderFileCard(fileData) {
    if (!fileData || !fileData.files?.length) return '';
    const grandTotal  = fileData.total_used || 1;
    const totalFiles  = fileData.total_files ?? fileData.files.length;
    const totalPages  = Math.max(1, Math.ceil(totalFiles / FILE_PAGE));
    const currentPage = _filePage;
    const shown       = (fileData.offset ?? 0) + fileData.files.length;
    const badge       = `Page ${currentPage} of ${totalPages} · ${totalFiles.toLocaleString()} files`;

    const rows = fileData.files.map(f => {
        const pct = Math.min((f.size / grandTotal) * 100, 100).toFixed(1);
        const ext = _ext(f.path);
        const clr = _extColor(ext);
        return `
        <div class="ud-path-row">
            <span class="ud-ext-badge" style="background:${clr}20;color:${clr}">.${ext}</span>
            <div class="ud-path-name" title="${f.path}">${_shortPath(f.path)}</div>
            <div class="ud-path-bar-wrap" data-tooltip="${fmt(f.size)} · ${pct}% of page total">
                <div class="ud-path-bar-fill ud-fill-emerald" style="width:${pct}%"></div>
            </div>
            <span class="ud-path-val">${fmt(f.size)}</span>
        </div>`;
    }).join('');

    return `
    <div class="ud-card glass-panel" id="ud-file-card">
        <div class="ud-card-header">
            <span class="ud-card-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                Top Files
            </span>
            <div class="ud-card-actions">
                <span class="ud-card-badge" id="ud-file-badge">${badge}</span>
                <button class="ud-export-btn" id="ud-export-files-user" data-tooltip="Download this user's largest files as CSV">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    CSV
                </button>
            </div>
        </div>
        <div class="ud-path-list" id="ud-file-list">${rows}</div>
        ${_renderPagination(currentPage, totalPages, 'file')}
    </div>`;
}

function _renderSkeleton() {
    return `
    <div class="ud-grid">
        ${[1,2].map(() => `
        <div class="ud-card glass-panel ud-skeleton-card">
            <div class="ud-skeleton ud-sk-title"></div>
            ${Array(8).fill('<div class="ud-skeleton ud-sk-row"></div>').join('')}
        </div>`).join('')}
    </div>`;
}

function _renderPicker(users, otherUsers) {
    const selectedLabel = _selectedUser || 'choose a user...';

    const allUsers = [
        ...users,
        ...otherUsers.map(o => o.name).filter(n => !users.includes(n)),
    ].sort((a, b) => a.localeCompare(b));

    const opts = allUsers.map(name =>
        `<div class="ud-dropdown-option${name === _selectedUser ? ' selected' : ''}" data-value="${name}">${name}</div>`
    ).join('');

    return `
    <div class="ud-picker-wrap glass-panel">
        <span class="ud-picker-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            Select User
        </span>
        <div class="ud-dropdown" id="ud-dropdown">
            <button class="ud-dropdown-btn" id="ud-dropdown-btn" aria-haspopup="listbox" aria-expanded="false">
                <span class="ud-dropdown-btn-text${_selectedUser ? '' : ' placeholder'}" id="ud-dropdown-label">${selectedLabel}</span>
                <svg class="ud-dropdown-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="ud-dropdown-list" id="ud-dropdown-list" role="listbox">
                <input class="ud-dropdown-search" id="ud-dropdown-search" placeholder="Search user..." autocomplete="off">
                <div id="ud-dropdown-options">${opts}</div>
            </div>
        </div>
        <span class="ud-picker-hint">${allUsers.length} users available</span>
    </div>`;
}

function _renderEmptyState() {
    return `
    <div class="ud-empty-state">
        <div class="ud-empty-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </div>
        <h3>Select a User</h3>
        <p>Choose a user from the picker above to view their top directories and largest files.</p>
    </div>`;
}

function _renderError(msg) {
    return `<div class="ud-error">${msg}</div>`;
}

// ── API fetch ─────────────────────────────────────────────────────────────────

async function _fetchDir(diskId, user, offset = 0, limit = FILE_PAGE) {
    if (_abortCtrl) _abortCtrl.abort();
    _abortCtrl = new AbortController();
    const b64User = btoa(unescape(encodeURIComponent(user)));
    const url = `api.php?id=${encodeURIComponent(diskId)}&type=dirs&user_b64=${encodeURIComponent(b64User)}&offset=${offset}&limit=${limit}`;
    const res = await fetch(url, { signal: _abortCtrl.signal });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = JSON.parse(atob(text)); }
    if (json.status !== 'success') throw new Error(json.message || 'API error');
    return json.data.dir;
}

async function _fetchFilePage(diskId, user, offset = 0, limit = FILE_PAGE) {
    const b64User = btoa(unescape(encodeURIComponent(user)));
    const url = `api.php?id=${encodeURIComponent(diskId)}&type=files&user_b64=${encodeURIComponent(b64User)}&offset=${offset}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = JSON.parse(atob(text)); }
    if (json.status !== 'success') throw new Error(json.message || 'API error');
    return json.data.file;
}

async function _fetchUserList(diskId) {
    const url = `api.php?id=${encodeURIComponent(diskId)}&type=users`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { try { json = JSON.parse(atob(text)); } catch { return []; } }
    return json?.data?.users || [];
}


// ── Core render ───────────────────────────────────────────────────────────────

function _getRoot() { return document.getElementById('ud-root'); }

async function _loadAndRender(user) {
    const root = _getRoot();
    if (!root || !_currentDisk) return;

    _selectedUser   = user;
    _filePage       = 1;
    _fileTotalPages = 1;
    _dirPage        = 1;
    _dirTotalPages  = 1;

    const contentEl = root.querySelector('#ud-content');
    if (contentEl) contentEl.innerHTML = _renderSkeleton();

    try {
        const [dirData, fileData] = await Promise.all([
            _fetchDir(_currentDisk, user, 0, FILE_PAGE),
            _fetchFilePage(_currentDisk, user, 0, FILE_PAGE),
        ]);
        _fileTotalPages = Math.max(1, Math.ceil((fileData.total_files ?? fileData.files.length) / FILE_PAGE));
        _dirTotalPages  = Math.max(1, Math.ceil((dirData.total_dirs ?? dirData.dirs.length) / FILE_PAGE));

        if (contentEl) {
            contentEl.innerHTML = `<div class="ud-grid">
                ${_renderDirCard(dirData)}
                ${_renderFileCard(fileData)}
            </div>`;
            _attachContentEvents(contentEl, root);
        }
    } catch (err) {
        if (err.name === 'AbortError') return;
        const otherUser = _otherUsers.find(o => o.name === user);
        if (otherUser && err.status === 404) {
            if (contentEl) contentEl.innerHTML = `
                <div class="ud-empty-state">
                    <div class="ud-empty-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    </div>
                    <h3>${user}</h3>
                    <p>Total disk usage: <strong>${fmt(otherUser.used)}</strong></p>
                    <p class="ud-no-report-hint">No detailed breakdown available for this user.</p>
                </div>`;
        } else {
            if (contentEl) contentEl.innerHTML = _renderError(`Failed to load detail for "${user}": ${err.message}`);
        }
    }
}

function _attachContentEvents(contentEl, root) {
    if (!contentEl) return;

    // Use event delegation on contentEl so we only bind once
    if (!contentEl._hasPaginationEvents) {
        contentEl.addEventListener('click', e => {
            const btn = e.target.closest('.ud-page-btn');
            if (!btn || btn.classList.contains('disabled') || btn.classList.contains('active')) return;
            const page = parseInt(btn.dataset.page, 10);
            if (isNaN(page)) return;

            if (e.target.closest('#ud-pagination-dir')) {
                _goToPageDir(root, page);
            } else if (e.target.closest('#ud-pagination-file')) {
                _goToPageFile(root, page);
            }
        });
        contentEl._hasPaginationEvents = true;
    }

    // Since content inside contentEl is replaced, these buttons are brand new on every render.
    contentEl.querySelector('#ud-export-dirs-user')?.addEventListener('click', () => _udExportDirs(false));
    contentEl.querySelector('#ud-export-files-user')?.addEventListener('click', () => _udExportFiles(false));
}

async function _goToPageFile(root, page) {
    if (!_currentDisk || !_selectedUser) return;
    if (page < 1 || page > _fileTotalPages) return;

    // Dim the list while loading
    const list  = root.querySelector('#ud-file-list');
    const pager = root.querySelector('#ud-pagination-file');
    const badge = root.querySelector('#ud-file-badge');
    if (list) list.style.opacity = '0.4';
    if (pager) pager.style.pointerEvents = 'none';

    try {
        const offset   = (page - 1) * FILE_PAGE;
        const fileData = await _fetchFilePage(_currentDisk, _selectedUser, offset, FILE_PAGE);
        _filePage      = page;
        _fileTotalPages = Math.max(1, Math.ceil((fileData.total_files ?? fileData.files.length) / FILE_PAGE));

        // Re-render file card rows + pagination in-place
        if (list) {
            const grandTotal = fileData.total_used || 1;
            list.innerHTML = fileData.files.map(f => {
                const pct = Math.min((f.size / grandTotal) * 100, 100).toFixed(1);
                const ext = _ext(f.path);
                const clr = _extColor(ext);
                return `
                <div class="ud-path-row">
                    <span class="ud-ext-badge" style="background:${clr}20;color:${clr}">.${ext}</span>
                    <div class="ud-path-name" title="${f.path}">${_shortPath(f.path)}</div>
                    <div class="ud-path-bar-wrap" data-tooltip="${fmt(f.size)} · ${pct}% of page total">
                        <div class="ud-path-bar-fill ud-fill-emerald" style="width:${pct}%"></div>
                    </div>
                    <span class="ud-path-val">${fmt(f.size)}</span>
                </div>`;
            }).join('');
            list.style.opacity = '';
        }

        // Update badge
        const totalFiles = fileData.total_files ?? fileData.files.length;
        if (badge) badge.textContent = `Page ${page} of ${_fileTotalPages} · ${totalFiles.toLocaleString()} files`;

        // Re-render pagination
        const pgWrap = root.querySelector('#ud-pagination-file');
        if (pgWrap) {
            pgWrap.outerHTML = _renderPagination(page, _fileTotalPages, 'file');
        }

    } catch (err) {
        if (list) list.style.opacity = '';
        if (pager) pager.style.pointerEvents = '';
    }
}

async function _goToPageDir(root, page) {
    if (!_currentDisk || !_selectedUser) return;
    if (page < 1 || page > _dirTotalPages) return;

    // Dim the list while loading
    const list  = root.querySelector('#ud-dir-list');
    const pager = root.querySelector('#ud-pagination-dir');
    const badge = root.querySelector('#ud-dir-badge');
    if (list) list.style.opacity = '0.4';
    if (pager) pager.style.pointerEvents = 'none';

    try {
        const offset  = (page - 1) * FILE_PAGE;
        const dirData = await _fetchDir(_currentDisk, _selectedUser, offset, FILE_PAGE);
        _dirPage      = page;
        _dirTotalPages = Math.max(1, Math.ceil((dirData.total_dirs ?? dirData.dirs.length) / FILE_PAGE));

        if (list) {
            const grandTotal = dirData.total_used || 1;
            list.innerHTML = dirData.dirs.map(d => {
                const pct = Math.min((d.used / grandTotal) * 100, 100).toFixed(1);
                const cls = parseFloat(pct) > 70 ? 'ud-fill-rose' : parseFloat(pct) > 40 ? 'ud-fill-amber' : 'ud-fill-sky';
                return `
                <div class="ud-path-row">
                    <div class="ud-path-name" title="${d.path}">${_shortPath(d.path)}</div>
                    <div class="ud-path-bar-wrap" data-tooltip="${fmt(d.used)} · ${pct}% of page total">
                        <div class="ud-path-bar-fill ${cls}" style="width:${pct}%"></div>
                    </div>
                    <span class="ud-path-val">${fmt(d.used)}</span>
                </div>`;
            }).join('');
            list.style.opacity = '';
        }

        const totalDirs = dirData.total_dirs ?? dirData.dirs.length;
        if (badge) badge.textContent = `Page ${page} of ${_dirTotalPages} · ${totalDirs.toLocaleString()} dirs`;

        const pgWrap = root.querySelector('#ud-pagination-dir');
        if (pgWrap) {
            pgWrap.outerHTML = _renderPagination(page, _dirTotalPages, 'dir');
        }

    } catch (err) {
        if (list) list.style.opacity = '';
        if (pager) pager.style.pointerEvents = '';
    }
}

function _attachPickerEvents(root) {
    const btn     = root.querySelector('#ud-dropdown-btn');
    const list    = root.querySelector('#ud-dropdown-list');
    const label   = root.querySelector('#ud-dropdown-label');
    const search  = root.querySelector('#ud-dropdown-search');
    const options = root.querySelector('#ud-dropdown-options');
    if (!btn || !list) return;

    const open  = () => { btn.classList.add('open'); list.classList.add('visible'); btn.setAttribute('aria-expanded', 'true'); search?.focus(); };
    const close = () => { btn.classList.remove('open'); list.classList.remove('visible'); btn.setAttribute('aria-expanded', 'false'); if (search) search.value = ''; _filterOptions(''); };
    const toggle = () => list.classList.contains('visible') ? close() : open();

    btn.addEventListener('click', e => { e.stopPropagation(); toggle(); });

    // Search filter
    const _filterOptions = (q) => {
        options?.querySelectorAll('.ud-dropdown-option').forEach(el => {
            el.classList.toggle('hidden', q.length > 0 && !el.dataset.value.toLowerCase().includes(q.toLowerCase()));
        });
    };
    search?.addEventListener('input', e => _filterOptions(e.target.value));

    // Option click
    options?.addEventListener('click', e => {
        const opt = e.target.closest('.ud-dropdown-option');
        if (!opt) return;
        const user = opt.dataset.value;
        // Update label + styles
        options.querySelectorAll('.ud-dropdown-option').forEach(el => el.classList.remove('selected'));
        opt.classList.add('selected');
        if (label) { label.textContent = user; label.classList.remove('placeholder'); }
        close();
        _loadAndRender(user);
    });

    // Close on outside click
    document.addEventListener('click', e => {
        if (!root.querySelector('#ud-dropdown')?.contains(e.target)) close();
    }, { once: false, capture: false });

    // Keyboard: Escape to close
    list.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

async function _renderRoot(diskDir) {
    const root = _getRoot();
    if (!root) return;

    root.innerHTML = `<div class="ud-loading">Loading users...</div>`;

    const users = await _fetchUserList(diskDir);
    const total = users.length + _otherUsers.length;

    if (!total) {
        root.innerHTML = `
            ${_renderBetaBanner()}
            <div class="ud-empty-state">
                <div class="ud-empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
                <h3>No Detail Reports</h3>
                <p>No user detail reports found for this disk.</p>
            </div>`;
        _attachBannerEvents(root);
        return;
    }

    root.innerHTML = `
        ${_renderBetaBanner()}
        ${_renderPicker(users, _otherUsers)}
        <div id="ud-content">${_renderEmptyState()}</div>`;

    _attachBannerEvents(root);
    _attachPickerEvents(root);

    // Restore previously selected user
    const allNames = [...users, ..._otherUsers.map(o => o.name)];
    if (_selectedUser && allNames.includes(_selectedUser)) {
        _loadAndRender(_selectedUser);
    }
}

function _renderBetaBanner() {
    // Dismissed for this session — don't render
    if (sessionStorage.getItem('ud_beta_dismissed') === '1') return '';
    return `
    <div class="ud-beta-banner" id="ud-beta-banner" role="status">
        <div class="ud-beta-banner-left">
            <span class="ud-beta-chip">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                Beta
            </span>
            <div class="ud-beta-text">
                <strong>Feature in early access</strong>
                <span>Detail User reports depend on whether your disk has been indexed. Some disks may not have breakdown data yet.</span>
            </div>
        </div>
        <button class="ud-beta-close" id="ud-beta-close" aria-label="Dismiss notice" data-tooltip="Don't show again this session">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
    </div>`;
}

function _attachBannerEvents(root) {
    root.querySelector('#ud-beta-close')?.addEventListener('click', () => {
        sessionStorage.setItem('ud_beta_dismissed', '1');
        const banner = root.querySelector('#ud-beta-banner');
        if (banner) {
            banner.style.transition = 'opacity 0.25s ease, max-height 0.3s ease, margin 0.3s ease';
            banner.style.opacity    = '0';
            banner.style.maxHeight  = '0';
            banner.style.marginBottom = '0';
            banner.style.overflow   = 'hidden';
            setTimeout(() => banner.remove(), 320);
        }
    });
}


// ── CSV Export ────────────────────────────────────────────────────────────────

async function _udExportDirs() {
    if (!_currentDisk || !_selectedUser) return;
    const btn = document.querySelector('#ud-export-dirs-user');
    
    const originalBtnHTML = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }

    try {
        const headers = ['User', 'Path', 'Used (bytes)'];
        const suggestedName = `dirs_${_currentDisk}_${_selectedUser}`;
        const formatRow = (row, h) => ({ User: row.user, Path: row.path, 'Used (bytes)': row.used })[h] ?? '';
        
        let offset = 0;
        const limit = 5000;
        const b64User = btoa(unescape(encodeURIComponent(_selectedUser)));
        let totalItems = 0;

        const fetchChunk = async () => {
            const params = new URLSearchParams({ id: _currentDisk, type: 'dirs', user_b64: b64User, offset, limit });
            const res = await fetch('api.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const text = await res.text();
            let json;
            try { json = JSON.parse(text); } catch { try { json = JSON.parse(atob(text)); } catch { throw new Error('Invalid JSON response'); } }
            if (json?.status !== 'success') throw new Error(json?.message || 'API error');
            
            const dirs = json.data.dir.dirs || [];
            if (offset === 0) totalItems = json.data.dir.total_dirs || 0;
            
            const rows = dirs.map(d => ({ user: _selectedUser, path: d.path, used: d.used }));
            
            const hasMore = json.data.dir.has_more && dirs.length > 0;
            
            const processed = offset + rows.length;
            const limitStr = totalItems > 0 ? ` / ${totalItems.toLocaleString()}` : '';
            const pct = totalItems > 0 ? Math.max(1, Math.round((processed / totalItems) * 100)) : Math.min(99, Math.max(1, Math.round((processed / (processed + limit)) * 100)));
            updateProgressToast('export-dirs', pct, `Streaming directories: ${processed.toLocaleString()}${limitStr}`);
            
            offset += limit;
            
            return { rows, isLast: !hasMore };
        };
        
        showProgressToast('export-dirs', 'Streaming directories...');
        const streamed = await streamExportGzip(suggestedName, headers, fetchChunk, formatRow);
        if (streamed) showToast('Export Complete', 'Exported directories directly to disk (.gz)', 'success');
        
    } catch (err) {
        if (err.name !== 'AbortError') alert('Export failed: ' + err.message);
    } finally {
        closeProgressToast('export-dirs');
        if (btn) { btn.disabled = false; btn.innerHTML = originalBtnHTML; }
    }
}

async function _udExportFiles() {
    if (!_currentDisk || !_selectedUser) return;
    const btn = document.querySelector('#ud-export-files-user');

    const originalBtnHTML = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }

    try {
        const headers = ['User', 'Path', 'Size (bytes)'];
        const suggestedName = `files_${_currentDisk}_${_selectedUser}`;
        const formatRow = (row, h) => ({ User: row.user, Path: row.path, 'Size (bytes)': row.size })[h] ?? '';
        
        let offset = 0;
        const limit = 5000;
        const b64User = btoa(unescape(encodeURIComponent(_selectedUser)));
        let totalItems = 0;

        const fetchChunk = async () => {
            const params = new URLSearchParams({ id: _currentDisk, type: 'files', user_b64: b64User, offset, limit });
            const res = await fetch('api.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const text = await res.text();
            let json;
            try { json = JSON.parse(text); } catch { try { json = JSON.parse(atob(text)); } catch { throw new Error('Invalid JSON response'); } }
            if (json?.status !== 'success') throw new Error(json?.message || 'API error');
            
            const files = json.data.file.files || [];
            if (offset === 0) totalItems = json.data.file.total_files || 0;
            
            const rows = files.map(f => ({ user: _selectedUser, path: f.path, size: f.size }));
            
            const hasMore = json.data.file.has_more && files.length > 0;
            
            const processed = offset + rows.length;
            const limitStr = totalItems > 0 ? ` / ${totalItems.toLocaleString()}` : '';
            const pct = totalItems > 0 ? Math.max(1, Math.round((processed / totalItems) * 100)) : Math.min(99, Math.max(1, Math.round((processed / (processed + limit)) * 100)));
            updateProgressToast('export-files', pct, `Streaming files: ${processed.toLocaleString()}${limitStr}`);
            
            offset += limit;
            
            return { rows, isLast: !hasMore };
        };
        
        showProgressToast('export-files', 'Streaming files...');
        const streamed = await streamExportGzip(suggestedName, headers, fetchChunk, formatRow);
        if (streamed) showToast('Export Complete', 'Exported files directly to disk (.gz)', 'success');
        
    } catch (err) {
        if (err.name !== 'AbortError') alert('Export failed: ' + err.message);
    } finally {
        closeProgressToast('export-files');
        if (btn) { btn.disabled = false; btn.innerHTML = originalBtnHTML; }
    }
}


// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called once when the Detail User tab button is clicked.
 * Pass the current disk directory (e.g. "mock_reports/disk_sda").
 */
export async function initUserDetailTab(diskId, otherUsers = []) {
    const isNewDisk = diskId !== _currentDisk;
    _currentDisk = diskId;
    _otherUsers  = otherUsers;

    if (isNewDisk) {
        _selectedUser = null;
        if (_abortCtrl) { _abortCtrl.abort(); _abortCtrl = null; }
    }

    await _renderRoot(diskId);
}

/**
 * Called by main.js / disk-switch logic to notify disk has changed.
 * Resets state so next tab activation reloads.
 */
export function resetUserDetailTab() {
    _selectedUser = null;
    _currentDisk  = null;
    if (_abortCtrl) { _abortCtrl.abort(); _abortCtrl = null; }
    const root = _getRoot();
    if (root) root.innerHTML = '';
}
