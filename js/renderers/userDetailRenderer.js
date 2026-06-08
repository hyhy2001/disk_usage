// userDetailRenderer.js — Detail User tab (Tab Pane 3 in Detail page)
// userDetailRenderer.js — Renders per-user detail reports (dirs + files)

import { fmt }                              from '../utils/formatters.js';
import { escHtml, debounce }                 from '../utils/dom.js';
import { showToast } from '../core/main.js';
import { state, FILE_PAGE } from './userDetail/state.js';
import {
    _ext, _extColor, _toAbsoluteDisplayPath,
    _normalizeDirRow, _normalizeFileRow, _normalizeDirPayload, _normalizeFilePayload,
    _shortPath, _sliderToSize, _sizeToSlider, _hasExtFilter,
} from './userDetail/helpers.js';
import {
    _fetchDir, _fetchFilePage, _fetchUserList,
} from './userDetail/fetch.js';
import {
    _renderDirCard, _renderDirCardDisabled, _renderPagination, _renderFileCard,
    _renderSkeleton, _renderEmptyState, _renderError, _formatBytesForInput,
    _renderDropdownOptions, _renderFilterBar,
} from './userDetail/render.js';
import { _udExportDirs, _udExportFiles } from './userDetail/export.js';

function _hasActiveFilters() {
    return !!(
        (state.currentFilters.query && String(state.currentFilters.query).trim() !== '') ||
        (state.currentFilters.ext && String(state.currentFilters.ext).trim() !== '') ||
        ((state.currentFilters.minSize || 0) > 0) ||
        ((state.currentFilters.maxSize || 0) > 0)
    );
}

function _emitFilterConfigEvent(action) {
    document.dispatchEvent(new CustomEvent('userDetailFilterConfigChanged', {
        detail: {
            action,
            diskId: state.currentDisk,
            user: state.selectedUser,
            filters: Object.assign({}, state.currentFilters),
        },
    }));
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
        const openUser = () => {
            userBtn.classList.add('open');
            userList.classList.add('visible');
            userBtn.setAttribute('aria-expanded', 'true');
            _renderDropdownOptions(userOptions, '', true);
            userSearch?.focus();
        };
        const closeUser = () => {
            userBtn.classList.remove('open');
            userList.classList.remove('visible');
            userBtn.setAttribute('aria-expanded', 'false');
            if (userSearch) userSearch.value = '';
            state.dropdownQuery = '';
        };
        const toggleUser = () => userList.classList.contains('visible') ? closeUser() : openUser();

        userBtn.addEventListener('click', e => { e.stopPropagation(); toggleUser(); });

        userSearch?.addEventListener('input', debounce(e => {
            _renderDropdownOptions(userOptions, e.target.value, true);
        }, 150));

        userOptions?.addEventListener('click', e => {
            const opt = e.target.closest('.ud-dropdown-option');
            if (!opt) return;
            const user = opt.dataset.value;
            userOptions.querySelectorAll('.ud-dropdown-option').forEach(el => el.classList.remove('selected'));
            opt.classList.add('selected');
            if (userLabel) { userLabel.textContent = user; userLabel.classList.remove('placeholder'); }
            closeUser();
            localStorage.setItem('ud_selected_user', user);
            _loadAndRender(user);
        });

        // Scroll-to-bottom loads more
        userList.addEventListener('scroll', () => {
            if (userList.scrollTop + userList.clientHeight >= userList.scrollHeight - 40) {
                _renderDropdownOptions(userOptions, state.dropdownQuery, false);
            }
        });

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
        // remove-before-add so re-renders (per user load) don't stack resize handlers.
        const onFilterResize = () => {
            if (optionsDropdown.style.display !== 'none') positionOptionsDropdown();
        };
        window.removeEventListener('resize', contentEl._filterResize);
        contentEl._filterResize = onFilterResize;
        window.addEventListener('resize', onFilterResize);
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

            state.currentFilters.query = qInput.value.trim();
            state.currentFilters.ext = extInput.value.trim();
            
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
            
            state.currentFilters.minSize = Math.floor(minSizeBytes);
            state.currentFilters.maxSize = Math.floor(maxSizeBytes);

            localStorage.setItem('ud_filters', JSON.stringify(state.currentFilters));
            _emitFilterConfigEvent('apply');

            if (optionsDropdown) optionsDropdown.style.display = 'none';
            if (state.selectedUser) _loadAndRender(state.selectedUser);
        });
    }
    
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            state.currentFilters = { query: '', ext: '', minSize: 0, maxSize: 0 };
            localStorage.setItem('ud_filters', JSON.stringify(state.currentFilters));
            _emitFilterConfigEvent('reset');
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
            if (state.selectedUser) _loadAndRender(state.selectedUser);
        });
    }

    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state.currentFilters, null, 2));
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
                    if (parsed.query !== undefined) state.currentFilters.query = parsed.query;
                    if (parsed.ext !== undefined) state.currentFilters.ext = parsed.ext;
                    if (parsed.minSize !== undefined) state.currentFilters.minSize = parsed.minSize;
                    if (parsed.maxSize !== undefined) state.currentFilters.maxSize = parsed.maxSize;
                    localStorage.setItem('ud_filters', JSON.stringify(state.currentFilters));
                    _emitFilterConfigEvent('import');
                    if (state.selectedUser) _loadAndRender(state.selectedUser);
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

