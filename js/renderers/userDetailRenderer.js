// userDetailRenderer.js — Detail User tab (Tab Pane 3 in Detail page)
// userDetailRenderer.js — Renders per-user detail reports (dirs + files)

import { fmt, fmtDateSec }                  from '../utils/formatters.js';
import { AppState, showToast }             from '../core/main.js';

// ── State ─────────────────────────────────────────────────────────────────────
let _selectedUser   = localStorage.getItem('ud_selected_user') || null;
let _currentDisk    = null;
let _abortCtrl      = null;
let _otherUsers     = [];   // [{ name, used }] from snapshot
let _filePage       = 1;    // current page (1-indexed)
let _fileTotalPages = 1;    // total pages for file report
let _dirPage        = 1;
let _dirTotalPages  = 1;
let _fileTotalExact = null; // exact total from lazy count (filtered mode)
let _dirTotalExact  = null; // exact total from lazy count (filtered mode)
const FILE_PAGE     = 500;  // rows per page
let _currentFilters = JSON.parse(localStorage.getItem('ud_filters') || 'null') || { query: '', ext: '', minSize: 0, maxSize: 0 };
let _allUserNames   = [];

// ── Debounce utility ──────────────────────────────────────────────────────────
function _debounce(fn, ms) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}

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

// Map a 0-100 linear slider value to an exponential byte size (up to ~100GB).
function _sliderToSize(val) {
    if (val <= 0) return 0;
    const maxLog = Math.log(100 * 1024 * 1024 * 1024);
    return Math.floor(Math.exp((val / 100) * maxLog));
}

