// userDetailRenderer.js — Detail User tab (Tab Pane 3 in Detail page)
// Shows a user picker; after selecting a user, lazy-loads top dirs + files via user_detail_api.php

import { fmt } from './formatters.js';
import { AppState } from './main.js';

// ── State ─────────────────────────────────────────────────────────────────────
let _selectedUser   = null;
let _currentDisk    = null;   // dir param used for API calls
let _abortCtrl      = null;   // cancel in-flight fetch on rapid user-switch
let _initialized    = false;

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

function _renderPicker(users) {
    const opts = users.map(u =>
        `<option value="${u}"${u === _selectedUser ? ' selected' : ''}>${u}</option>`
    ).join('');

    return `
    <div class="ud-picker-wrap glass-panel">
        <label class="ud-picker-label" for="ud-user-select">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            Select User
        </label>
        <select id="ud-user-select" class="ud-picker-select" aria-label="Select user to view detail">
            <option value="">-- choose a user --</option>
            ${opts}
        </select>
        <span class="ud-picker-hint">${users.length} users available</span>
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

    // Show skeleton while loading
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
        if (err.name === 'AbortError') return; // User switched — ignore
        if (contentEl) contentEl.innerHTML = _renderError(`Failed to load detail for "${user}": ${err.message}`);
    }
}

function _attachPickerEvents(root) {
    root.querySelector('#ud-user-select')?.addEventListener('change', e => {
        const user = e.target.value;
        if (!user) {
            const contentEl = root.querySelector('#ud-content');
            if (contentEl) contentEl.innerHTML = _renderEmptyState();
            _selectedUser = null;
            return;
        }
        _loadAndRender(user);
    });
}

async function _renderRoot(diskDir) {
    const root = _getRoot();
    if (!root) return;

    // Show loading while fetching user list
    root.innerHTML = `<div class="ud-loading">Loading users…</div>`;

    const users = await _fetchUserList(diskDir);

    if (!users.length) {
        root.innerHTML = `
            <div class="ud-empty-state">
                <div class="ud-empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
                <h3>No Detail Reports</h3>
                <p>No user detail reports found for this disk.</p>
            </div>`;
        return;
    }

    // Build layout: picker + content area
    root.innerHTML = `
        ${_renderPicker(users)}
        <div id="ud-content">${_renderEmptyState()}</div>`;

    _attachPickerEvents(root);

    // If a user was previously selected and is still in list, restore
    if (_selectedUser && users.includes(_selectedUser)) {
        const sel = root.querySelector('#ud-user-select');
        if (sel) sel.value = _selectedUser;
        _loadAndRender(_selectedUser);
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called once when the Detail User tab button is clicked.
 * Pass the current disk directory (e.g. "mock_reports/disk_sda").
 */
export async function initUserDetailTab(diskDir) {
    const isNewDisk = diskDir !== _currentDisk;
    _currentDisk = diskDir;

    if (isNewDisk) {
        // Reset user selection when disk changes
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