// ── Core render ───────────────────────────────────────────────────────────────

function _getRoot() { return document.getElementById('ud-root'); }


function _visibleFilterSummary() {
    return {
        query: String(state.currentFilters.query || '').trim(),
        ext: String(state.currentFilters.ext || '').trim(),
        minSize: Number(state.currentFilters.minSize || 0) || 0,
        maxSize: Number(state.currentFilters.maxSize || 0) || 0,
    };
}

function _isEffectivelyUnfiltered() {
    const f = _visibleFilterSummary();
    return !f.query && !f.ext && f.minSize <= 0 && f.maxSize <= 0;
}

async function _loadAndRender(user) {
    const root = _getRoot();
    if (!root || !state.currentDisk) return;

    state.selectedUser   = user;
    state.filePage       = 1;
    state.fileCursorStack = [];
    state.fileNextCursor = null;
    state.fileHasMore = false;
    state.currentSentFileCursor = null;
    state.dirPage        = 1;
    state.dirCursorStack = [];
    state.dirNextCursor = null;
    state.dirHasMore = false;
    state.currentSentDirCursor = null;

    const toolbar = root.querySelector('#ud-unified-toolbar');
    if (toolbar) {
        toolbar.innerHTML = _renderFilterBar();
        _attachFilterEvents(toolbar, root);
    }

    const contentBody = root.querySelector('#ud-content-body');
    if (contentBody) contentBody.innerHTML = _renderSkeleton();

    try {
        let [dirData, fileData] = await Promise.all([
            _fetchDir(state.currentDisk, user, null, FILE_PAGE),
            _fetchFilePage(state.currentDisk, user, null, FILE_PAGE)
        ]);

        const suspiciousEmpty = _isEffectivelyUnfiltered()
            && (Number(dirData.total_dirs_full ?? 0) <= 1)
            && (Number(fileData.total_files_full ?? 0) <= 1)
            && (dirData.dirs?.length ?? 0) === 0
            && (fileData.files?.length ?? 0) === 0;

        if (suspiciousEmpty) {
            state.currentFilters = { query: '', ext: '', minSize: 0, maxSize: 0 };
            localStorage.setItem('ud_filters', JSON.stringify(state.currentFilters));
            if (toolbar) {
                toolbar.innerHTML = _renderFilterBar();
                _attachFilterEvents(toolbar, root);
            }
            [dirData, fileData] = await Promise.all([
                _fetchDir(state.currentDisk, user, null, FILE_PAGE),
                _fetchFilePage(state.currentDisk, user, null, FILE_PAGE)
            ]);
        }

        state.scanRoot = String((dirData && dirData.scan_root) || (fileData && fileData.scan_root) || state.scanRoot || '');

        const otherUser = state.otherUsers.find(o => o.name === user);
        const noDirBreakdown = (dirData.total_dirs_full ?? dirData.dirs.length ?? 0) === 0 && (dirData.dirs?.length ?? 0) === 0;
        const noFileBreakdown = (fileData.total_files_full ?? fileData.files.length ?? 0) === 0 && (fileData.files?.length ?? 0) === 0;
        if (otherUser && noDirBreakdown && noFileBreakdown) {
            if (contentBody) contentBody.innerHTML = `
                <div class="ud-empty-state">
                    <div class="ud-empty-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    </div>
                    <h3>${escHtml(user)}</h3>
                    <p>Total disk usage: <strong>${fmt(otherUser.used)}</strong></p>
                    <p class="ud-no-report-hint">No detailed breakdown available for this user.</p>
                </div>`;
            return;
        }

        const hasExtFilter = _hasExtFilter();
        const dirDisabled = hasExtFilter;
        const dirDisableReason = hasExtFilter ? 'ext' : '';

        // Initialize cursor state BEFORE render so _renderDirCard/_renderFileCard see has_more
        state.fileNextCursor = fileData?.next_cursor ?? null;
        state.fileHasMore    = !!fileData?.has_more;
        state.currentSentFileCursor = null;
        state.fileCursorStack = [];

        state.dirNextCursor  = dirData?.next_cursor ?? null;
        state.dirHasMore     = !!dirData?.has_more;
        state.currentSentDirCursor = null;
        state.dirCursorStack = [];

        if (contentBody) {
            contentBody.innerHTML = `
                <div class="ud-grid">
                    ${dirDisabled ? _renderDirCardDisabled(dirDisableReason) : _renderDirCard(dirData)}
                    ${_renderFileCard(fileData)}
                </div>`;
            _attachContentEvents(contentBody, root);
        }
    } catch (err) {
        if (err.name === 'AbortError') return;
        const otherUser = state.otherUsers.find(o => o.name === user);
        if (otherUser && err.status === 404) {
            if (contentBody) contentBody.innerHTML = `
                <div class="ud-empty-state">
                    <div class="ud-empty-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    </div>
                    <h3>${escHtml(user)}</h3>
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
            const action = btn.dataset.action || '';

            if (e.target.closest('#ud-pagination-dir')) {
                if (action === 'prev') _goToPrevDir(root);
                else if (action === 'next') _goToNextDir(root);
            } else if (e.target.closest('#ud-pagination-file')) {
                if (action === 'prev') _goToPrevFile(root);
                else if (action === 'next') _goToNextFile(root);
            }
        });
        contentEl._hasPaginationEvents = true;
    }

    // Since content inside contentEl is replaced, these buttons are brand new on every render.
    contentEl.querySelector('#ud-export-dirs-user')?.addEventListener('click', () => _udExportDirs(false));
    contentEl.querySelector('#ud-export-files-user')?.addEventListener('click', () => _udExportFiles(false));
}

async function _fetchAndRenderFilePage(root, cursor) {
    if (!state.currentDisk || !state.selectedUser) return;
    const list  = root.querySelector('#ud-file-list');
    const pager = root.querySelector('#ud-pagination-file');
    if (list) list.style.opacity = '0.4';
    if (pager) pager.style.pointerEvents = 'none';

    try {
        const fileData = await _fetchFilePage(state.currentDisk, state.selectedUser, cursor, FILE_PAGE);
        state.scanRoot = String((fileData && fileData.scan_root) || state.scanRoot || '');
        state.currentSentFileCursor = cursor;
        state.fileNextCursor = fileData?.next_cursor ?? null;
        state.fileHasMore = !!fileData?.has_more;

        const rows = Array.isArray(fileData?.files) ? fileData.files.map(_normalizeFileRow) : [];

        if (list) {
            const grandTotal = fileData.total_used || 1;
            list.innerHTML = rows.map(f => {
                const pct = Math.min((f.size / grandTotal) * 100, 100).toFixed(1);
                const ext = _ext(f.path);
                const clr = _extColor(ext);
                return `
                <div class="ud-path-row">
                    <span class="ud-ext-badge" style="--ext:${clr}">.${escHtml(ext)}</span>
                    <div class="ud-path-name" title="${escHtml(_toAbsoluteDisplayPath(f.path))}" style="cursor: pointer;">${escHtml(_shortPath(_toAbsoluteDisplayPath(f.path)))}</div>
                    <div class="ud-path-bar-wrap" data-tooltip="${fmt(f.size)} · ${pct}% of page total">
                        <div class="ud-path-bar-fill ud-fill-emerald" style="width:${pct}%"></div>
                    </div>
                    <span class="ud-path-val">${fmt(f.size)}</span>
                </div>`;
            }).join('');
            list.style.opacity = '';
        }

        const pgWrap = root.querySelector('#ud-pagination-file');
        const newPg = _renderPagination(state.filePage, state.filePage > 1, state.fileHasMore, 'file');
        if (pgWrap) {
            pgWrap.outerHTML = newPg;
        } else if (newPg) {
            const card = root.querySelector('#ud-file-card');
            if (card) card.insertAdjacentHTML('beforeend', newPg);
        }
    } catch (err) {
        if (list) list.style.opacity = '';
        if (pager) pager.style.pointerEvents = '';
    }
}

async function _goToNextFile(root) {
    if (!state.fileHasMore || !state.fileNextCursor) return;
    state.fileCursorStack.push(state.currentSentFileCursor);
    state.filePage += 1;
    await _fetchAndRenderFilePage(root, state.fileNextCursor);
}

async function _goToPrevFile(root) {
    if (state.filePage <= 1 || state.fileCursorStack.length === 0) return;
    const prevCursor = state.fileCursorStack.pop();
    state.filePage -= 1;
    await _fetchAndRenderFilePage(root, prevCursor);
}

async function _fetchAndRenderDirPage(root, cursor) {
    if (!state.currentDisk || !state.selectedUser) return;
    const list  = root.querySelector('#ud-dir-list');
    const pager = root.querySelector('#ud-pagination-dir');
    if (list) list.style.opacity = '0.4';
    if (pager) pager.style.pointerEvents = 'none';

    try {
        const dirData = await _fetchDir(state.currentDisk, state.selectedUser, cursor, FILE_PAGE);
        state.scanRoot = String((dirData && dirData.scan_root) || state.scanRoot || '');
        state.currentSentDirCursor = cursor;
        state.dirNextCursor = dirData?.next_cursor ?? null;
        state.dirHasMore = !!dirData?.has_more;

        const rows = Array.isArray(dirData?.dirs) ? dirData.dirs.map(_normalizeDirRow) : [];

        if (list) {
            const grandTotal = dirData.total_used || 1;
            list.innerHTML = rows.map(d => {
                const pct = Math.min((d.used / grandTotal) * 100, 100).toFixed(1);
                const cls = parseFloat(pct) > 70 ? 'ud-fill-rose' : parseFloat(pct) > 40 ? 'ud-fill-amber' : 'ud-fill-sky';
                return `
                <div class="ud-path-row">
                    <div class="ud-path-name" title="${escHtml(_toAbsoluteDisplayPath(d.path))}" style="cursor: pointer;">${escHtml(_shortPath(_toAbsoluteDisplayPath(d.path)))}</div>
                    <div class="ud-path-bar-wrap" data-tooltip="${fmt(d.used)} · ${pct}% of page total">
                        <div class="ud-path-bar-fill ${cls}" style="width:${pct}%"></div>
                    </div>
                    <span class="ud-path-val">${fmt(d.used)}</span>
                </div>`;
            }).join('');
            list.style.opacity = '';
        }

        const pgWrap = root.querySelector('#ud-pagination-dir');
        const newPg = _renderPagination(state.dirPage, state.dirPage > 1, state.dirHasMore, 'dir');
        if (pgWrap) {
            pgWrap.outerHTML = newPg;
        } else if (newPg) {
            const card = root.querySelector('#ud-dir-card');
            if (card) card.insertAdjacentHTML('beforeend', newPg);
        }
    } catch (err) {
        if (list) list.style.opacity = '';
        if (pager) pager.style.pointerEvents = '';
    }
}

async function _goToNextDir(root) {
    if (!state.dirHasMore || !state.dirNextCursor) return;
    if (_hasExtFilter()) return;
    state.dirCursorStack.push(state.currentSentDirCursor);
    state.dirPage += 1;
    await _fetchAndRenderDirPage(root, state.dirNextCursor);
}

async function _goToPrevDir(root) {
    if (state.dirPage <= 1 || state.dirCursorStack.length === 0) return;
    if (_hasExtFilter()) return;
    const prevCursor = state.dirCursorStack.pop();
    state.dirPage -= 1;
    await _fetchAndRenderDirPage(root, prevCursor);
}

function _attachPickerEvents(root) {
    const btn     = root.querySelector('#ud-dropdown-btn');
    const list    = root.querySelector('#ud-dropdown-list');
    const label   = root.querySelector('#ud-dropdown-label');
    const search  = root.querySelector('#ud-dropdown-search');
    const options = root.querySelector('#ud-dropdown-options');
    if (!btn || !list) return;

    const open = () => {
        btn.classList.add('open'); list.classList.add('visible');
        btn.setAttribute('aria-expanded', 'true');
        _renderDropdownOptions(options, '', true);
        search?.focus();
    };
    const close = () => {
        btn.classList.remove('open'); list.classList.remove('visible');
        btn.setAttribute('aria-expanded', 'false');
        if (search) search.value = '';
        state.dropdownQuery = '';
    };
    const toggle = () => list.classList.contains('visible') ? close() : open();

    btn.addEventListener('click', e => { e.stopPropagation(); toggle(); });

    search?.addEventListener('input', debounce(e => {
        _renderDropdownOptions(options, e.target.value, true);
    }, 150));

    options?.addEventListener('click', e => {
        const opt = e.target.closest('.ud-dropdown-option');
        if (!opt) return;
        const user = opt.dataset.value;
        options.querySelectorAll('.ud-dropdown-option').forEach(el => el.classList.remove('selected'));
        opt.classList.add('selected');
        if (label) { label.textContent = user; label.classList.remove('placeholder'); }
        close();
        _loadAndRender(user);
    });

    list.addEventListener('scroll', () => {
        if (list.scrollTop + list.clientHeight >= list.scrollHeight - 40) {
            _renderDropdownOptions(options, state.dropdownQuery, false);
        }
    });

    // Close on outside click. Stored on `root` and removed before re-adding so
    // repeated _attachPickerEvents calls don't stack listeners on `document`
    // (same pattern as _attachContentEvents' _filterOuterClick above).
    document.removeEventListener('click', root._pickerOuterClick);
    root._pickerOuterClick = (e) => {
        if (!root.querySelector('#ud-dropdown')?.contains(e.target)) close();
    };
    document.addEventListener('click', root._pickerOuterClick);

    // Keyboard: Escape to close
    list.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

async function _renderRoot(diskDir) {
    const root = _getRoot();
    if (!root) return;

    root.innerHTML = `<div class="ud-loading">Loading users...</div>`;

    const users = await _fetchUserList(diskDir);
    state.allUserNames = [
        ...users,
        ...state.otherUsers.map(o => o.name).filter(n => !users.includes(n)),
    ].sort((a, b) => a.localeCompare(b));
    const total = state.allUserNames.length;

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

    // Restore previously selected user if still valid; otherwise wait for user to pick
    if (state.selectedUser && state.allUserNames.includes(state.selectedUser)) {
        _loadAndRender(state.selectedUser);
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



// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called once when the Detail User tab button is clicked.
 * Pass the current disk directory (e.g. "mock_reports/disk_sda").
 */
export async function initUserDetailTab(diskId, otherUsers = []) {
    const isNewDisk = diskId !== state.currentDisk;
    state.currentDisk = diskId;
    state.otherUsers  = otherUsers;

    if (isNewDisk) {
        state.selectedUser = null;
        state.currentFilters = { query: '', ext: '', minSize: 0, maxSize: 0 };
        localStorage.setItem('ud_filters', JSON.stringify(state.currentFilters));
        if (state.abortCtrl) { state.abortCtrl.abort(); state.abortCtrl = null; }
    }

    await _renderRoot(diskId);
}

/**
 * Called by main.js / disk-switch logic to notify disk has changed.
 * Resets state so next tab activation reloads.
 */
export function resetUserDetailTab() {
    state.selectedUser = null;
    state.currentDisk  = null;
    state.filePage = 1;
    state.fileCursorStack = [];
    state.fileNextCursor = null;
    state.fileHasMore = false;
    state.currentSentFileCursor = null;
    state.dirPage = 1;
    state.dirCursorStack = [];
    state.dirNextCursor = null;
    state.dirHasMore = false;
    state.currentSentDirCursor = null;
    if (state.abortCtrl) { state.abortCtrl.abort(); state.abortCtrl = null; }
    const root = _getRoot();
    if (root) root.innerHTML = '';
}