// Convert a byte size back to the 0-100 slider value.
function _sizeToSlider(size) {
    if (size <= 0) return 0;
    const maxLog = Math.log(100 * 1024 * 1024 * 1024);
    const val = (Math.log(size) / maxLog) * 100;
    return Math.min(100, Math.floor(val));
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
            <div class="ud-path-name" title="${d.path}" style="cursor: pointer;">${_shortPath(d.path)}</div>
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
                <button class="ud-export-btn" id="ud-export-dirs-user" data-tooltip="Export filtered directories to CSV">
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
    const files = fileData?.files || [];
    const grandTotal  = fileData?.total_used || 1;
    const totalFiles  = fileData?.total_files ?? files.length;
    const totalPages  = Math.max(1, Math.ceil(totalFiles / FILE_PAGE));
    const currentPage = _filePage;
    const shown       = (fileData?.offset ?? 0) + files.length;
    const badge       = files.length ? `Page ${currentPage} of ${totalPages} · ${totalFiles.toLocaleString()} files` : 'No files';

    const rows = files.length ? files.map(f => {
        const pct = Math.min((f.size / grandTotal) * 100, 100).toFixed(1);
        const ext = _ext(f.path);
        const clr = _extColor(ext);
        return `
        <div class="ud-path-row">
            <span class="ud-ext-badge" style="background:${clr}20;color:${clr}">.${ext}</span>
            <div class="ud-path-name" title="${f.path}" style="cursor: pointer;">${_shortPath(f.path)}</div>
            <div class="ud-path-bar-wrap" data-tooltip="${fmt(f.size)} · ${pct}% of page total">
                <div class="ud-path-bar-fill ud-fill-emerald" style="width:${pct}%"></div>
            </div>
            <span class="ud-path-val">${fmt(f.size)}</span>
        </div>`;
    }).join('') : `<div class="ud-empty-row">No files matched the current filter.</div>`;

    return `
    <div class="ud-card glass-panel" id="ud-file-card">
        <div class="ud-card-header">
            <span class="ud-card-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                Top Files
            </span>
            <div class="ud-card-actions">
                <span class="ud-card-badge" id="ud-file-badge">${badge}</span>
                <button class="ud-export-btn" id="ud-export-files-user" data-tooltip="Export filtered files to CSV">
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

function _formatBytesForInput(bytes) {
    if (!bytes || bytes === 0) return { val: '', unit: 'MB' };
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = bytes;
    while (v >= 1024 && i < units.length - 1 && v % 1024 === 0) {
        v /= 1024;
        i++;
    }
    return { val: v, unit: units[i] };
}

function _renderFilterBar() {
    // Count active advanced filters
    let activeAdv = 0;
    if (_currentFilters.ext !== '') activeAdv++;
    if (_currentFilters.minSize > 0) activeAdv++;
    if (_currentFilters.maxSize > 0) activeAdv++;
    const badgeHtml = activeAdv > 0 ? `<span style="background:var(--sky-500); color:#fff; border-radius:50%; width:16px; height:16px; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:bold;">${activeAdv}</span>` : '';
    const minSizePair = _formatBytesForInput(_currentFilters.minSize);
    const maxSizePair = _formatBytesForInput(_currentFilters.maxSize);

    const selectedLabel = _selectedUser || 'Select User...';
    const opts = _allUserNames.map(name =>
        `<div class="ud-dropdown-option${name === _selectedUser ? ' selected' : ''}" data-value="${name}">${name}</div>`
    ).join('');
    
    const totalUsers = _allUserNames.length;

    return `
    <div style="display: flex; flex-wrap: wrap; gap: 6px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-surface); padding: 6px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); align-items: stretch; position: relative; z-index: 50;">
        
        <!-- Total Users Count -->
        <div style="display: flex; align-items: center; padding: 0 10px; font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); border-right: 1px solid var(--border-color); margin-right: 4px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; color: var(--sky-500);"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            ${totalUsers} Users
        </div>

        <!-- User Picker -->
        <div style="position: relative; display: flex; align-items: center; min-width: 180px;" id="ud-picker-container">
            <div class="ud-dropdown" id="ud-dropdown" style="width: 100%;">
                <button class="ud-dropdown-btn" id="ud-dropdown-btn" aria-haspopup="listbox" aria-expanded="false" style="height: 34px; padding: 0 10px; border-radius: 6px; background: var(--bg-surface); border: 1px solid var(--border-color); color: var(--text-primary); font-size: 0.85rem; width: 100%; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
                        <span class="ud-dropdown-btn-text${_selectedUser ? '' : ' placeholder'}" id="ud-dropdown-label" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; font-weight: 600;">${selectedLabel}</span>
                    </div>
                    <svg class="ud-dropdown-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <div class="ud-dropdown-list" id="ud-dropdown-list" role="listbox" style="top: calc(100% + 4px); background-color: var(--bg-base); background-image: linear-gradient(var(--bg-surface-elevated, #1e293b), var(--bg-surface-elevated, #1e293b)); border: 1px solid var(--border-color); box-shadow: 0 12px 40px rgba(0,0,0,0.7); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); z-index: 1000;">
                    <input class="ud-dropdown-search" id="ud-dropdown-search" placeholder="Search user..." autocomplete="off" style="background: transparent; color: var(--text-primary);">
                    <div id="ud-dropdown-options" style="background: transparent;">${opts}</div>
                </div>
            </div>
        </div>

        <div style="width: 1px; background: var(--border-color); margin: 6px 4px;"></div>

        <!-- Search Input -->
        <div style="flex: 1; min-width: 250px; position: relative; display: flex; align-items: stretch;">
            <div id="ud-filter-query-container" style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px; width: 100%; min-height: 34px; max-height: 85px; overflow-y: auto; padding: 4px 12px 4px 34px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-surface-elevated); cursor: text;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="position: absolute; left: 12px; top: 10px; color: var(--text-muted); pointer-events: none;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="text" id="ud-filter-query-input" placeholder="Search (comma or tab)..." style="flex: 1; border: none; background: transparent; color: var(--text-primary); font-size: 0.85rem; outline: none; min-width: 120px;">
                <input type="hidden" id="ud-filter-query" value="${_currentFilters.query}">
            </div>
        </div>
        
        <!-- Advanced Filters Dropdown -->
        <div style="position: relative; display: flex; align-items: center;">
            <button id="ud-filter-options-btn" class="ud-export-btn" style="height: 34px; gap: 6px;" title="Advanced Filters">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                Filters ${badgeHtml}
            </button>
            <div id="ud-filter-options-dropdown" style="display: none; position: absolute; top: calc(100% + 8px); right: 0; width: min(260px, calc(100vw - 24px)); max-width: calc(100vw - 16px); box-sizing: border-box; padding: 16px; flex-direction: column; gap: 16px; z-index: 1000; box-shadow: 0 12px 40px rgba(0,0,0,0.7); border: 1px solid var(--border-color); border-radius: 10px; background-color: var(--bg-base); background-image: linear-gradient(var(--bg-surface-elevated, #1e293b), var(--bg-surface-elevated, #1e293b)); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);">
                
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <label style="font-size: 0.7rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">File Extension</label>
                    <div id="ud-filter-ext-container" style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px; width: 100%; min-height: 34px; max-height: 85px; overflow-y: auto; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-surface-elevated); cursor: text;">
                        <input type="text" id="ud-filter-ext-input" placeholder="e.g. csv, log" style="flex: 1; border: none; background: transparent; color: var(--text-primary); font-size: 0.85rem; outline: none; min-width: 100px;">
                        <input type="hidden" id="ud-filter-ext" value="${_currentFilters.ext}">
                    </div>
                </div>
                
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <label style="font-size: 0.7rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Minimum Size</label>
                    <div style="display: flex; flex-direction: row; gap: 4px; align-items: stretch; height: 34px;">
                        <input type="number" id="ud-filter-min-size-val" value="${minSizePair.val}" min="0" placeholder="0" style="flex: 1; min-width: 0; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-surface-elevated); color: var(--text-primary); font-size: 0.85rem;" autocomplete="off">
                        <select id="ud-filter-min-size-unit" style="width: 60px; padding: 4px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-surface-elevated); color: var(--text-primary); font-size: 0.85rem; outline: none; cursor: pointer;">
                            <option value="B" ${minSizePair.unit === 'B' ? 'selected' : ''}>B</option>
                            <option value="KB" ${minSizePair.unit === 'KB' ? 'selected' : ''}>KB</option>
                            <option value="MB" ${minSizePair.unit === 'MB' ? 'selected' : ''}>MB</option>
                            <option value="GB" ${minSizePair.unit === 'GB' ? 'selected' : ''}>GB</option>
                            <option value="TB" ${minSizePair.unit === 'TB' ? 'selected' : ''}>TB</option>
                        </select>
                    </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <label style="font-size: 0.7rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Maximum Size</label>
                    <div style="display: flex; flex-direction: row; gap: 4px; align-items: stretch; height: 34px;">
                        <input type="number" id="ud-filter-max-size-val" value="${maxSizePair.val}" min="0" placeholder="0" style="flex: 1; min-width: 0; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-surface-elevated); color: var(--text-primary); font-size: 0.85rem;" autocomplete="off">
                        <select id="ud-filter-max-size-unit" style="width: 60px; padding: 4px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-surface-elevated); color: var(--text-primary); font-size: 0.85rem; outline: none; cursor: pointer;">
                            <option value="B" ${maxSizePair.unit === 'B' ? 'selected' : ''}>B</option>
                            <option value="KB" ${maxSizePair.unit === 'KB' ? 'selected' : ''}>KB</option>
                            <option value="MB" ${maxSizePair.unit === 'MB' ? 'selected' : ''}>MB</option>
                            <option value="GB" ${maxSizePair.unit === 'GB' ? 'selected' : ''}>GB</option>
                            <option value="TB" ${maxSizePair.unit === 'TB' ? 'selected' : ''}>TB</option>
                        </select>
                    </div>
                </div>
            </div>
        </div>
        
        <div style="width: 1px; background: var(--border-color); margin: 6px 4px;"></div>
        
        <div style="display: flex; gap: 6px; align-items: center;">
            <button id="ud-filter-apply" class="ud-export-btn" style="height: 34px; background: var(--sky-500, #3b82f6); color: #fff; border-color: var(--sky-500, #3b82f6);">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Apply
            </button>
            <button id="ud-filter-reset" class="ud-export-btn" style="height: 34px;" title="Reset Filters">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                Reset
            </button>
            
            <div style="width: 1px; height: 22px; background: var(--border-color); margin: 0 2px;"></div>
            
            <button id="ud-filter-import" class="ud-export-btn" data-tooltip="Import search config" aria-label="Import Config" style="height: 34px; padding: 0 8px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin: 0;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            </button>
            <button id="ud-filter-export" class="ud-export-btn" data-tooltip="Export search config" aria-label="Export Config" style="height: 34px; padding: 0 8px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin: 0;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            <input type="file" id="ud-filter-file-input" accept=".json" style="display: none;">
        </div>
    </div>`;
}

function _attachFilterEvents(contentEl, root) {
    const applyBtn = contentEl.querySelector('#ud-filter-apply');
    const resetBtn = contentEl.querySelector('#ud-filter-reset');
    const qInput = contentEl.querySelector('#ud-filter-query');
    const extInput = contentEl.querySelector('#ud-filter-ext');
    const minSizeValInput = contentEl.querySelector('#ud-filter-min-size-val');
    const minSizeUnitInput = contentEl.querySelector('#ud-filter-min-size-unit');
    const maxSizeValInput = contentEl.querySelector('#ud-filter-max-size-val');
    const maxSizeUnitInput = contentEl.querySelector('#ud-filter-max-size-unit');
    const importBtn = contentEl.querySelector('#ud-filter-import');
    const exportBtn = contentEl.querySelector('#ud-filter-export');
    const fileInput = contentEl.querySelector('#ud-filter-file-input');
    
    const optionsBtn = contentEl.querySelector('#ud-filter-options-btn');
    const optionsDropdown = contentEl.querySelector('#ud-filter-options-dropdown');

    // User Picker elements
    const userBtn     = contentEl.querySelector('#ud-dropdown-btn');
    const userList    = contentEl.querySelector('#ud-dropdown-list');
    const userLabel   = contentEl.querySelector('#ud-dropdown-label');
    const userSearch  = contentEl.querySelector('#ud-dropdown-search');
    const userOptions = contentEl.querySelector('#ud-dropdown-options');

    if (userBtn && userList) {
        const openUser  = () => { userBtn.classList.add('open'); userList.classList.add('visible'); userBtn.setAttribute('aria-expanded', 'true'); userSearch?.focus(); };
        const closeUser = () => { userBtn.classList.remove('open'); userList.classList.remove('visible'); userBtn.setAttribute('aria-expanded', 'false'); if (userSearch) userSearch.value = ''; _filterUserOptions(''); };
        const toggleUser = () => userList.classList.contains('visible') ? closeUser() : openUser();

        userBtn.addEventListener('click', e => { e.stopPropagation(); toggleUser(); });

        const _filterUserOptions = (q) => {
            userOptions?.querySelectorAll('.ud-dropdown-option').forEach(el => {
                el.classList.toggle('hidden', q.length > 0 && !el.dataset.value.toLowerCase().includes(q.toLowerCase()));
            });
        };
        userSearch?.addEventListener('input', _debounce(e => _filterUserOptions(e.target.value), 120));

        userOptions?.addEventListener('click', e => {
            const opt = e.target.closest('.ud-dropdown-option');
            if (!opt) return;
            const user = opt.dataset.value;
            userOptions.querySelectorAll('.ud-dropdown-option').forEach(el => el.classList.remove('selected'));
            opt.classList.add('selected');
            if (userLabel) { userLabel.textContent = user; userLabel.classList.remove('placeholder'); }
            closeUser();
            
            // Allow the user to keep the filter if they switch!
            // Just update selected user state and render.
            localStorage.setItem('ud_selected_user', user);
            _loadAndRender(user);
        });
        
        // Escape keyboard close
        userList.addEventListener('keydown', e => { if (e.key === 'Escape') closeUser(); });
    }


    const setupBadgeInput = (containerId, inputId, hiddenId) => {
        const container = contentEl.querySelector('#' + containerId);
        const input = contentEl.querySelector('#' + inputId);
        const hidden = contentEl.querySelector('#' + hiddenId);
        if (!container || !input || !hidden) return;

        const updateHidden = () => {
            const badges = Array.from(container.querySelectorAll('.ud-badge')).map(b => b.dataset.val);
            hidden.value = badges.join(',');
        };

        const addBadge = (val) => {
            val = val.trim();
            if (!val) return;
            const existing = Array.from(container.querySelectorAll('.ud-badge')).map(b => b.dataset.val);
            if (existing.includes(val)) return;

            const badge = document.createElement('div');
            badge.className = 'ud-badge';
            badge.dataset.val = val;
            badge.style.cssText = 'display: inline-flex; align-items: center; gap: 4px; background: var(--sky-500); color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: 500; cursor: default;';
            badge.innerHTML = `<span>${val}</span><svg class="ud-badge-rm" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="cursor: pointer; margin-left: 2px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
            
            badge.querySelector('.ud-badge-rm').addEventListener('click', (e) => {
                e.stopPropagation();
                badge.remove();
                updateHidden();
                input.focus();
            });

            container.insertBefore(badge, input);
            updateHidden();
        };

        if (hidden.value) hidden.value.split(',').forEach(addBadge);

        container.addEventListener('click', () => input.focus());

        input.addEventListener('keydown', (e) => {
            if (e.key === ',' || e.key === 'Enter' || e.key === 'Tab') {
                if (input.value.trim() !== '') {
                    e.preventDefault();
                    addBadge(input.value);
                    input.value = '';
                } else if (e.key === 'Enter') {
                    // Let it submit via applyBtn if there's no text left
                    applyBtn?.click();
                }
            } else if (e.key === 'Backspace' && input.value === '') {
                const badges = container.querySelectorAll('.ud-badge');
                if (badges.length > 0) {
                    badges[badges.length - 1].remove();
                    updateHidden();
                }
            }
        });

        input.addEventListener('blur', () => {
            if (input.value.trim()) {
                addBadge(input.value);
                input.value = '';
            }
        });
    };

    setupBadgeInput('ud-filter-query-container', 'ud-filter-query-input', 'ud-filter-query');
    setupBadgeInput('ud-filter-ext-container', 'ud-filter-ext-input', 'ud-filter-ext');

    if (optionsBtn && optionsDropdown) {
        const positionOptionsDropdown = () => {
            const vw = window.innerWidth || document.documentElement.clientWidth || 360;
            const maxWidth = Math.max(220, vw - 24);
            const targetWidth = Math.min(260, maxWidth);

            optionsDropdown.style.width = targetWidth + 'px';
            optionsDropdown.style.maxWidth = (vw - 16) + 'px';
            optionsDropdown.style.left = 'auto';
            optionsDropdown.style.right = '0';

            // First try right-aligned (desktop/default).
            let rect = optionsDropdown.getBoundingClientRect();

            // If left side overflows, pin to left edge of trigger container.
            if (rect.left < 8) {
                optionsDropdown.style.left = '0';
                optionsDropdown.style.right = 'auto';
                rect = optionsDropdown.getBoundingClientRect();
            }

            // If still overflows on the right, force full available width.
            if (rect.right > (vw - 8)) {
                optionsDropdown.style.left = '0';
                optionsDropdown.style.right = 'auto';
                optionsDropdown.style.width = Math.max(200, vw - 16) + 'px';
                optionsDropdown.style.maxWidth = (vw - 16) + 'px';
            }
        };

        optionsBtn.addEventListener('click', (e) => {
            const opening = optionsDropdown.style.display === 'none';
            optionsDropdown.style.display = opening ? 'flex' : 'none';
            if (opening) positionOptionsDropdown();
            e.stopPropagation();
        });
        optionsDropdown.addEventListener('click', e => e.stopPropagation());

        // Keep it inside viewport when orientation/viewport changes.
        window.addEventListener('resize', () => {
            if (optionsDropdown.style.display !== 'none') positionOptionsDropdown();
        });
    }

    // click outside to close dropdowns
    const closeDropdowns = (e) => {
        // Advanced Filters
        if (optionsDropdown && optionsDropdown.style.display !== 'none' && !e.target.closest('#ud-filter-options-btn') && !e.target.closest('#ud-filter-options-dropdown')) {
            optionsDropdown.style.display = 'none';
        }
        // User Picker
        if (userList && userList.classList.contains('visible') && !e.target.closest('#ud-picker-container')) {
            userBtn.classList.remove('open');
            userList.classList.remove('visible');
            userBtn.setAttribute('aria-expanded', 'false');
            if (userSearch) userSearch.value = '';
        }
    };
    document.removeEventListener('click', contentEl._filterOuterClick);
    contentEl._filterOuterClick = closeDropdowns;
    document.addEventListener('click', closeDropdowns);

    if (applyBtn) {
        applyBtn.addEventListener('click', () => {
            // Flush any unsubmitted text in visible inputs into badges first
            const qVisibleInput = contentEl.querySelector('#ud-filter-query-input');
            const extVisibleInput = contentEl.querySelector('#ud-filter-ext-input');
            if (qVisibleInput && qVisibleInput.value.trim()) {
                // programmatically add the badge by dispatching comma
                const event = new KeyboardEvent('keydown', { key: ',', bubbles: true });
                qVisibleInput.dispatchEvent(event);
                if (qVisibleInput.value.trim()) {
                    // fallback if badge wasn't created
                    const container = contentEl.querySelector('#ud-filter-query-container');
                    const hidden = contentEl.querySelector('#ud-filter-query');
                    if (container && hidden) {
                        const existingVals = Array.from(container.querySelectorAll('.ud-badge')).map(b => b.dataset.val);
                        const newVal = qVisibleInput.value.trim();
                        if (newVal && !existingVals.includes(newVal)) {
                            const b = document.createElement('div');
                            b.className = 'ud-badge';
                            b.dataset.val = newVal;
                            b.style.cssText = 'display: inline-flex; align-items: center; gap: 4px; background: var(--sky-500); color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: 500; cursor: default;';
                            b.innerHTML = `<span>${newVal}</span><svg class="ud-badge-rm" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="cursor: pointer; margin-left: 2px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
                            b.querySelector('.ud-badge-rm').addEventListener('click', (ev) => { ev.stopPropagation(); b.remove(); const badges = Array.from(container.querySelectorAll('.ud-badge')).map(x => x.dataset.val); hidden.value = badges.join(','); });
                            container.insertBefore(b, qVisibleInput);
                            const allBadges = Array.from(container.querySelectorAll('.ud-badge')).map(x => x.dataset.val);
                            hidden.value = allBadges.join(',');
                        }
                        qVisibleInput.value = '';
                    }
                }
            }
            if (extVisibleInput && extVisibleInput.value.trim()) {
                const container = contentEl.querySelector('#ud-filter-ext-container');
                const hidden = contentEl.querySelector('#ud-filter-ext');
                if (container && hidden) {
                    const existingVals = Array.from(container.querySelectorAll('.ud-badge')).map(b => b.dataset.val);
                    const newVal = extVisibleInput.value.trim();
                    if (newVal && !existingVals.includes(newVal)) {
                        const b = document.createElement('div');
                        b.className = 'ud-badge';
                        b.dataset.val = newVal;
                        b.style.cssText = 'display: inline-flex; align-items: center; gap: 4px; background: var(--sky-500); color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: 500; cursor: default;';
                        b.innerHTML = `<span>${newVal}</span><svg class="ud-badge-rm" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="cursor: pointer; margin-left: 2px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
                        b.querySelector('.ud-badge-rm').addEventListener('click', (ev) => { ev.stopPropagation(); b.remove(); const badges = Array.from(container.querySelectorAll('.ud-badge')).map(x => x.dataset.val); hidden.value = badges.join(','); });
                        container.insertBefore(b, extVisibleInput);
                        const allBadges = Array.from(container.querySelectorAll('.ud-badge')).map(x => x.dataset.val);
                        hidden.value = allBadges.join(',');
                    }
                    extVisibleInput.value = '';
                }
            }

            _currentFilters.query = qInput.value.trim();
            _currentFilters.ext = extInput.value.trim();
            
            const minSizeVal = parseFloat(minSizeValInput.value) || 0;
            let minSizeBytes = minSizeVal;
            if (minSizeUnitInput.value === 'KB') minSizeBytes *= 1024;
            else if (minSizeUnitInput.value === 'MB') minSizeBytes *= 1024 ** 2;
            else if (minSizeUnitInput.value === 'GB') minSizeBytes *= 1024 ** 3;
            else if (minSizeUnitInput.value === 'TB') minSizeBytes *= 1024 ** 4;
            
            const maxSizeVal = parseFloat(maxSizeValInput.value) || 0;
            let maxSizeBytes = maxSizeVal;
            if (maxSizeUnitInput.value === 'KB') maxSizeBytes *= 1024;
            else if (maxSizeUnitInput.value === 'MB') maxSizeBytes *= 1024 ** 2;
            else if (maxSizeUnitInput.value === 'GB') maxSizeBytes *= 1024 ** 3;
            else if (maxSizeUnitInput.value === 'TB') maxSizeBytes *= 1024 ** 4;
            
            _currentFilters.minSize = Math.floor(minSizeBytes);
            _currentFilters.maxSize = Math.floor(maxSizeBytes);
            
            localStorage.setItem('ud_filters', JSON.stringify(_currentFilters));

            if (optionsDropdown) optionsDropdown.style.display = 'none';
            if (_selectedUser) _loadAndRender(_selectedUser);
        });
    }
    
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            _currentFilters = { query: '', ext: '', minSize: 0, maxSize: 0 };
            localStorage.setItem('ud_filters', JSON.stringify(_currentFilters));
            qInput.value = '';
            extInput.value = '';
            
            // clear visual badges
            contentEl.querySelectorAll('.ud-badge').forEach(b => b.remove());
            const qInputEl = contentEl.querySelector('#ud-filter-query-input');
            const extInputEl = contentEl.querySelector('#ud-filter-ext-input');
            if (qInputEl) qInputEl.value = '';
            if (extInputEl) extInputEl.value = '';

            if (minSizeValInput) minSizeValInput.value = '';
            if (minSizeUnitInput) minSizeUnitInput.value = 'MB';
            if (maxSizeValInput) maxSizeValInput.value = '';
            if (maxSizeUnitInput) maxSizeUnitInput.value = 'MB';

            if (optionsDropdown) optionsDropdown.style.display = 'none';
            if (_selectedUser) _loadAndRender(_selectedUser);
        });
    }

    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(_currentFilters, null, 2));
            const dlAnchorElem = document.createElement('a');
            dlAnchorElem.setAttribute("href", dataStr);
            dlAnchorElem.setAttribute("download", `search_config.json`);
            document.body.appendChild(dlAnchorElem);
            dlAnchorElem.click();
            dlAnchorElem.remove();
        });
    }

    if (importBtn && fileInput) {
        importBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const parsed = JSON.parse(e.target.result);
                    if (parsed.query !== undefined) _currentFilters.query = parsed.query;
                    if (parsed.ext !== undefined) _currentFilters.ext = parsed.ext;
                    if (parsed.minSize !== undefined) _currentFilters.minSize = parsed.minSize;
                    if (parsed.maxSize !== undefined) _currentFilters.maxSize = parsed.maxSize;
                    localStorage.setItem('ud_filters', JSON.stringify(_currentFilters));
                    if (_selectedUser) _loadAndRender(_selectedUser);
                } catch (err) {
                    alert('Invalid JSON config file');
                }
            };
            reader.readAsText(file);
            fileInput.value = ''; // Reset
        });
    }

    const qInputEl = contentEl.querySelector('#ud-filter-query-input');
    const extInputEl = contentEl.querySelector('#ud-filter-ext-input');
    const onEnter = (e) => { if (e.key === 'Enter') applyBtn?.click(); };
    qInputEl?.addEventListener('keydown', onEnter);
    extInputEl?.addEventListener('keydown', onEnter);
}

