// admin/diskMappingModal.js — the disks.json editor, ported from the old
// standalone admin page into an in-dashboard modal. Edits the team→disk mapping
// with live diff + backup/restore.

import { showToast } from '../../core/main.js';
import { adminApi, utf8ToB64 } from './adminApi.js';

let baselineConfig = [];
let currentConfig = [];
let backupCount = 0;
let diffTimer = null;
let diffVisible = false;
let built = false;

function deepClone(v) { return JSON.parse(JSON.stringify(v)); }

function safeParseJson(text) {
    try { return { ok: true, value: JSON.parse(text) }; }
    catch (err) { return { ok: false, error: err.message }; }
}

function $(id) { return document.getElementById(id); }

function createModalShell() {
    if (built) return;
    const shell = document.createElement('div');
    shell.id = 'disk-mapping-modal';
    shell.className = 'admin-modal';
    shell.innerHTML = `
        <div class="admin-modal-backdrop" data-close-modal="true"></div>
        <div class="admin-modal-box glass-panel" role="dialog" aria-modal="true" aria-labelledby="dm-title">
            <div class="admin-modal-header">
                <div>
                    <div id="dm-title" class="admin-modal-title">Disk Mapping</div>
                    <div class="admin-modal-subtitle">Visual editor for <code>disks.json</code></div>
                </div>
                <div class="admin-modal-header-actions">
                    <span id="dm-unsaved" class="admin-badge admin-badge-warn hidden">Unsaved</span>
                    <button id="dm-close" class="admin-icon-btn" type="button" aria-label="Close">&times;</button>
                </div>
            </div>
            <div class="admin-modal-body">
                <div class="admin-stat-row">
                    <div class="admin-stat"><span class="admin-stat-label">Teams</span><span id="dm-stat-teams" class="admin-stat-val">0</span></div>
                    <div class="admin-stat"><span class="admin-stat-label">Disks</span><span id="dm-stat-disks" class="admin-stat-val">0</span></div>
                    <div class="admin-stat"><span class="admin-stat-label">Backups</span><span id="dm-stat-backups" class="admin-stat-val">0</span></div>
                    <div class="admin-stat"><span class="admin-stat-label">Changes</span><span id="dm-stat-changes" class="admin-stat-val">0</span></div>
                </div>

                <div class="admin-toolbar">
                    <button id="dm-add-team" class="admin-btn admin-btn-accent" type="button">+ Add Team</button>
                    <button id="dm-reload" class="admin-btn" type="button">Reload</button>
                    <button id="dm-diff" class="admin-btn" type="button">Show Diff</button>
                    <button id="dm-save" class="admin-btn admin-btn-primary" type="button">Save disks.json</button>
                </div>

                <div id="dm-team-editor" class="dm-team-editor"></div>

                <div class="dm-restore-row">
                    <select id="dm-backup-select" class="admin-select">
                        <option value="">No backup selected</option>
                    </select>
                    <button id="dm-refresh-backups" class="admin-btn" type="button">Refresh Backups</button>
                    <button id="dm-restore" class="admin-btn admin-btn-warn" type="button">Restore Selected</button>
                </div>

                <details class="dm-raw-wrap">
                    <summary>Raw JSON Preview</summary>
                    <pre id="dm-raw" class="dm-raw"></pre>
                </details>

                <div id="dm-diff-box" class="dm-diff-box hidden">
                    <h4>Diff Preview</h4>
                    <p id="dm-diff-summary" class="dm-diff-summary">No changes detected.</p>
                    <ul id="dm-diff-list" class="dm-diff-list"></ul>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(shell);

    shell.addEventListener('click', (e) => {
        if (e.target && e.target.getAttribute('data-close-modal') === 'true') closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && shell.classList.contains('visible')) closeModal();
    });
    $('dm-close').addEventListener('click', closeModal);
    $('dm-add-team').addEventListener('click', () => {
        currentConfig.push({ name: 'New Team', disks: [{ id: '', name: '', path: '' }] });
        renderTeamEditor();
        onDataChanged();
    });
    $('dm-reload').addEventListener('click', async () => {
        try { await loadDisks(); showToast('Reloaded', 'disks.json reloaded.', 'success'); }
        catch (err) { showToast('Reload failed', err.message, 'error'); }
    });
    $('dm-diff').addEventListener('click', () => setDiffVisible($('dm-diff-box').classList.contains('hidden')));
    $('dm-save').addEventListener('click', async () => {
        try { await saveDisks(); } catch (err) { showToast('Save failed', err.message, 'error'); }
    });
    $('dm-refresh-backups').addEventListener('click', async () => {
        try { await loadBackups(); showToast('Refreshed', 'Backup list refreshed.', 'success'); }
        catch (err) { showToast('Refresh failed', err.message, 'error'); }
    });
    $('dm-restore').addEventListener('click', async () => {
        try { await restoreFromBackup(); } catch (err) { showToast('Restore failed', err.message, 'error'); }
    });
    built = true;
}

export async function openDiskMappingModal() {
    createModalShell();
    const modal = $('disk-mapping-modal');
    modal.classList.add('visible');
    document.body.classList.add('admin-modal-open');
    try {
        await loadDisks();
        await loadBackups();
    } catch (err) {
        showToast('Load failed', err.message, 'error');
    }
}

function closeModal() {
    const modal = $('disk-mapping-modal');
    if (!modal) return;
    modal.classList.remove('visible');
    document.body.classList.remove('admin-modal-open');
}

function normalizeConfig(raw) {
    const source = Array.isArray(raw) ? raw : [];
    return source.map((team, teamIdx) => {
        const teamName = String((team && team.name) || ('Team ' + (teamIdx + 1))).trim() || ('Team ' + (teamIdx + 1));
        const disks = Array.isArray(team && team.disks) ? team.disks : [];
        return {
            name: teamName,
            disks: disks.map((disk, diskIdx) => ({
                id: String((disk && disk.id) || ('disk_' + teamIdx + '_' + (diskIdx + 1))).trim(),
                name: String((disk && disk.name) || ('Disk ' + (diskIdx + 1))).trim(),
                path: String((disk && disk.path) || '').trim(),
            })),
        };
    });
}

function getChangeCount() {
    const changes = [];
    collectDiff('$', baselineConfig, currentConfig, changes);
    return changes.length;
}

function updateStats() {
    const teams = Array.isArray(currentConfig) ? currentConfig.length : 0;
    let disks = 0;
    if (Array.isArray(currentConfig)) currentConfig.forEach((t) => { disks += Array.isArray(t.disks) ? t.disks.length : 0; });
    const changes = getChangeCount();
    $('dm-stat-teams').textContent = String(teams);
    $('dm-stat-disks').textContent = String(disks);
    $('dm-stat-backups').textContent = String(backupCount);
    $('dm-stat-changes').textContent = String(changes);
    const badge = $('dm-unsaved');
    if (changes > 0) { badge.classList.remove('hidden'); badge.textContent = 'Unsaved (' + changes + ')'; }
    else { badge.classList.add('hidden'); }
}

function updateRaw() { $('dm-raw').textContent = JSON.stringify(currentConfig, null, 4); }

function scheduleDiffRender() {
    if (!diffVisible) return;
    if (diffTimer) clearTimeout(diffTimer);
    diffTimer = setTimeout(renderDiff, 180);
}

function onDataChanged() { updateRaw(); updateStats(); scheduleDiffRender(); }

function createLabelInput(labelText, value, onInput) {
    const label = document.createElement('label');
    label.className = 'dm-field';
    const span = document.createElement('span');
    span.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'admin-input';
    input.value = value || '';
    input.addEventListener('input', onInput);
    label.appendChild(span);
    label.appendChild(input);
    return label;
}

function renderTeamEditor() {
    const root = $('dm-team-editor');
    root.innerHTML = '';
    if (!Array.isArray(currentConfig) || currentConfig.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'dm-empty';
        empty.textContent = 'No teams yet. Click "Add Team" to create one.';
        root.appendChild(empty);
        return;
    }

    currentConfig.forEach((team, teamIdx) => {
        const teamCard = document.createElement('section');
        teamCard.className = 'dm-team-card';

        const teamHead = document.createElement('div');
        teamHead.className = 'dm-team-head';
        teamHead.appendChild(createLabelInput('Team Name', team.name, (e) => {
            currentConfig[teamIdx].name = e.target.value;
            onDataChanged();
        }));

        const addDiskBtn = document.createElement('button');
        addDiskBtn.type = 'button';
        addDiskBtn.className = 'admin-btn admin-btn-sm';
        addDiskBtn.textContent = '+ Add Disk';
        addDiskBtn.addEventListener('click', () => {
            currentConfig[teamIdx].disks.push({ id: '', name: '', path: '' });
            renderTeamEditor();
            onDataChanged();
        });

        const removeTeamBtn = document.createElement('button');
        removeTeamBtn.type = 'button';
        removeTeamBtn.className = 'admin-btn admin-btn-sm admin-btn-danger';
        removeTeamBtn.textContent = 'Delete Team';
        removeTeamBtn.addEventListener('click', () => {
            if (!window.confirm('Delete this team and all its disks?')) return;
            currentConfig.splice(teamIdx, 1);
            renderTeamEditor();
            onDataChanged();
        });

        teamHead.appendChild(addDiskBtn);
        teamHead.appendChild(removeTeamBtn);
        teamCard.appendChild(teamHead);

        const diskList = document.createElement('div');
        diskList.className = 'dm-disk-list';
        if (!Array.isArray(team.disks) || team.disks.length === 0) {
            const note = document.createElement('div');
            note.className = 'dm-empty';
            note.textContent = 'No disks in this team.';
            diskList.appendChild(note);
        } else {
            team.disks.forEach((disk, diskIdx) => {
                const row = document.createElement('div');
                row.className = 'dm-disk-grid';
                row.appendChild(createLabelInput('Disk ID', disk.id, (e) => {
                    currentConfig[teamIdx].disks[diskIdx].id = e.target.value;
                    onDataChanged();
                }));
                row.appendChild(createLabelInput('Disk Name', disk.name, (e) => {
                    currentConfig[teamIdx].disks[diskIdx].name = e.target.value;
                    onDataChanged();
                }));
                row.appendChild(createLabelInput('Report Path', disk.path, (e) => {
                    currentConfig[teamIdx].disks[diskIdx].path = e.target.value;
                    onDataChanged();
                }));
                const actions = document.createElement('div');
                actions.className = 'dm-disk-actions';
                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'admin-btn admin-btn-sm admin-btn-danger';
                removeBtn.textContent = 'Delete';
                removeBtn.addEventListener('click', () => {
                    currentConfig[teamIdx].disks.splice(diskIdx, 1);
                    renderTeamEditor();
                    onDataChanged();
                });
                actions.appendChild(removeBtn);
                row.appendChild(actions);
                diskList.appendChild(row);
            });
        }
        teamCard.appendChild(diskList);
        root.appendChild(teamCard);
    });
    updateStats();
}

function validateConfig(config) {
    const errors = [];
    const ids = {};
    config.forEach((team, teamIdx) => {
        if (!team.name || !team.name.trim()) errors.push('Team #' + (teamIdx + 1) + ': Team Name is required.');
        if (!Array.isArray(team.disks) || team.disks.length === 0) {
            errors.push('Team "' + (team.name || ('#' + (teamIdx + 1))) + '": At least one disk is required.');
            return;
        }
        team.disks.forEach((disk, diskIdx) => {
            const rowName = 'Team "' + (team.name || ('#' + (teamIdx + 1))) + '" Disk #' + (diskIdx + 1);
            const id = (disk.id || '').trim();
            const name = (disk.name || '').trim();
            const path = (disk.path || '').trim();
            if (!id) errors.push(rowName + ': Disk ID is required.');
            if (!name) errors.push(rowName + ': Disk Name is required.');
            if (!path) errors.push(rowName + ': Report Path is required.');
            if (id) {
                if (ids[id]) errors.push('Duplicate Disk ID "' + id + '".');
                ids[id] = true;
            }
        });
    });
    return errors;
}

function renderValue(v) {
    if (typeof v === 'string') return '"' + v + '"';
    try { return JSON.stringify(v); } catch (_err) { return String(v); }
}

function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function collectDiff(path, beforeValue, afterValue, output) {
    if (typeof beforeValue === 'undefined' && typeof afterValue !== 'undefined') {
        output.push({ type: 'add', path, after: afterValue }); return;
    }
    if (typeof afterValue === 'undefined' && typeof beforeValue !== 'undefined') {
        output.push({ type: 'remove', path, before: beforeValue }); return;
    }
    if (Array.isArray(beforeValue) && Array.isArray(afterValue)) {
        const maxLen = Math.max(beforeValue.length, afterValue.length);
        for (let i = 0; i < maxLen; i += 1) collectDiff(path + '[' + i + ']', beforeValue[i], afterValue[i], output);
        return;
    }
    if (isObject(beforeValue) && isObject(afterValue)) {
        const keys = new Set(Object.keys(beforeValue).concat(Object.keys(afterValue)));
        Array.from(keys).sort().forEach((key) => {
            const childPath = path === '$' ? '$.' + key : path + '.' + key;
            collectDiff(childPath, beforeValue[key], afterValue[key], output);
        });
        return;
    }
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
        output.push({ type: 'change', path, before: beforeValue, after: afterValue });
    }
}

function renderDiff() {
    const list = $('dm-diff-list');
    list.innerHTML = '';
    const changes = [];
    collectDiff('$', baselineConfig, currentConfig, changes);
    if (changes.length === 0) {
        $('dm-diff-summary').textContent = 'No changes detected compared with current disks.json.';
        updateStats();
        return;
    }
    const addCount = changes.filter((c) => c.type === 'add').length;
    const removeCount = changes.filter((c) => c.type === 'remove').length;
    const changeCount = changes.filter((c) => c.type === 'change').length;
    $('dm-diff-summary').textContent =
        'Detected ' + changes.length + ' changes (+' + addCount + ' / -' + removeCount + ' / ~' + changeCount + ').';
    changes.slice(0, 250).forEach((item) => {
        const li = document.createElement('li');
        if (item.type === 'add') {
            li.className = 'diff-add';
            li.textContent = '[ADD] ' + item.path + ' = ' + renderValue(item.after);
        } else if (item.type === 'remove') {
            li.className = 'diff-remove';
            li.textContent = '[REMOVE] ' + item.path + ' was ' + renderValue(item.before);
        } else {
            li.className = 'diff-change';
            li.textContent = '[CHANGE] ' + item.path + ' from ' + renderValue(item.before) + ' to ' + renderValue(item.after);
        }
        list.appendChild(li);
    });
    updateStats();
}

function setDiffVisible(visible) {
    diffVisible = visible;
    const box = $('dm-diff-box');
    const btn = $('dm-diff');
    if (visible) { box.classList.remove('hidden'); btn.textContent = 'Hide Diff'; renderDiff(); }
    else { box.classList.add('hidden'); btn.textContent = 'Show Diff'; }
    updateStats();
}

async function loadDisks() {
    const data = await adminApi('get_disks', { method: 'GET' });
    const parsed = safeParseJson(data.content || '[]');
    if (!parsed.ok) throw new Error('Current disks.json is invalid: ' + parsed.error);
    baselineConfig = normalizeConfig(parsed.value);
    currentConfig = deepClone(baselineConfig);
    renderTeamEditor();
    updateRaw();
    scheduleDiffRender();
}

async function loadBackups() {
    const data = await adminApi('list_backups', { method: 'GET' });
    const items = Array.isArray(data.items) ? data.items : [];
    backupCount = items.length;
    const select = $('dm-backup-select');
    const previous = select.value;
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = items.length > 0 ? 'Select a backup...' : 'No backups found';
    select.appendChild(placeholder);
    items.forEach((item) => {
        const opt = document.createElement('option');
        opt.value = item.name;
        const stamp = item.mtime ? item.mtime.replace('T', ' ').replace('Z', ' UTC') : 'unknown time';
        opt.textContent = item.name + ' (' + stamp + ')';
        select.appendChild(opt);
    });
    if (previous) select.value = previous;
    updateStats();
}

async function saveDisks() {
    const errors = validateConfig(currentConfig);
    if (errors.length > 0) {
        showToast('Validation error', errors[0] + (errors.length > 1 ? (' (+' + (errors.length - 1) + ' more)') : ''), 'error');
        return;
    }
    const normalized = JSON.stringify(currentConfig, null, 4);
    const body = new URLSearchParams({ content_b64: utf8ToB64(normalized) });
    const data = await adminApi('save_disks', { method: 'POST', body: body.toString() });
    baselineConfig = deepClone(currentConfig);
    updateRaw();
    updateStats();
    scheduleDiffRender();
    await loadBackups();
    const backupInfo = data.backup_file ? (' Backup: ' + data.backup_file) : '';
    showToast('Saved', 'disks.json saved successfully.' + backupInfo, 'success');
}

async function restoreFromBackup() {
    const backupName = ($('dm-backup-select').value || '').trim();
    if (!backupName) { showToast('No backup', 'Please select a backup first.', 'error'); return; }
    if (!window.confirm('Restore disks.json from backup "' + backupName + '"?\nCurrent file will be auto-backed up first.')) return;
    const body = new URLSearchParams({ backup_name: backupName });
    const data = await adminApi('restore_backup', { method: 'POST', body: body.toString() });
    await loadDisks();
    await loadBackups();
    const pre = data.pre_restore_backup ? (' Pre-restore backup: ' + data.pre_restore_backup) : '';
    showToast('Restored', 'Restored from ' + (data.restored_from || backupName) + '.' + pre, 'success');
}
