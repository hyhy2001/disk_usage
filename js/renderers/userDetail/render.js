// userDetail/render.js — HTML render helpers for the Detail User tab.
// Leaf: depends on state + helpers + utils. No fetch/core/event calls.

import { fmt } from '../../utils/formatters.js';
import { escHtml } from '../../utils/dom.js';
import { state, DROPDOWN_PAGE } from './state.js';
import { _ext, _extColor, _shortPath, _toAbsoluteDisplayPath } from './helpers.js';

export function _renderDirCard(dirData) {
    if (!dirData || !dirData.dirs?.length) {
        return `
        <div class="ud-card glass-panel" id="ud-dir-card">
            <div class="ud-card-header">
                <span class="ud-card-title">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    Top Directories
                </span>
                <div class="ud-card-actions">
                    </div>
            </div>
            <div class="ud-path-list" id="ud-dir-list">
                <div class="ud-empty-row">No directory data available for this user.</div>
            </div>
        </div>`;
    }
    const total = dirData.total_used || 1;
    const rows  = dirData.dirs.map(d => {
        const pct = Math.min((d.used / total) * 100, 100).toFixed(1);
        const cls = parseFloat(pct) > 70 ? 'ud-fill-rose' : parseFloat(pct) > 40 ? 'ud-fill-amber' : 'ud-fill-sky';
        return `
        <div class="ud-path-row">
            <div class="ud-path-name" title="${escHtml(_toAbsoluteDisplayPath(d.path))}" style="cursor: pointer;">${escHtml(_shortPath(_toAbsoluteDisplayPath(d.path)))}</div>
            <div class="ud-path-bar-wrap" data-tooltip="${fmt(d.used)} · ${pct}% of user total">
                <div class="ud-path-bar-fill ${cls}" style="width:${pct}%"></div>
            </div>
            <span class="ud-path-val">${fmt(d.used)}</span>
        </div>`;
    }).join('');


    const hasPrev = state.dirPage > 1;
    const hasNext = state.dirHasMore;

    return `
    <div class="ud-card glass-panel" id="ud-dir-card">
        <div class="ud-card-header">
            <span class="ud-card-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                Top Directories
            </span>
            <div class="ud-card-actions">
                <button class="ud-export-btn" id="ud-export-dirs-user" data-tooltip="Export filtered directories to CSV">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    CSV
                </button>
            </div>
        </div>
        <div class="ud-path-list" id="ud-dir-list">${rows}</div>
        ${_renderPagination(state.dirPage, hasPrev, hasNext, 'dir')}
    </div>`;
}

export function _renderDirCardDisabled(reason) {
    const isExt = reason === 'ext';
    const badge = isExt ? 'Disabled by extension filter' : 'Hidden by type filter';
    const msg = isExt
        ? 'Top directories are hidden when file extension filter is active.'
        : 'Directory list is hidden while node type is set to files.';
    return `
    <div class="ud-card glass-panel" id="ud-dir-card">
        <div class="ud-card-header">
            <span class="ud-card-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                Top Directories
            </span>
            <div class="ud-card-actions">
            </div>
        </div>
        <div class="ud-path-list" id="ud-dir-list">
            <div class="ud-empty-row">${msg}</div>
        </div>
    </div>`;
}


export function _renderPagination(currentPage, hasPrev, hasNext, type) {
    // Only render when there is something to navigate
    if (!hasPrev && !hasNext) return '';
    const prevDisabled = hasPrev ? '' : ' disabled';
    const nextDisabled = hasNext ? '' : ' disabled';

    const prevBtn = `<button class="ud-page-btn ud-page-nav${prevDisabled}" data-action="prev" aria-label="Previous page">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        <span>Prev</span>
    </button>`;

    const nextBtn = `<button class="ud-page-btn ud-page-nav${nextDisabled}" data-action="next" aria-label="Next page">
        <span>Next</span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>`;

    return `<div class="ud-pagination" id="ud-pagination-${type}">${prevBtn}<span class="ud-page-current" aria-live="polite">Page ${currentPage}</span>${nextBtn}</div>`;
}

