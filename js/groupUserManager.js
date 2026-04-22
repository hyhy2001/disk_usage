import { showToast } from './main.js';

const STORAGE_KEY = 'du_group_user_config_v2';
const EXPORT_FILE = 'group_user_config.v2.json';
const CURRENT_SCHEMA_VERSION = 3;

const state = {
    catalogDisks: [],
    config: sanitizeConfig(loadLocalConfigRaw()),
    selectedTeamSpace: null,
    selectedGroupId: null,
    selectedDiskId: null,
    usersByDisk: new Map(),
    systemGroupsByDisk: new Map(),
    usersLoadingToken: 0,
    saveTimer: null,
    saveErrorToastAt: 0,
    filters: {
        groups: '',
        disks: '',
        users: '',
    },
    dragUser: null,
};

function resetModalFilters() {
    state.filters.groups = '';
    state.filters.disks = '';
    state.filters.users = '';
}

function syncFilterInputs() {
    const groupSearch = document.getElementById('group-user-search-groups');
    const diskSearch = document.getElementById('group-user-search-disks');
    const userSearch = document.getElementById('group-user-search-users');
    if (groupSearch) groupSearch.value = state.filters.groups || '';
    if (diskSearch) diskSearch.value = state.filters.disks || '';
    if (userSearch) userSearch.value = state.filters.users || '';
}

function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function utf8ToB64(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

function b64ToUtf8(str) {
    return decodeURIComponent(escape(atob(str)));
}

function emitConfigEvent(name) {
    const payload = deepClone(state.config);
    window.__DU_GROUP_CONFIG = payload;
    document.dispatchEvent(new CustomEvent(name, { detail: { config: payload } }));
}

function loadLocalConfigRaw() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('du_group_user_config_v1');
        if (!raw) return { schema_version: CURRENT_SCHEMA_VERSION, groups: [] };
        return JSON.parse(raw);
    } catch {
        return { schema_version: CURRENT_SCHEMA_VERSION, groups: [] };
    }
}

function sanitizeConfig(parsed) {
    if (!parsed || typeof parsed !== 'object') {
        return { schema_version: CURRENT_SCHEMA_VERSION, groups: [] };
    }

    const incomingVersion = Number(parsed.schema_version || parsed.version || 1);
    if (incomingVersion > CURRENT_SCHEMA_VERSION) {
        throw new Error(`Unsupported config schema v${incomingVersion}. Current app supports up to v${CURRENT_SCHEMA_VERSION}.`);
    }

    const out = {
        schema_version: CURRENT_SCHEMA_VERSION,
        groups: [],
        updated_at: parsed.updated_at || null,
        seeded_disks: {},
    };

    const groups = Array.isArray(parsed.groups) ? parsed.groups : [];
    groups.forEach((g, idx) => {
        if (!g || typeof g !== 'object') return;

        const id = String(g.id || `group_${idx + 1}`);
        const name = String(g.name || `Group ${idx + 1}`).trim() || `Group ${idx + 1}`;
        const diskUsers = {};

        if (g.diskUsers && typeof g.diskUsers === 'object') {
            Object.keys(g.diskUsers).forEach((diskId) => {
                const users = g.diskUsers[diskId];
                if (!Array.isArray(users)) return;
                diskUsers[String(diskId)] = [...new Set(users
                    .map(u => String(u || '').trim())
                    .filter(Boolean))]
                    .sort((a, b) => a.localeCompare(b));
            });
        }

        out.groups.push({ id, name, diskUsers });
    });

    out.groups.sort((a, b) => a.name.localeCompare(b.name));
    if (parsed.seeded_disks && typeof parsed.seeded_disks === 'object') {
        Object.keys(parsed.seeded_disks).forEach((diskId) => {
            const id = String(diskId || '').trim();
            if (id === '') return;
            out.seeded_disks[id] = !!parsed.seeded_disks[diskId];
        });
    }
    return out;
}

function closeSettingsDropdown() {
    const dropdown = document.getElementById('settings-dropdown');
    if (!dropdown) return;
    dropdown.style.display = 'none';
    dropdown.dataset.visible = 'false';
}

function ensureDefaultGroup() {
    if (state.config.groups.length > 0) return;
    state.config.groups.push({
        id: `group_${Date.now()}`,
        name: 'Group 1',
        diskUsers: {},
    });
}

function normalizeAndSaveLocal() {
    try {
        state.config = sanitizeConfig(state.config);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
    } catch (err) {
        showToast('Save failed', err?.message || 'Unable to persist Group User config.', 'error');
    }
}