// ── API fetch ─────────────────────────────────────────────────────────────────

async function _fetchApiText(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return res.text();
}

async function _fetchDir(diskId, user, offset = 0, limit = FILE_PAGE) {
    if (_abortCtrl) _abortCtrl.abort();
    _abortCtrl = new AbortController();
    const b64User = btoa(unescape(encodeURIComponent(user)));
    let url = `api.php?id=${encodeURIComponent(diskId)}&type=dirs&user_b64=${encodeURIComponent(b64User)}&offset=${offset}&limit=${limit}`;
    if (_currentFilters.query) url += `&filter_query=${encodeURIComponent(_currentFilters.query)}`;
    if (_currentFilters.minSize > 0) url += `&filter_min_size=${_currentFilters.minSize}`;
    if (_currentFilters.maxSize > 0) url += `&filter_max_size=${_currentFilters.maxSize}`;

    const text = await _fetchApiText(url, { signal: _abortCtrl.signal });
    let json;
    try { json = JSON.parse(text); } catch { json = JSON.parse(atob(text)); }
    if (json.status !== 'success') throw new Error(json.message || 'API error');
    return json.data.dir;
}

async function _fetchDetail(diskId, user, dirOffset = 0, fileOffset = 0, limit = FILE_PAGE) {
    if (_abortCtrl) _abortCtrl.abort();
    _abortCtrl = new AbortController();
    const b64User = btoa(unescape(encodeURIComponent(user)));
    let url = `api.php?id=${encodeURIComponent(diskId)}&type=detail&user_b64=${encodeURIComponent(b64User)}&dir_offset=${dirOffset}&file_offset=${fileOffset}&limit=${limit}`;
    if (_currentFilters.query) url += `&filter_query=${encodeURIComponent(_currentFilters.query)}`;
    if (_currentFilters.ext) url += `&filter_ext=${encodeURIComponent(_currentFilters.ext)}`;
    if (_currentFilters.minSize > 0) url += `&filter_min_size=${_currentFilters.minSize}`;
    if (_currentFilters.maxSize > 0) url += `&filter_max_size=${_currentFilters.maxSize}`;

    const text = await _fetchApiText(url, { signal: _abortCtrl.signal });
    let json;
    try { json = JSON.parse(text); } catch { json = JSON.parse(atob(text)); }
    if (json.status !== 'success') throw new Error(json.message || 'API error');
    return json.data;
}