export function _renderFileCard(fileData) {
    const files = fileData?.files || [];
    const grandTotal  = fileData?.total_used || 1;

    const rows = files.length ? files.map(f => {
        const pct = Math.min((f.size / grandTotal) * 100, 100).toFixed(1);
        const ext = _ext(f.path);
        const clr = _extColor(ext);
        return `
        <div class="ud-path-row">
            <span class="ud-ext-badge" style="background:${clr}20;color:${clr}">.${ext}</span>
            <div class="ud-path-name" title="${escHtml(_toAbsoluteDisplayPath(f.path))}" style="cursor: pointer;">${escHtml(_shortPath(_toAbsoluteDisplayPath(f.path)))}</div>
            <div class="ud-path-bar-wrap" data-tooltip="${fmt(f.size)} · ${pct}% of page total">
                <div class="ud-path-bar-fill ud-fill-emerald" style="width:${pct}%"></div>
            </div>
            <span class="ud-path-val">${fmt(f.size)}</span>
        </div>`;
    }).join('') : `<div class="ud-empty-row">No files matched the current filter.</div>`;

    const hasPrev = state.filePage > 1;
    const hasNext = state.fileHasMore;

    return `
    <div class="ud-card glass-panel" id="ud-file-card">
        <div class="ud-card-header">
            <span class="ud-card-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                Top Files
            </span>
            <div class="ud-card-actions">
                <button class="ud-export-btn" id="ud-export-files-user" data-tooltip="Export filtered files to CSV">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    CSV
                </button>
            </div>
        </div>
        <div class="ud-path-list" id="ud-file-list">${rows}</div>
        ${_renderPagination(state.filePage, hasPrev, hasNext, 'file')}
    </div>`;
}

export function _renderSkeleton() {
    return `
    <div class="ud-grid">
        ${[1,2].map(() => `
        <div class="ud-card glass-panel ud-skeleton-card">
            <div class="ud-skeleton ud-sk-title"></div>
            ${Array(8).fill('<div class="ud-skeleton ud-sk-row"></div>').join('')}
        </div>`).join('')}
    </div>`;
}


export function _renderEmptyState() {
    return `
    <div class="ud-empty-state">
        <div class="ud-empty-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </div>
        <h3>Select a User</h3>
        <p>Choose a user from the picker above to view their top directories and largest files.</p>
    </div>`;
}

export function _renderError(msg) {
    return `<div class="ud-error">${escHtml(msg)}</div>`;
}

export function _formatBytesForInput(bytes) {
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

export function _renderDropdownOptions(optionsEl, query, reset) {
    if (!optionsEl) return;
    const q = (query || '').toLowerCase().trim();
    const matches = q
        ? state.allUserNames.filter(n => n.toLowerCase().includes(q))
        : state.allUserNames.slice();
    if (reset) {
        state.dropdownQuery = q;
        state.dropdownShown = 0;
        optionsEl.innerHTML = '';
    }
    const from = state.dropdownShown;
    const batch = matches.slice(from, from + DROPDOWN_PAGE);
    batch.forEach(name => {
        const div = document.createElement('div');
        div.className = 'ud-dropdown-option' + (name === state.selectedUser ? ' selected' : '');
        div.dataset.value = name;
        div.textContent = name;
        optionsEl.appendChild(div);
    });
    state.dropdownShown = from + batch.length;
    // Show/hide a "no results" message
    let noRes = optionsEl.querySelector('.ud-dropdown-noresults');
    if (matches.length === 0) {
        if (!noRes) {
            noRes = document.createElement('div');
            noRes.className = 'ud-dropdown-noresults';
            noRes.style.cssText = 'padding:10px 14px;font-size:0.82rem;color:var(--text-muted,#94a3b8);';
            noRes.textContent = 'No users found';
            optionsEl.appendChild(noRes);
        }
    } else if (noRes) {
        noRes.remove();
    }
}

export function _renderFilterBar() {
    // Count active advanced filters
    let activeAdv = 0;
    if (state.currentFilters.ext !== '') activeAdv++;
    if (state.currentFilters.minSize > 0) activeAdv++;
    if (state.currentFilters.maxSize > 0) activeAdv++;
    const badgeHtml = activeAdv > 0 ? `<span style="background:var(--sky-500); color:#fff; border-radius:50%; width:16px; height:16px; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:bold;">${activeAdv}</span>` : '';
    const minSizePair = _formatBytesForInput(state.currentFilters.minSize);
    const maxSizePair = _formatBytesForInput(state.currentFilters.maxSize);

    const selectedLabel = state.selectedUser || 'Select User...';
    const opts = state.allUserNames.slice(0, DROPDOWN_PAGE).map(name =>
        `<div class="ud-dropdown-option${name === state.selectedUser ? ' selected' : ''}" data-value="${name}">${name}</div>`
    ).join('');

    const totalUsers = state.allUserNames.length;

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
                        <span class="ud-dropdown-btn-text${state.selectedUser ? '' : ' placeholder'}" id="ud-dropdown-label" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; font-weight: 600;">${selectedLabel}</span>
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
                <input type="hidden" id="ud-filter-query" value="${state.currentFilters.query}">
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
                        <input type="hidden" id="ud-filter-ext" value="${state.currentFilters.ext}">
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
