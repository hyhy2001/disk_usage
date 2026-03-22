// userDetailRenderer.js — Detail User tab (Tab Pane 3 in Detail page)
// Shows a user picker; after selecting a user, lazy-loads top dirs + files via user_detail_api.php

import { fmt } from './formatters.js';
import { AppState } from './main.js';

// ── State ─────────────────────────────────────────────────────────────────────
let _selectedUser   = null;
let _currentDisk    = null;
let _abortCtrl      = null;
let _otherUsers     = [];   // [{ name, used }] from snapshot

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
            <div class="ud-path-bar-wrap">
                <div class="ud-path-bar-fill ${cls}" style="width:${pct}%"></div>
            </div>
            <span class="ud-path-val">${fmt(d.used)}</span>
        </div>`;
    }).join('');

    return `
    <div class="ud-card glass-panel">
        <div class="ud-card-header">
            <span class="ud-card-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                Top Directories
            </span>
            <span class="ud-card-badge">${dirData.dirs.length} dirs &middot; ${fmt(total)} total</span>
        </div>
        <div class="ud-path-list">${rows}</div>
    </div>`;
}

function _renderFileCard(fileData) {
    if (!fileData || !fileData.files?.length) return '';
    const total = fileData.total_used || 1;
    const rows  = fileData.files.map(f => {
        const pct = Math.min((f.size / total) * 100, 100).toFixed(1);
        const ext = _ext(f.path);
        const clr = _extColor(ext);
        return `
        <div class="ud-path-row">
            <span class="ud-ext-badge" style="background:${clr}20;color:${clr}">.${ext}</span>
            <div class="ud-path-name" title="${f.path}">${_shortPath(f.path)}</div>
            <div class="ud-path-bar-wrap">
                <div class="ud-path-bar-fill ud-fill-emerald" style="width:${pct}%"></div>
            </div>
            <span class="ud-path-val">${fmt(f.size)}</span>
        </div>`;
    }).join('');

    const totalFiles = fileData.total_files
        ? `${fileData.total_files.toLocaleString()} files total`
        : '';

    return `
    <div class="ud-card glass-panel">
        <div class="ud-card-header">
            <span class="ud-card-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                Top Files
            </span>
            <span class="ud-card-badge">${fileData.files.length} shown &middot; ${totalFiles}</span>
        </div>
        <div class="ud-path-list">${rows}</div>
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

    // Merge all users into one flat sorted list
    const otherNames = new Set(otherUsers.map(o => o.name));
    const allUsers = [
        ...users,
        ...otherUsers.map(o => o.name).filter(n => !users.includes(n)),
    ].sort((a, b) => a.localeCompare(b));

    const opts = allUsers.map(name => {
        const isOther = !users.includes(name) && otherNames.has(name);
        return `<div class="ud-dropdown-option${name === _selectedUser ? ' selected' : ''}${isOther ? ' ud-opt-other' : ''}" data-value="${name}">${name}</div>`;
    }).join('');

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

async function _fetchDetail(diskDir, user) {
    if (_abortCtrl) _abortCtrl.abort();
    _abortCtrl = new AbortController();
    const { signal } = _abortCtrl;

    const url = `user_detail_api.php?dir=${encodeURIComponent(diskDir)}&user=${encodeURIComponent(user)}&type=both`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.status !== 'success') throw new Error(json.message || 'API error');
    return json.data; // { dir: {...}, file: {...} }
}

async function _fetchUserList(diskDir) {
    const url = `user_detail_api.php?dir=${encodeURIComponent(diskDir)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return json?.data?.users || [];
}

// ── Core render ───────────────────────────────────────────────────────────────

function _getRoot() { return document.getElementById('ud-root'); }

async function _loadAndRender(user) {
    const root = _getRoot();
    if (!root || !_currentDisk) return;

    _selectedUser = user;

    const contentEl = root.querySelector('#ud-content');
    if (contentEl) contentEl.innerHTML = _renderSkeleton();

    try {
        const data = await _fetchDetail(_currentDisk, user);
        if (contentEl) {
            contentEl.innerHTML = `<div class="ud-grid">
                ${_renderDirCard(data.dir)}
                ${_renderFileCard(data.file)}
            </div>`;
        }
    } catch (err) {
        if (err.name === 'AbortError') return;
        // No detail report — check if it's an other user with snapshot usage
        const otherUser = _otherUsers.find(o => o.name === user);
        if (otherUser && err.message.includes('404')) {
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
            <div class="ud-empty-state">
                <div class="ud-empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
                <h3>No Detail Reports</h3>
                <p>No user detail reports found for this disk.</p>
            </div>`;
        return;
    }

    root.innerHTML = `
        ${_renderPicker(users, _otherUsers)}
        <div id="ud-content">${_renderEmptyState()}</div>`;

    _attachPickerEvents(root);

    // Restore previously selected user
    const allNames = [...users, ..._otherUsers.map(o => o.name)];
    if (_selectedUser && allNames.includes(_selectedUser)) {
        _loadAndRender(_selectedUser);
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called once when the Detail User tab button is clicked.
 * Pass the current disk directory (e.g. "mock_reports/disk_sda").
 */
export async function initUserDetailTab(diskDir, otherUsers = []) {
    const isNewDisk = diskDir !== _currentDisk;
    _currentDisk = diskDir;
    _otherUsers  = otherUsers;

    if (isNewDisk) {
        _selectedUser = null;
        if (_abortCtrl) { _abortCtrl.abort(); _abortCtrl = null; }
    }

    await _renderRoot(diskDir);
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