async function _fetchFilePage(diskId, user, offset = 0, limit = FILE_PAGE) {
    const b64User = btoa(unescape(encodeURIComponent(user)));
    let url = `api.php?id=${encodeURIComponent(diskId)}&type=files&user_b64=${encodeURIComponent(b64User)}&offset=${offset}&limit=${limit}`;
    if (_currentFilters.query) url += `&filter_query=${encodeURIComponent(_currentFilters.query)}`;
    if (_currentFilters.ext) url += `&filter_ext=${encodeURIComponent(_currentFilters.ext)}`;
    if (_currentFilters.minSize > 0) url += `&filter_min_size=${_currentFilters.minSize}`;
    if (_currentFilters.maxSize > 0) url += `&filter_max_size=${_currentFilters.maxSize}`;

    const text = await _fetchApiText(url);
    let json;
    try { json = JSON.parse(text); } catch { json = JSON.parse(atob(text)); }
    if (json.status !== 'success') throw new Error(json.message || 'API error');
    return json.data.file;
}

async function _fetchUserList(diskId) {
    const url = `api.php?id=${encodeURIComponent(diskId)}&type=users`;
    try {
        const json = await window.appFetcher._fetchJson(url, { cacheTimeMs: 30000 });
        return json?.data?.users || [];
    } catch (_err) {
        return [];
    }
}