async function fetchJson(url, options = {}) {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        return JSON.parse(b64ToUtf8(text));
    }
}

async function loadServerConfig() {
    const res = await fetchJson('api.php?type=group_config&action=get', { cache: 'no-store' });
    const cfg = res?.data?.config || { schema_version: CURRENT_SCHEMA_VERSION, groups: [] };
    return sanitizeConfig(cfg);
}

async function saveServerConfigNow() {
    const payload = new URLSearchParams({
        config_b64: utf8ToB64(JSON.stringify(state.config)),
    });

    await fetchJson('api.php?type=group_config&action=save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: payload.toString(),
        cache: 'no-store',
    });
}

function scheduleServerSave() {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(async () => {
        try {
            await saveServerConfigNow();
        } catch (err) {
            const now = Date.now();
            if ((now - state.saveErrorToastAt) > 5000) {
                state.saveErrorToastAt = now;
                showToast('Server save failed', err?.message || 'Could not save Group User config to server.', 'warning');
            }
        }
    }, 260);
}

function persistConfigAndBroadcast() {
    state.config.updated_at = new Date().toISOString();
    normalizeAndSaveLocal();
    scheduleServerSave();
    emitConfigEvent('groupUserConfigChanged');
}

function getSelectedGroup() {
    return state.config.groups.find(g => g.id === state.selectedGroupId) || null;
}

