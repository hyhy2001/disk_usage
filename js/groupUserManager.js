import { showToast } from './main.js';

const STORAGE_KEY = 'du_group_user_config_v2';
const VIEW_STATE_KEY = 'du_group_user_view_state_v1';
const EXPORT_FILE = 'group_user_config.v2.json';
const CURRENT_SCHEMA_VERSION = 3;

const state = {
    catalogDisks: [],
    config: sanitizeConfig(loadLocalConfigRaw()),
    selectedTeamSpace: null,
    selectedGroupId: null,
    selectedGroupIds: [],
    selectedDiskId: null,
    usersByDisk: new Map(),
    systemGroupsByDisk: new Map(),
    usersLoadingToken: 0,
    saveTimer: null,
    saveErrorToastAt: 0,
    lastViewStateJson: '',
    filters: {
        groups: '',
        disks: '',
        users: '',
    },
    selectedUserNames: [],
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

function loadLocalViewStateRaw() {
    try {
        const raw = localStorage.getItem(VIEW_STATE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};
        return parsed;
    } catch {
        return {};
    }
}

function persistViewState() {
    const payload = {
        selected_team_space: state.selectedTeamSpace || null,
        selected_disk_id: state.selectedDiskId || null,
        selected_group_id: state.selectedGroupId || null,
        selected_group_ids: Array.isArray(state.selectedGroupIds) ? state.selectedGroupIds.slice() : [],
    };
    const json = JSON.stringify(payload);
    if (json === state.lastViewStateJson) return;
    state.lastViewStateJson = json;
    try {
        localStorage.setItem(VIEW_STATE_KEY, json);
    } catch {
        // Ignore localStorage quota/privacy errors.
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
    const primary = state.config.groups.find(g => g.id === state.selectedGroupId);
    if (primary) return primary;
    const firstSelected = Array.isArray(state.selectedGroupIds) ? state.selectedGroupIds[0] : null;
    if (!firstSelected) return null;
    return state.config.groups.find((g) => g.id === firstSelected) || null;
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

function iconTrash() {
    return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>';
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
                    <button id="btn-group-user-help" class="group-user-toolbar-btn" type="button" title="How to use">?</button>
                    <button id="btn-group-user-import" class="group-user-toolbar-btn" type="button">Import</button>
                    <div class="group-user-export-wrap">
                        <button id="btn-group-user-export" class="group-user-toolbar-btn" type="button">Export</button>
                        <div id="group-user-export-menu" class="group-user-export-menu" style="display:none;">
                            <button id="btn-group-export-changes" class="group-user-export-option" type="button">Changes only</button>
                            <button id="btn-group-export-full" class="group-user-export-option" type="button">Full config</button>
                        </div>
                    </div>
                    <button id="btn-group-user-reset" class="group-user-toolbar-btn" type="button" title="Reset to system defaults">Reset</button>
                    <button id="btn-group-user-close" class="group-user-toolbar-btn group-user-close" type="button" aria-label="Close">x</button>
                </div>
            </div>
            <div class="group-user-modal-body">
                <section class="group-user-pane">
                    <div class="group-user-pane-head"><span>Disks</span></div>
                    <div class="group-user-pane-filter-wrap"><input id="group-user-search-disks" class="group-user-search" placeholder="Search disks..." /></div>
                    <div id="group-user-disks" class="group-user-list"></div>
                </section>
                <section class="group-user-pane">
                    <div class="group-user-pane-head">
                        <span>Groups</span>
                        <div class="group-user-pane-actions">
                            <button id="btn-group-add" class="group-user-mini-btn group-user-mini-icon" type="button" title="Add group">${iconPlus()}</button>
                            <button id="btn-group-remove" class="group-user-mini-btn group-user-mini-icon" type="button" title="Delete selected group">${iconTrash()}</button>
                        </div>
                    </div>
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
    document.getElementById('btn-group-user-help')?.addEventListener('click', onShowGroupUserHelp);
    document.getElementById('btn-group-user-export')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleExportMenu();
    });
    document.getElementById('btn-group-export-changes')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeExportMenu();
        onExportConfig('changes');
    });
    document.getElementById('btn-group-export-full')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeExportMenu();
        onExportConfig('full');
    });
    document.getElementById('btn-group-user-reset')?.addEventListener('click', onResetToSystemDefaults);
    document.getElementById('btn-group-user-import')?.addEventListener('click', () => {
        document.getElementById('group-user-file-input')?.click();
    });
    document.getElementById('group-user-file-input')?.addEventListener('change', onImportConfig);
    document.getElementById('btn-group-add')?.addEventListener('click', onAddGroup);
    document.getElementById('btn-group-remove')?.addEventListener('click', onRemoveGroup);

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
        state.selectedGroupIds = [];
        state.selectedUserNames = [];
        persistViewState();
        renderAll();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
    document.addEventListener('click', (e) => {
        const wrap = document.querySelector('.group-user-export-wrap');
        if (!wrap) return;
        if (e.target && typeof e.target.closest === 'function' && e.target.closest('.group-user-export-wrap')) return;
        closeExportMenu();
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
    closeExportMenu();
}

function toggleExportMenu() {
    const menu = document.getElementById('group-user-export-menu');
    if (!menu) return;
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

function closeExportMenu() {
    const menu = document.getElementById('group-user-export-menu');
    if (!menu) return;
    menu.style.display = 'none';
}

function onAddGroup() {
    const diskId = String(state.selectedDiskId || '').trim();
    if (!diskId) {
        showToast('Add group', 'Select a disk first.', 'warning');
        return;
    }
    const group = {
        id: `group_${Date.now()}`,
        name: nextGroupName(),
        diskUsers: {},
    };
    group.diskUsers[diskId] = [];
    state.config.groups.push(group);
    state.config.groups.sort((a, b) => a.name.localeCompare(b.name));
    state.selectedGroupId = group.id;
    state.selectedGroupIds = [group.id];
    state.selectedUserNames = [];
    persistConfigAndBroadcast();
    persistViewState();
    renderAll();
}

function getGroupsFromSelectionForDelete() {
    const selected = new Set((Array.isArray(state.selectedGroupIds) ? state.selectedGroupIds : []).filter(Boolean));
    if (selected.size === 0 && state.selectedGroupId) selected.add(state.selectedGroupId);
    return state.config.groups.filter((g) => selected.has(g.id));
}

function startInlineRenameGroup(groupId) {
    const group = state.config.groups.find((x) => x.id === groupId);
    if (!group) return;
    if (isOtherGroup(group)) {
        showToast('Rename group', 'Other group cannot be renamed.', 'warning');
        return;
    }

    const row = document.querySelector(`#group-user-groups [data-group-id="${groupId}"]`);
    if (!row) return;
    const nameNode = row.querySelector('.group-user-row-main');
    if (!nameNode) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'group-user-inline-input';
    input.value = group.name;
    nameNode.replaceWith(input);
    input.focus();
    input.select();

    const finish = (commit) => {
        const nextName = String(input.value || '').trim();
        if (!commit) {
            renderAll();
            return;
        }
        if (!nextName || nextName === group.name) {
            renderAll();
            return;
        }
        group.name = nextName;
        state.config.groups.sort((a, b) => a.name.localeCompare(b.name));
        persistConfigAndBroadcast();
        persistViewState();
        renderAll();
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            finish(true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            finish(false);
        }
    });
    input.addEventListener('blur', () => finish(true));
}

function onRemoveGroup() {
    const selectedGroups = getGroupsFromSelectionForDelete();
    if (selectedGroups.length === 0) {
        showToast('Delete group', 'Select one or more groups first.', 'warning');
        return;
    }

    const deletable = selectedGroups.filter((g) => !isOtherGroup(g));
    if (deletable.length === 0) {
        showToast('Delete group', 'Other group cannot be deleted.', 'warning');
        return;
    }

    const ok = confirm(
        deletable.length === 1
            ? `Delete group "${deletable[0].name}"?\nAll users in this group will be moved to Other.`
            : `Delete ${deletable.length} selected groups?\nAll users in deleted groups will be moved to Other.`
    );
    if (!ok) return;

    const otherGroup = ensureGroupByName('Other');
    deletable.forEach((g) => {
        const diskIds = Object.keys(g.diskUsers || {});
        diskIds.forEach((diskId) => {
            const users = Array.isArray(g.diskUsers?.[diskId]) ? g.diskUsers[diskId] : [];
            if (users.length === 0) return;
            if (!Array.isArray(otherGroup.diskUsers[diskId])) otherGroup.diskUsers[diskId] = [];
            const merged = new Set(otherGroup.diskUsers[diskId]);
            users.forEach((u) => {
                const name = String(u || '').trim();
                if (name) merged.add(name);
            });
            otherGroup.diskUsers[diskId] = Array.from(merged).sort((a, b) => a.localeCompare(b));
        });
    });

    const removedIds = new Set(deletable.map((g) => g.id));
    state.config.groups = state.config.groups.filter((x) => !removedIds.has(x.id));
    ensureDefaultGroup();
    state.selectedGroupId = otherGroup?.id || state.config.groups[0]?.id || null;
    state.selectedGroupIds = state.selectedGroupId ? [state.selectedGroupId] : [];
    persistConfigAndBroadcast();
    persistViewState();
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

function isOtherGroup(group) {
    return String(group?.name || '').trim().toLowerCase() === 'other';
}

function computeEffectiveOtherUsersForDisk(diskId) {
    const id = String(diskId || '').trim();
    if (!id) return [];

    const payload = state.usersByDisk.get(id);
    const allUsers = Array.isArray(payload?.users)
        ? [...new Set(payload.users.map((u) => String(u || '').trim()).filter(Boolean))]
        : [];
    if (allUsers.length === 0) return [];

    const assignedOutsideOther = new Set();
    state.config.groups.forEach((g) => {
        if (isOtherGroup(g)) return;
        const users = Array.isArray(g?.diskUsers?.[id]) ? g.diskUsers[id] : [];
        users.forEach((u) => {
            const name = String(u || '').trim();
            if (name) assignedOutsideOther.add(name);
        });
    });

    return allUsers
        .filter((u) => !assignedOutsideOther.has(u))
        .sort((a, b) => a.localeCompare(b));
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
    moveUsersToGroup([userName], diskId, targetGroupId);
}

function moveUsersToGroup(userNames, diskId, targetGroupId) {
    const names = Array.isArray(userNames)
        ? [...new Set(userNames.map((u) => String(u || '').trim()).filter(Boolean))]
        : [];
    const disk = String(diskId || '').trim();
    const targetId = String(targetGroupId || '').trim();
    if (names.length === 0 || !disk || !targetId) return;

    const target = state.config.groups.find((g) => String(g.id || '') === targetId);
    if (!target) return;

    names.forEach((name) => removeUserFromOtherGroupsForDisk(name, disk, target.id));
    if (!Array.isArray(target.diskUsers[disk])) target.diskUsers[disk] = [];
    names.forEach((name) => {
        if (!target.diskUsers[disk].includes(name)) target.diskUsers[disk].push(name);
    });
    target.diskUsers[disk].sort((a, b) => a.localeCompare(b));

    state.selectedGroupId = target.id;
    state.selectedGroupIds = [target.id];
    state.selectedUserNames = [];
    persistConfigAndBroadcast();
    persistViewState();
    renderAll();
}

function onRemoveUserFromSelectedGroup(userName) {
    const diskId = String(state.selectedDiskId || '').trim();
    if (!diskId) return;
    const group = getSelectedGroup();
    if (!group) return;
    if (isOtherGroup(group)) {
        showToast('Remove user', 'Users in Other cannot be deleted. Move them to another group instead.', 'warning');
        return;
    }
    const normalized = String(userName || '').trim();
    if (!normalized) return;
    if (!Array.isArray(group.diskUsers[diskId]) || !group.diskUsers[diskId].includes(normalized)) return;

    const ok = confirm(`Remove user "${normalized}" from group "${group.name}" and move to Other?`);
    if (!ok) return;
    group.diskUsers[diskId] = group.diskUsers[diskId].filter((u) => u !== normalized);

    const otherGroup = ensureGroupByName('Other');
    if (!Array.isArray(otherGroup.diskUsers[diskId])) otherGroup.diskUsers[diskId] = [];
    if (!otherGroup.diskUsers[diskId].includes(normalized)) {
        otherGroup.diskUsers[diskId].push(normalized);
        otherGroup.diskUsers[diskId].sort((a, b) => a.localeCompare(b));
    }
    state.selectedUserNames = state.selectedUserNames.filter((u) => u !== normalized);

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
    state.selectedGroupIds = (Array.isArray(state.selectedGroupIds) ? state.selectedGroupIds : [])
        .filter((id) => systemRows.some((r) => r.id === id));

    const rows = getFilteredRows(systemRows, 'name', state.filters.groups);
    container.innerHTML = rows.map((g) => {
        const isActive = state.selectedGroupIds.includes(g.id);
        const isPrimary = g.id === state.selectedGroupId;
        return `
            <button class="group-user-row ${isActive ? 'active' : ''} ${isPrimary ? 'primary' : ''}" data-group-id="${g.id}" data-drop-group-id="${g.id}" type="button">
                <span class="group-user-row-main">${g.name}</span>
                <span class="group-user-row-meta">${g.userCount} users</span>
            </button>
        `;
    }).join('') || '<div class="group-user-empty">No team space matched.</div>';

    container.querySelectorAll('[data-group-id]').forEach((el) => {
        el.addEventListener('click', (e) => {
            const groupId = el.getAttribute('data-group-id');
            if (!groupId) return;
            if (e.ctrlKey || e.metaKey) {
                const set = new Set(state.selectedGroupIds || []);
                if (set.has(groupId)) set.delete(groupId);
                else set.add(groupId);
                state.selectedGroupIds = Array.from(set);
                state.selectedGroupId = set.has(groupId) ? groupId : (state.selectedGroupIds[0] || null);
            } else {
                state.selectedGroupId = groupId;
                state.selectedGroupIds = [groupId];
            }
            state.selectedUserNames = [];
            persistViewState();
            renderAll();
        });
        el.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const groupId = el.getAttribute('data-group-id');
            if (groupId) startInlineRenameGroup(groupId);
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
            const names = Array.isArray(state.dragUser.names) && state.dragUser.names.length > 0
                ? state.dragUser.names
                : [state.dragUser.name];
            moveUsersToGroup(names, diskId, targetGroupId);
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
        const effectiveOtherUsers = computeEffectiveOtherUsersForDisk(id);
        const otherGroup = ensureGroupByName('Other');
        const configuredOtherUsers = Array.isArray(otherGroup?.diskUsers?.[id]) ? otherGroup.diskUsers[id] : null;
        const otherUserCount = Array.isArray(configuredOtherUsers) && configuredOtherUsers.length > 0
            ? configuredOtherUsers.length
            : effectiveOtherUsers.length;
        rows.push({
            id: otherGroup.id,
            name: otherGroup.name,
            diskCount: 0,
            userCount: otherUserCount,
        });
    }

    // Also show user-created groups mapped to this disk (even if not in system groups list).
    state.config.groups.forEach((g) => {
        const users = Array.isArray(g?.diskUsers?.[id]) ? g.diskUsers[id] : null;
        if (users === null) return;
        if (rows.some((r) => r.id === g.id)) return;
        rows.push({
            id: g.id,
            name: g.name,
            diskCount: 0,
            userCount: users.length,
        });
    });

    rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
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
        state.selectedGroupIds = [];
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
            state.selectedGroupIds = [];
            state.selectedUserNames = [];
            persistViewState();
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
            let memberList = Array.isArray(currentGroup?.diskUsers?.[diskId]) ? currentGroup.diskUsers[diskId] : [];
            if (isOtherGroup(currentGroup) && memberList.length === 0) {
                const effectiveOtherUsers = computeEffectiveOtherUsersForDisk(diskId);
                if (effectiveOtherUsers.length > 0) {
                    currentGroup.diskUsers[diskId] = effectiveOtherUsers;
                    memberList = effectiveOtherUsers;
                    persistConfigAndBroadcast();
                }
            }
            const canRemoveUsers = !isOtherGroup(currentGroup);
            const currentMembers = new Set(memberList.map((u) => String(u || '').trim()).filter(Boolean));
            state.selectedUserNames = (Array.isArray(state.selectedUserNames) ? state.selectedUserNames : [])
                .filter((u) => currentMembers.has(u));
            const filteredUsers = getFilteredRows(memberList.map((name) => ({ name })), 'name', state.filters.users).map((x) => x.name);

            if (filteredUsers.length === 0) {
                container.innerHTML = '<div class="group-user-empty">No users in this group.</div>';
                return;
            }

            container.innerHTML = filteredUsers.map((user) => `
                <div class="group-user-row included ${state.selectedUserNames.includes(user) ? 'active' : ''}" data-user-name="${encodeURIComponent(user)}" draggable="true">
                    <span class="group-user-row-main">${user}</span>
                    ${canRemoveUsers
        ? `<button class="group-user-row-action" data-remove-user="${encodeURIComponent(user)}" type="button" title="Remove user">${iconTrash()}</button>`
        : ''}
                </div>
            `).join('');

            container.querySelectorAll('[data-user-name]').forEach((el) => {
                el.addEventListener('click', (e) => {
                    if (e.target && typeof e.target.closest === 'function' && e.target.closest('[data-remove-user]')) return;
                    const encoded = el.getAttribute('data-user-name');
                    if (!encoded) return;
                    const userName = decodeURIComponent(encoded);
                    if (e.ctrlKey || e.metaKey) {
                        const set = new Set(state.selectedUserNames || []);
                        if (set.has(userName)) set.delete(userName);
                        else set.add(userName);
                        state.selectedUserNames = Array.from(set);
                    } else {
                        state.selectedUserNames = [userName];
                    }
                    renderAll();
                });
                el.addEventListener('dragstart', (e) => {
                    if (e.target && typeof e.target.closest === 'function' && e.target.closest('[data-remove-user]')) return;
                    const encoded = el.getAttribute('data-user-name');
                    if (!encoded) return;
                    const userName = decodeURIComponent(encoded);
                    const selected = Array.isArray(state.selectedUserNames) ? state.selectedUserNames : [];
                    const names = selected.includes(userName) ? selected.slice() : [userName];
                    if (!selected.includes(userName)) state.selectedUserNames = [userName];
                    state.dragUser = { name: userName, names, fromGroupId: state.selectedGroupId };
                    if (e.dataTransfer) {
                        e.dataTransfer.setData('text/plain', names.join('\n'));
                        e.dataTransfer.effectAllowed = 'move';
                    }
                });
                el.addEventListener('dragend', () => {
                    state.dragUser = null;
                    document.querySelectorAll('.group-user-row.drag-over').forEach((node) => node.classList.remove('drag-over'));
                });
            });

            container.querySelectorAll('[data-remove-user]').forEach((el) => {
                el.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const encoded = el.getAttribute('data-remove-user');
                    if (!encoded) return;
                    onRemoveUserFromSelectedGroup(decodeURIComponent(encoded));
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
    persistViewState();
    syncHeaderActionState();
}

function syncHeaderActionState() {
    const hasDisk = !!String(state.selectedDiskId || '').trim();
    const selectedGroups = getGroupsFromSelectionForDelete();
    const hasGroup = selectedGroups.length > 0 || !!getSelectedGroup();
    const hasOtherInSelection = selectedGroups.some((g) => isOtherGroup(g));
    const deletableCount = selectedGroups.filter((g) => !isOtherGroup(g)).length;

    const groupAddBtn = document.getElementById('btn-group-add');
    const groupRemoveBtn = document.getElementById('btn-group-remove');

    if (groupAddBtn) groupAddBtn.disabled = !hasDisk;
    if (groupRemoveBtn) groupRemoveBtn.disabled = !hasGroup || deletableCount === 0 || hasOtherInSelection;
}

function normalizeUserList(list) {
    if (!Array.isArray(list)) return [];
    return [...new Set(list.map((u) => String(u || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
}

function areSortedListsEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function buildSystemDefaultAssignmentsForDisk(payload) {
    const out = {};
    const systemGroups = Array.isArray(payload?.systemGroups) ? payload.systemGroups : [];
    const allUsers = normalizeUserList(Array.isArray(payload?.users) ? payload.users : []);
    const assigned = new Set();

    systemGroups.forEach((sg) => {
        const name = String(sg?.name || '').trim();
        if (!name) return;
        const users = normalizeUserList(Array.isArray(sg?.users) ? sg.users : []);
        out[name] = users;
        users.forEach((u) => assigned.add(u));
    });

    const otherUsers = allUsers.filter((u) => !assigned.has(u));
    out.Other = normalizeUserList([...(out.Other || []), ...otherUsers]);
    return out;
}

async function buildSystemDefaultAssignmentsForAllDisks() {
    if (!Array.isArray(state.catalogDisks) || state.catalogDisks.length === 0) {
        await loadDiskCatalog();
    }
    const byDisk = {};
    for (const disk of state.catalogDisks) {
        const diskId = String(disk?.id || '').trim();
        if (!diskId) continue;
        const payload = await loadUsersForDisk(diskId);
        byDisk[diskId] = buildSystemDefaultAssignmentsForDisk(payload);
    }
    return byDisk;
}

function buildCurrentAssignmentsByDisk() {
    const byDisk = {};
    state.config.groups.forEach((g) => {
        const groupName = String(g?.name || '').trim();
        if (!groupName || !g?.diskUsers || typeof g.diskUsers !== 'object') return;
        Object.keys(g.diskUsers).forEach((diskIdRaw) => {
            const diskId = String(diskIdRaw || '').trim();
            if (!diskId) return;
            if (!Object.prototype.hasOwnProperty.call(g.diskUsers, diskIdRaw)) return;
            const users = normalizeUserList(g.diskUsers[diskIdRaw]);
            if (!byDisk[diskId]) byDisk[diskId] = {};
            byDisk[diskId][groupName] = users;
        });
    });
    return byDisk;
}

async function buildUserChangesPatch() {
    const systemByDisk = await buildSystemDefaultAssignmentsForAllDisks();
    const currentByDisk = buildCurrentAssignmentsByDisk();
    const diskIds = new Set([...Object.keys(systemByDisk), ...Object.keys(currentByDisk)]);
    const changes = {};

    diskIds.forEach((diskId) => {
        const baseGroups = systemByDisk[diskId] || {};
        const currGroups = currentByDisk[diskId] || {};
        const groupNames = new Set([...Object.keys(baseGroups), ...Object.keys(currGroups)]);
        const set = {};
        const unset = [];

        groupNames.forEach((groupName) => {
            const hasBase = Object.prototype.hasOwnProperty.call(baseGroups, groupName);
            const hasCurr = Object.prototype.hasOwnProperty.call(currGroups, groupName);
            const baseUsers = hasBase ? normalizeUserList(baseGroups[groupName]) : null;
            const currUsers = hasCurr ? normalizeUserList(currGroups[groupName]) : null;

            if (!hasBase && !hasCurr) return;
            if (!hasCurr && hasBase) {
                unset.push(groupName);
                return;
            }
            if (hasCurr && !hasBase) {
                set[groupName] = currUsers;
                return;
            }
            if (!areSortedListsEqual(baseUsers, currUsers)) {
                set[groupName] = currUsers;
            }
        });

        if (Object.keys(set).length > 0 || unset.length > 0) {
            changes[diskId] = { set, unset: unset.sort((a, b) => a.localeCompare(b)) };
        }
    });

    return changes;
}

async function applyUserChangesPatch(changes) {
    const systemByDisk = await buildSystemDefaultAssignmentsForAllDisks();
    const knownDiskIds = new Set(Object.keys(systemByDisk));
    const groupMap = new Map();

    Object.keys(systemByDisk).forEach((diskId) => {
        const groups = systemByDisk[diskId] || {};
        Object.keys(groups).forEach((groupName) => {
            if (!groupMap.has(groupName)) groupMap.set(groupName, {});
            groupMap.get(groupName)[diskId] = normalizeUserList(groups[groupName]);
        });
    });

    if (changes && typeof changes === 'object') {
        Object.keys(changes).forEach((diskIdRaw) => {
            const diskId = String(diskIdRaw || '').trim();
            if (!diskId || !knownDiskIds.has(diskId)) return;
            const patch = changes[diskIdRaw] || {};
            const set = patch.set && typeof patch.set === 'object' ? patch.set : {};
            const unset = Array.isArray(patch.unset) ? patch.unset : [];

            unset.forEach((groupNameRaw) => {
                const groupName = String(groupNameRaw || '').trim();
                if (!groupName) return;
                const diskUsers = groupMap.get(groupName);
                if (!diskUsers) return;
                delete diskUsers[diskId];
                if (Object.keys(diskUsers).length === 0) groupMap.delete(groupName);
            });

            Object.keys(set).forEach((groupNameRaw) => {
                const groupName = String(groupNameRaw || '').trim();
                if (!groupName) return;
                if (!groupMap.has(groupName)) groupMap.set(groupName, {});
                groupMap.get(groupName)[diskId] = normalizeUserList(set[groupNameRaw]);
            });
        });
    }

    const groups = Array.from(groupMap.entries())
        .map(([name, diskUsers], idx) => ({
            id: `group_${Date.now()}_${idx + 1}`,
            name,
            diskUsers,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

    state.config = sanitizeConfig({
        schema_version: CURRENT_SCHEMA_VERSION,
        groups,
    });
    ensureDefaultGroup();
    state.selectedGroupId = state.config.groups[0]?.id || null;
    state.selectedGroupIds = state.selectedGroupId ? [state.selectedGroupId] : [];
    state.selectedUserNames = [];
    persistConfigAndBroadcast();
    persistViewState();
    renderAll();
}

async function onExportConfig(mode = 'changes') {
    try {
        const exportMode = String(mode || '').trim().toLowerCase();
        const exportChangesOnly = exportMode !== 'full';

        let payload;
        if (exportChangesOnly) {
            const changes = await buildUserChangesPatch();
            payload = {
                schema_version: CURRENT_SCHEMA_VERSION,
                exported_at: new Date().toISOString(),
                app: 'disk_usage',
                export_kind: 'user_changes_v1',
                basis: 'system_defaults',
                changes,
            };
        } else {
            payload = {
                schema_version: CURRENT_SCHEMA_VERSION,
                exported_at: new Date().toISOString(),
                app: 'disk_usage',
                export_kind: 'full_v2',
                groups: state.config.groups,
            };
        }

        const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
        const a = document.createElement('a');
        a.setAttribute('href', dataStr);
        a.setAttribute('download', exportChangesOnly ? 'group_user_config.changes.v1.json' : EXPORT_FILE);
        document.body.appendChild(a);
        a.click();
        a.remove();
    } catch {
        showToast('Export failed', 'Could not export Group User config.', 'error');
    }
}

async function onResetToSystemDefaults() {
    const ok = confirm('Reset all Group User mappings to system defaults? Your custom groups and assignments will be removed.');
    if (!ok) return;

    state.config = sanitizeConfig({
        schema_version: CURRENT_SCHEMA_VERSION,
        groups: [],
        seeded_disks: {},
    });
    state.selectedGroupId = null;
    state.selectedGroupIds = [];
    state.selectedUserNames = [];

    const diskId = String(state.selectedDiskId || '').trim();
    if (diskId) {
        try {
            const payload = await loadUsersForDisk(diskId);
            const changed = applySystemGroupsSeedForDisk(diskId, payload.systemGroups || [], payload.users || []);
            if (changed) {
                const rows = getSystemGroupRowsForDisk(diskId);
                state.selectedGroupId = rows[0]?.id || null;
                state.selectedGroupIds = state.selectedGroupId ? [state.selectedGroupId] : [];
            }
        } catch (_err) {
            // Non-blocking reset even if a disk payload is temporarily unavailable.
        }
    }

    persistConfigAndBroadcast();
    persistViewState();
    renderAll();
    showToast('Reset complete', 'Group User Config was reset to system defaults.', 'success');
}

function onImportConfig(e) {
    const file = e.target?.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
        try {
            const parsed = JSON.parse(String(ev.target?.result || '{}'));
            const kind = String(parsed?.export_kind || '').trim().toLowerCase();
            if (kind === 'user_changes_v1') {
                await applyUserChangesPatch(parsed?.changes || {});
                showToast('Import success', 'Applied user changes patch on top of system defaults.', 'success');
                return;
            }
            const clean = sanitizeConfig(parsed);
            if (!clean.groups.length) throw new Error('No groups in imported file');
            state.config = clean;
            state.selectedGroupId = clean.groups[0]?.id || null;
            state.selectedGroupIds = state.selectedGroupId ? [state.selectedGroupId] : [];
            state.selectedDiskId = null;
            state.selectedUserNames = [];
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

    const saved = loadLocalViewStateRaw();
    state.selectedTeamSpace = String(saved?.selected_team_space || '').trim() || null;
    state.selectedDiskId = String(saved?.selected_disk_id || '').trim() || null;
    state.selectedGroupId = String(saved?.selected_group_id || '').trim() || null;
    state.selectedGroupIds = Array.isArray(saved?.selected_group_ids)
        ? saved.selected_group_ids.map((id) => String(id || '').trim()).filter(Boolean)
        : (state.selectedGroupId ? [state.selectedGroupId] : []);

    const teams = new Set();
    state.catalogDisks.forEach((disk) => {
        const names = Array.isArray(disk?.teamNames) ? disk.teamNames : [];
        names.forEach((name) => {
            const n = String(name || '').trim();
            if (n) teams.add(n.toLowerCase());
        });
    });
    if (!state.selectedTeamSpace || !teams.has(state.selectedTeamSpace.toLowerCase())) {
        state.selectedTeamSpace = null;
        state.selectedDiskId = null;
        state.selectedGroupId = null;
        state.selectedGroupIds = [];
        state.selectedUserNames = [];
    }

    if (state.selectedTeamSpace && state.selectedDiskId) {
        const selectedTeamSpace = state.selectedTeamSpace.toLowerCase();
        const diskInTeam = state.catalogDisks.some((disk) => {
            if (disk.id !== state.selectedDiskId) return false;
            const names = Array.isArray(disk?.teamNames) ? disk.teamNames : [];
            return names.some((tn) => String(tn || '').toLowerCase() === selectedTeamSpace);
        });
        if (!diskInTeam) {
            state.selectedDiskId = null;
            state.selectedGroupId = null;
            state.selectedGroupIds = [];
            state.selectedUserNames = [];
        }
    }

    if (state.selectedDiskId) {
        try {
            const payload = await loadUsersForDisk(state.selectedDiskId);
            const changed = applySystemGroupsSeedForDisk(state.selectedDiskId, payload.systemGroups || [], payload.users || []);
            if (changed) persistConfigAndBroadcast();
        } catch (_err) {
            // Non-blocking restore path.
        }
    }

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
    state.selectedGroupIds = state.selectedGroupId ? [state.selectedGroupId] : [];
    state.selectedUserNames = [];
    emitConfigEvent('groupUserConfigReady');
}

function onShowGroupUserHelp() {
    alert(
        [
            'Group User Config - Quick guide',
            '',
            '1) Select Team Space and Disk to load groups/users.',
            '2) Groups: click to select one, Ctrl/Cmd+click to multi-select.',
            '3) Double-click a group row to rename inline (except Other).',
            '4) Delete groups: select group(s) then click trash.',
            '   Users in deleted groups are moved to Other automatically.',
            '5) Users: click to select one, Ctrl/Cmd+click to select multiple.',
            '6) Drag selected user(s) and drop into another group to move.',
            '7) Users in Other cannot be deleted; only move them to another group.',
            '8) Export button has 2 modes:',
            '   - Changes only: export only your edits vs system defaults.',
            '   - Full config: export full group mapping.',
            '9) Import supports both file types above.',
            '10) Reset restores mapping back to system defaults.',
        ].join('\n')
    );
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