// Lazy count: fired in background after initial render to get the accurate total
// for filtered queries. count_only=1 hits the same index path as the data query.
async function _fetchDirCount(diskId, user) {
    const b64User = btoa(unescape(encodeURIComponent(user)));
    let url = `api.php?id=${encodeURIComponent(diskId)}&type=dirs&user_b64=${encodeURIComponent(b64User)}&count_only=1&offset=0&limit=1`;
    if (_currentFilters.query)   url += `&filter_query=${encodeURIComponent(_currentFilters.query)}`;
    if (_currentFilters.minSize > 0) url += `&filter_min_size=${_currentFilters.minSize}`;
    if (_currentFilters.maxSize > 0) url += `&filter_max_size=${_currentFilters.maxSize}`;
    try {
        const text = await _fetchApiText(url);
        let json;
        try { json = JSON.parse(text); } catch { try { json = JSON.parse(atob(text)); } catch { return null; } }
        return (json?.status === 'success') ? (json.data.dir_count ?? null) : null;
    } catch (_err) {
        return null;
    }
}

async function _fetchFileCount(diskId, user) {
    const b64User = btoa(unescape(encodeURIComponent(user)));
    let url = `api.php?id=${encodeURIComponent(diskId)}&type=files&user_b64=${encodeURIComponent(b64User)}&count_only=1&offset=0&limit=1`;
    if (_currentFilters.query)   url += `&filter_query=${encodeURIComponent(_currentFilters.query)}`;
    if (_currentFilters.ext)     url += `&filter_ext=${encodeURIComponent(_currentFilters.ext)}`;
    if (_currentFilters.minSize > 0) url += `&filter_min_size=${_currentFilters.minSize}`;
    if (_currentFilters.maxSize > 0) url += `&filter_max_size=${_currentFilters.maxSize}`;
    try {
        const text = await _fetchApiText(url);
        let json;
        try { json = JSON.parse(text); } catch { try { json = JSON.parse(atob(text)); } catch { return null; } }
        return (json?.status === 'success') ? (json.data.file_count ?? null) : null;
    } catch (_err) {
        return null;
    }
}