function makeDiskCatalog(rawDisks) {
    const map = new Map();

    const addDisk = (disk, teamName) => {
        if (!disk || !disk.id) return;
        const id = String(disk.id);
        const existing = map.get(id);
        const name = String(disk.name || id);
        if (existing) {
            if (!existing.teamNames.includes(teamName)) existing.teamNames.push(teamName);
            return;
        }
        map.set(id, { id, name, teamNames: [teamName] });
    };

    const walk = (node, inheritedTeam = '') => {
        if (!node || typeof node !== 'object') return;

        if (Array.isArray(node)) {
            node.forEach(item => walk(item, inheritedTeam));
            return;
        }

        if (node.project && Array.isArray(node.teams)) {
            node.teams.forEach(team => {
                const teamName = String(team?.name || 'Unknown Team');
                const fullTeam = `${node.project} / ${teamName}`;
                if (Array.isArray(team?.disks)) team.disks.forEach(d => addDisk(d, fullTeam));
            });
            return;
        }

        if (node.name && Array.isArray(node.disks)) {
            const teamName = String(node.name || inheritedTeam || 'Unknown Team');
            node.disks.forEach(d => addDisk(d, teamName));
            return;
        }

        if (node.id) addDisk(node, inheritedTeam || 'Ungrouped');
    };

    walk(rawDisks);
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function loadDiskCatalog() {
    const raw = await fetchJson('api.php?type=disks', { cache: 'no-store' });
    if (!Array.isArray(raw)) throw new Error('Invalid disks payload');
    state.catalogDisks = makeDiskCatalog(raw);
}

async function loadUsersForDisk(diskId) {
    if (state.usersByDisk.has(diskId)) return state.usersByDisk.get(diskId);
    const json = await fetchJson(`api.php?id=${encodeURIComponent(diskId)}&type=users`, { cache: 'no-store' });
    const users = Array.isArray(json?.data?.users) ? json.data.users : [];
    const normalizedUsers = [...new Set(users.map(u => String(u || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
    const systemGroups = Array.isArray(json?.data?.system_groups) ? json.data.system_groups : [];
    const normalizedSystemGroups = systemGroups
        .filter((g) => g && typeof g === 'object')
        .map((g) => {
            const name = String(g.name || '').trim();
            const usersInGroup = Array.isArray(g.users) ? g.users : [];
            const groupUsers = [...new Set(usersInGroup.map(u => String(u || '').trim()).filter(Boolean))]
                .sort((a, b) => a.localeCompare(b));
            if (!name) return null;
            return { name, users: groupUsers, count: groupUsers.length };
        })
        .filter(Boolean);

    const payload = { users: normalizedUsers, systemGroups: normalizedSystemGroups };
    state.usersByDisk.set(diskId, payload);
    state.systemGroupsByDisk.set(diskId, normalizedSystemGroups);
    return payload;
}

function nextGroupName() {
    let idx = 1;
    const names = new Set(state.config.groups.map(g => g.name));
    while (names.has(`Group ${idx}`)) idx += 1;
    return `Group ${idx}`;
}

function iconPlus() {
    return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>';
}

function iconMinus() {
    return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path></svg>';
}

function iconEdit() {
    return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>';
}

function iconCopy() {
    return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
}

function getFilteredRows(rows, keyName, filterTerm) {
    const q = (filterTerm || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => String(r?.[keyName] || '').toLowerCase().includes(q));
}

function createModalShell() {
    if (document.getElementById('group-user-modal')) return;

    const shell = document.createElement('div');
    shell.id = 'group-user-modal';
    shell.className = 'group-user-modal';
    shell.innerHTML = `
        <div class="group-user-modal-backdrop" data-close-modal="true"></div>
        <div class="group-user-modal-box glass-panel" role="dialog" aria-modal="true" aria-labelledby="group-user-title">
            <div class="group-user-modal-header">
                <div class="group-user-header-main">
                    <div id="group-user-title" class="group-user-title">Group User Config</div>
                    <div class="group-user-subtitle">Server-synced profile config · schema v${CURRENT_SCHEMA_VERSION}</div>
                    <div class="group-user-switch-wrap">
                        <label class="group-user-switch-label" for="group-user-group-switch">Team Space</label>
                        <select id="group-user-group-switch" class="group-user-switch-select">
                            <option value="">Select disk first...</option>
                        </select>
                    </div>
                </div>
                <div class="group-user-header-actions">
                    <button id="btn-group-user-import" class="group-user-toolbar-btn" type="button">Import</button>
                    <button id="btn-group-user-export" class="group-user-toolbar-btn" type="button">Export</button>
                    <button id="btn-group-user-close" class="group-user-toolbar-btn group-user-close" type="button" aria-label="Close">x</button>
                </div>
            </div>
            <div class="group-user-modal-body">
                <section class="group-user-pane">
                    <div class="group-user-pane-head">
                        <span>Disks</span><button id="btn-group-copy-disk" class="group-user-mini-btn" type="button" title="Copy current disk mapping to another disk">${iconCopy()}</button>
                    </div>
                    <div class="group-user-pane-filter-wrap"><input id="group-user-search-disks" class="group-user-search" placeholder="Search disks..." /></div>
                    <div id="group-user-disks" class="group-user-list"></div>
                </section>
                <section class="group-user-pane">
                    <div class="group-user-pane-head"><span>Groups</span></div>
                    <div class="group-user-pane-filter-wrap"><input id="group-user-search-groups" class="group-user-search" placeholder="Search groups..." /></div>
                    <div id="group-user-groups" class="group-user-list"></div>
                </section>
                <section class="group-user-pane">
                    <div class="group-user-pane-head"><span>Users</span></div>
                    <div class="group-user-pane-filter-wrap"><input id="group-user-search-users" class="group-user-search" placeholder="Search users..." /></div>
                    <div id="group-user-users" class="group-user-list"></div>
                </section>
            </div>
            <input id="group-user-file-input" type="file" accept="application/json" style="display:none;" />
        </div>
    `;

    document.body.appendChild(shell);

    shell.addEventListener('click', (e) => {
        const target = e.target;
        if (target && target.getAttribute('data-close-modal') === 'true') {
            closeModal();
        }
    });

    document.getElementById('btn-group-user-close')?.addEventListener('click', closeModal);
    document.getElementById('btn-group-copy-disk')?.addEventListener('click', onCopyDiskMapping);
    document.getElementById('btn-group-user-export')?.addEventListener('click', onExportConfig);
    document.getElementById('btn-group-user-import')?.addEventListener('click', () => {
        document.getElementById('group-user-file-input')?.click();
    });
    document.getElementById('group-user-file-input')?.addEventListener('change', onImportConfig);

    const bindSearch = (id, key) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            state.filters[key] = el.value || '';
            renderAll();
        });
    };

    bindSearch('group-user-search-groups', 'groups');
    bindSearch('group-user-search-disks', 'disks');
    bindSearch('group-user-search-users', 'users');

    document.getElementById('group-user-group-switch')?.addEventListener('change', (e) => {
        const teamName = String(e.target?.value || '').trim();
        state.selectedTeamSpace = teamName || null;
        state.selectedDiskId = null;
        state.selectedGroupId = null;
        renderAll();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
}

function openModal() {
    createModalShell();
    const modal = document.getElementById('group-user-modal');
    if (!modal) return;
    syncFilterInputs();
    modal.classList.add('visible');
    document.body.classList.add('group-user-modal-open');
}

function closeModal() {
    const modal = document.getElementById('group-user-modal');
    if (!modal) return;
    modal.classList.remove('visible');
    document.body.classList.remove('group-user-modal-open');
}

function onAddGroup() {
    const group = {
        id: `group_${Date.now()}`,
        name: nextGroupName(),
        diskUsers: {},
    };
    state.config.groups.push(group);
    state.config.groups.sort((a, b) => a.name.localeCompare(b.name));
    state.selectedGroupId = group.id;
    state.selectedDiskId = null;
    persistConfigAndBroadcast();
    renderAll();
}

function onRenameGroup(groupId) {
    const g = state.config.groups.find(x => x.id === groupId);
    if (!g) return;
    const next = prompt('Rename group', g.name);
    if (next === null) return;
    const name = String(next || '').trim();
    if (!name) return;
    g.name = name;
    state.config.groups.sort((a, b) => a.name.localeCompare(b.name));
    persistConfigAndBroadcast();
    renderAll();
}

function onRemoveGroup(groupId) {
    const g = state.config.groups.find(x => x.id === groupId);
    if (!g) return;
    const ok = confirm(`Delete group "${g.name}"? This only affects your personal grouping view.`);
    if (!ok) return;

    state.config.groups = state.config.groups.filter(x => x.id !== groupId);
    ensureDefaultGroup();
    state.selectedGroupId = state.config.groups[0]?.id || null;
    state.selectedDiskId = null;
    persistConfigAndBroadcast();
    renderAll();
}

function toggleDisk(group, diskId) {
    if (!group) return;

    if (group.diskUsers[diskId]) {
        const ok = confirm(`Remove disk from group "${group.name}"?`);
        if (!ok) return;
        delete group.diskUsers[diskId];
        if (state.selectedDiskId === diskId) state.selectedDiskId = null;
    } else {
        group.diskUsers[diskId] = [];
        state.selectedDiskId = diskId;
    }

    persistConfigAndBroadcast();
    renderAll();
}

function removeUserFromOtherGroupsForDisk(userName, diskId, keepGroupId) {
    state.config.groups.forEach((g) => {
        if (g.id === keepGroupId) return;
        const list = Array.isArray(g.diskUsers?.[diskId]) ? g.diskUsers[diskId] : null;
        if (!list) return;
        g.diskUsers[diskId] = list.filter(u => u !== userName);
    });
}

function ensureGroupByName(groupName) {
    const normalized = String(groupName || '').trim();
    if (!normalized) return null;
    let group = state.config.groups.find((g) => String(g.name || '').trim().toLowerCase() === normalized.toLowerCase());
    if (group) return group;
    group = {
        id: `group_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        name: normalized,
        diskUsers: {},
    };
    state.config.groups.push(group);
    state.config.groups.sort((a, b) => a.name.localeCompare(b.name));
    return group;
}

function applySystemGroupsSeedForDisk(diskId, systemGroups, allUsers = []) {
    const id = String(diskId || '').trim();
    if (!id) return false;
    if (!Array.isArray(systemGroups) || systemGroups.length === 0) return false;
    const hasAnyAssignment = state.config.groups.some((g) => Array.isArray(g.diskUsers?.[id]) && g.diskUsers[id].length > 0);
    const alreadySeeded = !!(state.config.seeded_disks && state.config.seeded_disks[id]);
    // Recovery path: older/broken configs may mark seeded but contain no assignments.
    const shouldSeed = !alreadySeeded || !hasAnyAssignment;
    if (!shouldSeed) return false;

    let changed = false;
    const systemAssigned = new Set();
    systemGroups.forEach((sg) => {
        const users = Array.isArray(sg.users) ? sg.users : [];
        if (users.length === 0) return;
        users.forEach((u) => systemAssigned.add(String(u || '').trim()));
        const group = ensureGroupByName(sg.name);
        if (!group) return;
        if (Array.isArray(group.diskUsers[id]) && group.diskUsers[id].length > 0) return;
        group.diskUsers[id] = [...new Set(users)].sort((a, b) => a.localeCompare(b));
        changed = true;
    });

    // Seed "Other" with users outside system groups on first seed.
    const normalizedUsers = Array.isArray(allUsers)
        ? [...new Set(allUsers.map((u) => String(u || '').trim()).filter(Boolean))]
        : [];
    const otherUsers = normalizedUsers.filter((u) => !systemAssigned.has(u));
    if (otherUsers.length > 0) {
        const otherGroup = ensureGroupByName('Other');
        if (otherGroup && (!Array.isArray(otherGroup.diskUsers[id]) || otherGroup.diskUsers[id].length === 0)) {
            otherGroup.diskUsers[id] = otherUsers.slice().sort((a, b) => a.localeCompare(b));
            changed = true;
        }
    }

    if (!state.config.seeded_disks || typeof state.config.seeded_disks !== 'object') {
        state.config.seeded_disks = {};
    }
    state.config.seeded_disks[id] = true;
    return changed;
}

function onCopyDiskMapping() {
    const sourceDiskId = String(state.selectedDiskId || '').trim();
    if (!sourceDiskId) {
        showToast('Copy mapping', 'Select a source disk first.', 'warning');
        return;
    }

    const sourceDisk = state.catalogDisks.find((d) => d.id === sourceDiskId);
    const candidates = state.catalogDisks.filter((d) => d.id !== sourceDiskId);
    if (candidates.length === 0) {
        showToast('Copy mapping', 'No target disk found.', 'warning');
        return;
    }

    const input = prompt(`Copy all group mappings from "${sourceDisk?.name || sourceDiskId}" to disk (ID or name):`, candidates[0].name);
    if (input === null) return;
    const needle = String(input || '').trim().toLowerCase();
    if (!needle) return;

    const targetDisk = candidates.find((d) => d.id.toLowerCase() === needle)
        || candidates.find((d) => d.name.toLowerCase() === needle)
        || candidates.find((d) => d.name.toLowerCase().includes(needle))
        || candidates.find((d) => d.id.toLowerCase().includes(needle));
    if (!targetDisk) {
        showToast('Copy mapping', 'Target disk not found.', 'warning');
        return;
    }

    state.config.groups.forEach((g) => {
        const srcUsers = Array.isArray(g.diskUsers?.[sourceDiskId]) ? g.diskUsers[sourceDiskId] : [];
        if (srcUsers.length === 0) {
            delete g.diskUsers[targetDisk.id];
            return;
        }
        g.diskUsers[targetDisk.id] = [...new Set(srcUsers)].sort((a, b) => a.localeCompare(b));
    });

    if (state.config.seeded_disks && typeof state.config.seeded_disks === 'object') {
        state.config.seeded_disks[targetDisk.id] = true;
    }
    state.selectedDiskId = targetDisk.id;
    persistConfigAndBroadcast();
    renderAll();
    showToast('Copy mapping', `Copied mapping to ${targetDisk.name}.`, 'success');
}

function toggleUser(group, diskId, userName) {
    if (!group || !group.diskUsers[diskId]) return;

    const set = new Set(group.diskUsers[diskId]);
    if (set.has(userName)) {
        const ok = confirm(`Remove user "${userName}" from group "${group.name}"?`);
        if (!ok) return;
        set.delete(userName);
    } else {
        // Rule: one user belongs to only one group per disk.
        removeUserFromOtherGroupsForDisk(userName, diskId, group.id);
        set.add(userName);
    }

    group.diskUsers[diskId] = Array.from(set).sort((a, b) => a.localeCompare(b));
    persistConfigAndBroadcast();
    renderAll();
}

function moveUserToGroup(userName, diskId, targetGroupId) {
    const name = String(userName || '').trim();
    const disk = String(diskId || '').trim();
    const targetId = String(targetGroupId || '').trim();
    if (!name || !disk || !targetId) return;

    const target = state.config.groups.find((g) => String(g.id || '') === targetId);
    if (!target) return;

    removeUserFromOtherGroupsForDisk(name, disk, target.id);
    if (!Array.isArray(target.diskUsers[disk])) target.diskUsers[disk] = [];
    if (!target.diskUsers[disk].includes(name)) {
        target.diskUsers[disk].push(name);
        target.diskUsers[disk].sort((a, b) => a.localeCompare(b));
    }

    state.selectedGroupId = target.id;
    persistConfigAndBroadcast();
    renderAll();
}

function renderGroups() {
    const container = document.getElementById('group-user-groups');
    if (!container) return;

    const selectedTeamSpace = String(state.selectedTeamSpace || '').trim();
    if (!selectedTeamSpace) {
        container.innerHTML = '<div class="group-user-empty">Select a team space first.</div>';
        return;
    }

    const diskId = String(state.selectedDiskId || '').trim();
    if (!diskId) {
        container.innerHTML = '<div class="group-user-empty">Select a disk to load groups.</div>';
        return;
    }

    const loadedPayload = state.usersByDisk.get(diskId);
    const systemRows = getSystemGroupRowsForDisk(diskId);
    if (systemRows.length === 0) {
        container.innerHTML = loadedPayload
            ? '<div class="group-user-empty">No system groups found for this disk.</div>'
            : '<div class="group-user-empty">Loading system groups...</div>';
        return;
    }

    if (state.selectedGroupId && !systemRows.some((r) => r.id === state.selectedGroupId)) {
        state.selectedGroupId = null;
    }

    const rows = getFilteredRows(systemRows, 'name', state.filters.groups);
    container.innerHTML = rows.map((g) => {
        const isActive = g.id === state.selectedGroupId;
        return `
            <button class="group-user-row ${isActive ? 'active' : ''}" data-group-id="${g.id}" data-drop-group-id="${g.id}" type="button">
                <span class="group-user-row-main">${g.name}</span>
                <span class="group-user-row-meta">${g.userCount} users</span>
            </button>
        `;
    }).join('') || '<div class="group-user-empty">No team space matched.</div>';

    container.querySelectorAll('[data-group-id]').forEach((el) => {
        el.addEventListener('click', () => {
            state.selectedGroupId = el.getAttribute('data-group-id');
            renderAll();
        });
    });

    container.querySelectorAll('[data-drop-group-id]').forEach((el) => {
        el.addEventListener('dragover', (e) => {
            if (!state.dragUser) return;
            e.preventDefault();
            el.classList.add('drag-over');
        });
        el.addEventListener('dragleave', () => {
            el.classList.remove('drag-over');
        });
        el.addEventListener('drop', (e) => {
            if (!state.dragUser) return;
            e.preventDefault();
            el.classList.remove('drag-over');
            const targetGroupId = el.getAttribute('data-drop-group-id');
            const diskId = String(state.selectedDiskId || '').trim();
            moveUserToGroup(state.dragUser.name, diskId, targetGroupId);
            state.dragUser = null;
        });
    });
}

function getSystemGroupRowsForDisk(diskId) {
    const id = String(diskId || '').trim();
    if (!id) return [];
    const systemGroups = state.systemGroupsByDisk.get(id) || [];
    const rows = Array.isArray(systemGroups) ? systemGroups.map((sg) => {
        const group = ensureGroupByName(sg.name);
        const normalizedName = String(group.name || '').trim().toLowerCase();
        const diskCount = state.catalogDisks.filter((disk) => {
            const teams = Array.isArray(disk?.teamNames) ? disk.teamNames : [];
            return teams.some((tn) => String(tn || '').toLowerCase().includes(normalizedName));
        }).length;
        const sysCount = Number(sg?.count || 0);
        const fallbackUsers = Array.isArray(sg?.users) ? sg.users.length : 0;
        const configuredUsers = Array.isArray(group.diskUsers?.[id]) ? group.diskUsers[id].length : null;
        const userCount = configuredUsers !== null ? configuredUsers : Math.max(0, sysCount || fallbackUsers);
        return {
            id: group.id,
            name: group.name,
            diskCount,
            userCount,
        };
    }) : [];

    // Always expose synthetic "Other" bucket for users that are not in any system group.
    const hasOther = rows.some((r) => String(r?.name || '').trim().toLowerCase() === 'other');
    if (!hasOther) {
        const payload = state.usersByDisk.get(id);
        const allUsers = Array.isArray(payload?.users) ? payload.users : [];
        const groupedUsers = new Set();
        (Array.isArray(systemGroups) ? systemGroups : []).forEach((sg) => {
            const users = Array.isArray(sg?.users) ? sg.users : [];
            users.forEach((u) => groupedUsers.add(String(u || '').trim()));
        });
        const otherUserCount = allUsers.filter((u) => {
            const name = String(u || '').trim();
            return name !== '' && !groupedUsers.has(name);
        }).length;
        const otherGroup = ensureGroupByName('Other');
        const configuredOtherUsers = Array.isArray(otherGroup?.diskUsers?.[id]) ? otherGroup.diskUsers[id].length : null;
        rows.push({
            id: otherGroup.id,
            name: otherGroup.name,
            diskCount: 0,
            userCount: configuredOtherUsers !== null ? configuredOtherUsers : otherUserCount,
        });
    }

    return rows;
}

function renderHeaderGroupSwitch() {
    const select = document.getElementById('group-user-group-switch');
    if (!select) return;

    const teamSpaceCounts = new Map();
    state.catalogDisks.forEach((disk) => {
        const teams = Array.isArray(disk?.teamNames) ? disk.teamNames : [];
        teams.forEach((tn) => {
            const name = String(tn || '').trim();
            if (!name) return;
            teamSpaceCounts.set(name, (teamSpaceCounts.get(name) || 0) + 1);
        });
    });
    const rows = Array.from(teamSpaceCounts.entries())
        .map(([name, diskCount]) => ({ name, diskCount }))
        .sort((a, b) => a.name.localeCompare(b.name));

    if (rows.length === 0) {
        select.innerHTML = '<option value="">No team spaces</option>';
        select.disabled = true;
        return;
    }

    if (!state.selectedTeamSpace || !rows.some((r) => r.name === state.selectedTeamSpace)) {
        state.selectedTeamSpace = null;
    }

    select.disabled = false;
    select.innerHTML = [
        '<option value="">Select team space...</option>',
        ...rows.map((r) => {
            const selected = r.name === state.selectedTeamSpace ? ' selected' : '';
            return `<option value="${r.name}"${selected}>${r.name} (${r.diskCount})</option>`;
        }),
    ].join('');
}

function renderDisks() {
    const container = document.getElementById('group-user-disks');
    if (!container) return;

    const selectedTeamSpace = String(state.selectedTeamSpace || '').trim().toLowerCase();
    if (!selectedTeamSpace) {
        container.innerHTML = '<div class="group-user-empty">Select a team space first.</div>';
        state.selectedDiskId = null;
        const copyBtn = document.getElementById('btn-group-copy-disk');
        if (copyBtn) {
            copyBtn.disabled = true;
            copyBtn.title = 'Select a disk first';
        }
        return;
    }

    let rows = getFilteredRows(state.catalogDisks, 'name', state.filters.disks);
    rows = rows.filter((disk) => {
        const teams = Array.isArray(disk.teamNames) ? disk.teamNames : [];
        return teams.some((tn) => String(tn || '').toLowerCase() === selectedTeamSpace);
    });

    // Keep selected disk/group consistent with current team-space filter.
    if (state.selectedDiskId && !rows.some((d) => d.id === state.selectedDiskId)) {
        state.selectedDiskId = null;
        state.selectedGroupId = null;
    }

    container.innerHTML = rows.map((disk) => {
        const active = state.selectedDiskId === disk.id;
        const teamText = disk.teamNames?.join(', ') || 'Unknown Team';
        return `
            <button class="group-user-row ${active ? 'active' : ''}" data-disk-id="${disk.id}" type="button">
                <span class="group-user-row-main">${disk.name}</span>
                <span class="group-user-row-meta" title="${teamText}">${teamText}</span>
            </button>
        `;
    }).join('') || '<div class="group-user-empty">No disk matched this team space.</div>';

    container.querySelectorAll('[data-disk-id]').forEach((el) => {
        el.addEventListener('click', async () => {
            const diskId = el.getAttribute('data-disk-id');
            state.selectedDiskId = diskId;
            state.selectedGroupId = null;
            renderAll();
            try {
                const payload = await loadUsersForDisk(diskId);
                const changed = applySystemGroupsSeedForDisk(diskId, payload.systemGroups || [], payload.users || []);
                if (changed) persistConfigAndBroadcast();
            } catch (_err) {
                // non-blocking: still allow UI switching
            }
            renderAll();
        });
    });

    const copyBtn = document.getElementById('btn-group-copy-disk');
    if (copyBtn) {
        copyBtn.disabled = !state.selectedDiskId;
        copyBtn.title = state.selectedDiskId ? 'Copy current disk mapping to another disk' : 'Select a disk first';
    }
}

function renderUsersLoading() {
    const container = document.getElementById('group-user-users');
    if (!container) return;
    container.innerHTML = '<div class="group-user-empty">Loading users...</div>';
}

function renderUsers() {
    const container = document.getElementById('group-user-users');
    if (!container) return;

    const selectedTeamSpace = String(state.selectedTeamSpace || '').trim();
    if (!selectedTeamSpace) {
        container.innerHTML = '<div class="group-user-empty">Select a team space first.</div>';
        return;
    }

    const diskId = state.selectedDiskId;
    if (!diskId) {
        container.innerHTML = '<div class="group-user-empty">Select a disk first.</div>';
        return;
    }

    const group = getSelectedGroup();
    if (!group) {
        container.innerHTML = '<div class="group-user-empty">Select a group first.</div>';
        return;
    }

    if (!group.diskUsers[diskId]) group.diskUsers[diskId] = [];

    const token = ++state.usersLoadingToken;
    renderUsersLoading();

    loadUsersForDisk(diskId)
        .then((payload) => {
            if (token !== state.usersLoadingToken) return;
            const systemGroups = Array.isArray(payload?.systemGroups) ? payload.systemGroups : [];
            const allUsers = Array.isArray(payload?.users) ? payload.users : [];
            const seeded = applySystemGroupsSeedForDisk(diskId, systemGroups, allUsers);
            if (seeded) {
                persistConfigAndBroadcast();
            }

            const currentGroup = getSelectedGroup();
            const memberList = Array.isArray(currentGroup?.diskUsers?.[diskId]) ? currentGroup.diskUsers[diskId] : [];
            const filteredUsers = getFilteredRows(memberList.map((name) => ({ name })), 'name', state.filters.users).map((x) => x.name);

            if (filteredUsers.length === 0) {
                container.innerHTML = '<div class="group-user-empty">No users in this group.</div>';
                return;
            }

            container.innerHTML = filteredUsers.map((user) => `
                <div class="group-user-row included" data-user-name="${encodeURIComponent(user)}" draggable="true">
                    <span class="group-user-row-main">${user}</span>
                </div>
            `).join('');

            container.querySelectorAll('[data-user-name]').forEach((el) => {
                el.addEventListener('dragstart', (e) => {
                    const encoded = el.getAttribute('data-user-name');
                    if (!encoded) return;
                    const userName = decodeURIComponent(encoded);
                    state.dragUser = { name: userName, fromGroupId: state.selectedGroupId };
                    if (e.dataTransfer) {
                        e.dataTransfer.setData('text/plain', userName);
                        e.dataTransfer.effectAllowed = 'move';
                    }
                });
                el.addEventListener('dragend', () => {
                    state.dragUser = null;
                    document.querySelectorAll('.group-user-row.drag-over').forEach((node) => node.classList.remove('drag-over'));
                });
            });
        })
        .catch((err) => {
            if (token !== state.usersLoadingToken) return;
            container.innerHTML = `<div class="group-user-empty">Failed to load users: ${err.message || 'Unknown error'}</div>`;
        });
}

function renderAll() {
    renderHeaderGroupSwitch();
    renderDisks();
    renderGroups();
    renderUsers();
}

function onExportConfig() {
    try {
        const payload = {
            schema_version: CURRENT_SCHEMA_VERSION,
            exported_at: new Date().toISOString(),
            app: 'disk_usage',
            groups: state.config.groups,
        };
        const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
        const a = document.createElement('a');
        a.setAttribute('href', dataStr);
        a.setAttribute('download', EXPORT_FILE);
        document.body.appendChild(a);
        a.click();
        a.remove();
    } catch {
        showToast('Export failed', 'Could not export Group User config.', 'error');
    }
}

function onImportConfig(e) {
    const file = e.target?.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const parsed = JSON.parse(String(ev.target?.result || '{}'));
            const clean = sanitizeConfig(parsed);
            if (!clean.groups.length) throw new Error('No groups in imported file');
            state.config = clean;
            state.selectedGroupId = clean.groups[0]?.id || null;
            state.selectedDiskId = null;
            persistConfigAndBroadcast();
            renderAll();
            showToast('Import success', `Loaded config schema v${CURRENT_SCHEMA_VERSION}.`, 'success');
        } catch (err) {
            showToast('Import failed', err?.message || 'Invalid JSON config file.', 'error');
        }
    };
    reader.readAsText(file);
    e.target.value = '';
}

async function openGroupUserModalFlow() {
    closeSettingsDropdown();
    ensureDefaultGroup();
    resetModalFilters();

    try {
        await loadDiskCatalog();
    } catch (err) {
        showToast('Failed to load disks', err.message || 'Could not load disk list.', 'error');
        return;
    }

    state.selectedTeamSpace = null;
    state.selectedDiskId = null;
    state.selectedGroupId = null;

    openModal();
    renderAll();
}

async function bootstrapConfig() {
    ensureDefaultGroup();

    try {
        const serverConfig = await loadServerConfig();

        if (serverConfig.groups.length > 0) {
            state.config = serverConfig;
            normalizeAndSaveLocal();
        } else if (state.config.groups.length > 0) {
            // Keep local config and push it to server if server is still empty.
            scheduleServerSave();
        }
    } catch (_err) {
        // Keep local config fallback silently.
    }

    ensureDefaultGroup();
    state.selectedGroupId = state.config.groups[0]?.id || null;
    emitConfigEvent('groupUserConfigReady');
}

function init() {
    const btn = document.getElementById('btn-open-group-user');
    if (!btn) return;

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openGroupUserModalFlow();
    });

    bootstrapConfig();
}

document.addEventListener('DOMContentLoaded', init);