// Update badge + pagination in-place after accurate count arrives
function _applyLazyCount(root, type, exactCount) {
    if (!root || exactCount === null || exactCount === undefined) return;
    const badge    = root.querySelector(`#ud-${type}-badge`);
    const pgWrap   = root.querySelector(`#ud-pagination-${type}`);
    const curPage  = type === 'dir' ? _dirPage : _filePage;
    const label    = type === 'dir' ? 'dirs' : 'files';
    const total    = Math.max(1, exactCount);
    const pages    = Math.max(1, Math.ceil(total / FILE_PAGE));

    if (type === 'dir') {
        _dirTotalExact = total;
        _dirTotalPages = pages;
    } else {
        _fileTotalExact = total;
        _fileTotalPages = pages;
    }

    if (badge) badge.textContent = `Page ${curPage} of ${pages} · ${total.toLocaleString()} ${label}`;
    if (pgWrap) pgWrap.outerHTML  = _renderPagination(curPage, pages, type);
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
    _fileTotalExact = null;
    _dirTotalExact  = null;

    const toolbar = root.querySelector('#ud-unified-toolbar');
    if (toolbar) {
        toolbar.innerHTML = _renderFilterBar();
        _attachFilterEvents(toolbar, root);
    }

    const contentBody = root.querySelector('#ud-content-body');
    if (contentBody) contentBody.innerHTML = _renderSkeleton();

    try {
        const detailData = await _fetchDetail(_currentDisk, user, 0, 0, FILE_PAGE);
        const dirData = detailData.dir;
        const fileData = detailData.file;

        const otherUser = _otherUsers.find(o => o.name === user);
        const noDirBreakdown = (dirData.total_dirs ?? dirData.dirs.length ?? 0) === 0 && (dirData.dirs?.length ?? 0) === 0;
        const noFileBreakdown = (fileData.total_files ?? fileData.files.length ?? 0) === 0 && (fileData.files?.length ?? 0) === 0;
        if (otherUser && noDirBreakdown && noFileBreakdown) {
            if (contentBody) contentBody.innerHTML = `
                <div class="ud-empty-state">
                    <div class="ud-empty-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    </div>
                    <h3>${user}</h3>
                    <p>Total disk usage: <strong>${fmt(otherUser.used)}</strong></p>
                    <p class="ud-no-report-hint">No detailed breakdown available for this user.</p>
                </div>`;
            return;
        }

        _fileTotalPages = Math.max(1, Math.ceil((fileData.total_files ?? fileData.files.length) / FILE_PAGE));
        _dirTotalPages  = Math.max(1, Math.ceil((dirData.total_dirs ?? dirData.dirs.length) / FILE_PAGE));

        if (contentBody) {
            contentBody.innerHTML = `
                <div class="ud-grid">
                    ${_renderDirCard(dirData)}
                    ${_renderFileCard(fileData)}
                </div>`;
            _attachContentEvents(contentBody, root);
        }

        // Lazy count: if has_more and filters are active, accurate totals aren't
        // known yet. Fire background count requests and patch badge + pagination.
        const hasFilters = !!(Object.values(_currentFilters).some(v => v && v !== 0));
        if (hasFilters) {
            const capturedUser = user;
            const capturedDisk = _currentDisk;
            // Show spinner in badges while counting
            const dirBadge  = root.querySelector('#ud-dir-badge');
            const fileBadge = root.querySelector('#ud-file-badge');
            if (dirBadge  && dirData.has_more)  dirBadge.textContent  += ' …';
            if (fileBadge && fileData.has_more) fileBadge.textContent += ' …';

            if (dirData.has_more) {
                _fetchDirCount(capturedDisk, capturedUser).then(n => {
                    if (n !== null && _selectedUser === capturedUser && _currentDisk === capturedDisk)
                        _applyLazyCount(root, 'dir', n);
                }).catch(() => {});
            }
            if (fileData.has_more) {
                _fetchFileCount(capturedDisk, capturedUser).then(n => {
                    if (n !== null && _selectedUser === capturedUser && _currentDisk === capturedDisk)
                        _applyLazyCount(root, 'file', n);
                }).catch(() => {});
            }
        }
    } catch (err) {
        if (err.name === 'AbortError') return;
        const otherUser = _otherUsers.find(o => o.name === user);
        if (otherUser && err.status === 404) {
            if (contentBody) contentBody.innerHTML = `
                <div class="ud-empty-state">
                    <div class="ud-empty-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    </div>
                    <h3>${user}</h3>
                    <p>Total disk usage: <strong>${fmt(otherUser.used)}</strong></p>
                    <p class="ud-no-report-hint">No detailed breakdown available for this user.</p>
                </div>`;
        } else {
            if (contentBody) contentBody.innerHTML = _renderError(`Failed to load detail for "${user}": ${err.message}`);
        }
    }
}

function _attachContentEvents(contentEl, root) {
    if (!contentEl) return;

    // Use event delegation on contentEl so we only bind once
    if (!contentEl._hasPaginationEvents) {
        contentEl.addEventListener('click', e => {
            const pathNameEl = e.target.closest('.ud-path-name');
            if (pathNameEl) {
                const path = pathNameEl.getAttribute('title');
                if (path) {
                    navigator.clipboard.writeText(path).then(() => {
                        showToast('Path Copied', `Successfully copied to clipboard.`, 'success', 2500);
                    }).catch(err => {
                        showToast('Failed to copy', err.message, 'error', 2500);
                    });
                }
                return;
            }

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
        const fallbackTotal = fileData.total_files ?? fileData.files.length;
        const totalFiles = _fileTotalExact ?? fallbackTotal;
        _fileTotalPages = Math.max(1, Math.ceil(totalFiles / FILE_PAGE));

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
                    <div class="ud-path-name" title="${f.path}" style="cursor: pointer;">${_shortPath(f.path)}</div>
                    <div class="ud-path-bar-wrap" data-tooltip="${fmt(f.size)} · ${pct}% of page total">
                        <div class="ud-path-bar-fill ud-fill-emerald" style="width:${pct}%"></div>
                    </div>
                    <span class="ud-path-val">${fmt(f.size)}</span>
                </div>`;
            }).join('');
            list.style.opacity = '';
        }

        // Update badge
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
        const fallbackTotal = dirData.total_dirs ?? dirData.dirs.length;
        const totalDirs = _dirTotalExact ?? fallbackTotal;
        _dirTotalPages = Math.max(1, Math.ceil(totalDirs / FILE_PAGE));

        if (list) {
            const grandTotal = dirData.total_used || 1;
            list.innerHTML = dirData.dirs.map(d => {
                const pct = Math.min((d.used / grandTotal) * 100, 100).toFixed(1);
                const cls = parseFloat(pct) > 70 ? 'ud-fill-rose' : parseFloat(pct) > 40 ? 'ud-fill-amber' : 'ud-fill-sky';
                return `
                <div class="ud-path-row">
                    <div class="ud-path-name" title="${d.path}" style="cursor: pointer;">${_shortPath(d.path)}</div>
                    <div class="ud-path-bar-wrap" data-tooltip="${fmt(d.used)} · ${pct}% of page total">
                        <div class="ud-path-bar-fill ${cls}" style="width:${pct}%"></div>
                    </div>
                    <span class="ud-path-val">${fmt(d.used)}</span>
                </div>`;
            }).join('');
            list.style.opacity = '';
        }

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
    _allUserNames = [
        ...users,
        ..._otherUsers.map(o => o.name).filter(n => !users.includes(n)),
    ].sort((a, b) => a.localeCompare(b));
    const total = _allUserNames.length;

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
        <div id="ud-unified-toolbar">
            ${_renderFilterBar()}
        </div>
        <div id="ud-content-body">${_renderEmptyState()}</div>`;

    _attachBannerEvents(root);
    const toolbar = root.querySelector('#ud-unified-toolbar');
    if (toolbar) {
        _attachFilterEvents(toolbar, root);
    }

    // Restore previously selected user
    if (_selectedUser && _allUserNames.includes(_selectedUser)) {
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
const UD_BTN_SPINNER_SVG = `
<span class="btn-inline-spinner" aria-hidden="true">
    <svg width="13" height="13" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2" opacity="0.28"></circle>
        <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path>
    </svg>
</span>`;

function _buildUserCsvExportUrl(kind) {
    const b64User = btoa(unescape(encodeURIComponent(_selectedUser)));
    const params = new URLSearchParams({
        id: _currentDisk,
        type: kind === 'dirs' ? 'dirs_csv' : 'files_csv',
        user_b64: b64User,
        filter_query: _currentFilters.query || '',
        filter_ext: _currentFilters.ext || '',
        filter_min_size: _currentFilters.minSize || 0,
        filter_max_size: _currentFilters.maxSize || 0
    });
    return 'api.php?' + params.toString();
}

function _downloadUserCsvExport(kind) {
    const a = document.createElement('a');
    a.href = _buildUserCsvExportUrl(kind);
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 1000);
}

function _startUserCsvExport(kind) {
    if (!_currentDisk || !_selectedUser) return;

    const btn = document.querySelector(kind === 'dirs' ? '#ud-export-dirs-user' : '#ud-export-files-user');
    const originalBtnHTML = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = UD_BTN_SPINNER_SVG;
    }

    _downloadUserCsvExport(kind);
    showToast('Export Started', 'CSV export started. If all export slots are busy, the server will queue this download automatically.', 'info');

    setTimeout(() => {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalBtnHTML;
        }
    }, 2500);
}

async function _udExportDirs() {
    _startUserCsvExport('dirs');
}

async function _udExportFiles() {
    _startUserCsvExport('files');
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
    _fileTotalExact = null;
    _dirTotalExact  = null;
    if (_abortCtrl) { _abortCtrl.abort(); _abortCtrl = null; }
    const root = _getRoot();
    if (root) root.innerHTML = '';
}
