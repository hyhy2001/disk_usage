import { showToast } from '../../core/main.js';
import { CURRENT_SCHEMA_VERSION, EXPORT_FILE, iconPlus, iconTrash, isOtherGroup, normalizeUserList, sanitizeConfig } from './utils.js';
import { state } from './state.js';
import {
    emitConfigEvent, loadLocalViewStateRaw, persistViewState, normalizeAndSaveLocal,
    loadServerConfig, scheduleServerSave, persistConfigAndBroadcast, loadDiskCatalog, loadUsersForDisk,
} from './persist.js';
import {
    ensureDefaultGroup, ensureGroupByName, removeUserFromOtherGroupsForDisk,
    applySystemGroupsSeedForDisk, getSelectedGroup, getGroupsFromSelectionForDelete,
    getSystemGroupRowsForDisk, nextGroupName, buildSystemDefaultAssignmentsForAllDisks, buildUserChangesPatch,
} from './domain.js';
import { syncFilterInputs, renderAll } from './render.js';

function resetModalFilters() {
    state.filters.groups = '';
    state.filters.disks = '';
    state.filters.users = '';
}










function closeSettingsDropdown() {
    const dropdown = document.getElementById('settings-dropdown');
    if (!dropdown) return;
    dropdown.style.display = 'none';
    dropdown.dataset.visible = 'false';
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

    const usersContainer = document.getElementById('group-user-users');
    if (usersContainer) {
        usersContainer.addEventListener('click', (e) => {
            const removeBtn = e.target && typeof e.target.closest === 'function'
                ? e.target.closest('[data-remove-user]')
                : null;
            if (removeBtn) {
                e.preventDefault();
                e.stopPropagation();
                const encoded = removeBtn.getAttribute('data-remove-user');
                if (!encoded) return;
                onRemoveUserFromSelectedGroup(decodeURIComponent(encoded));
                return;
            }

            const row = e.target && typeof e.target.closest === 'function'
                ? e.target.closest('[data-user-name]')
                : null;
            if (!row) return;

            const encoded = row.getAttribute('data-user-name');
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

        usersContainer.addEventListener('dragstart', (e) => {
            const row = e.target && typeof e.target.closest === 'function'
                ? e.target.closest('[data-user-name]')
                : null;
            if (!row) return;
            if (e.target && typeof e.target.closest === 'function' && e.target.closest('[data-remove-user]')) return;

            const encoded = row.getAttribute('data-user-name');
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

        usersContainer.addEventListener('dragend', () => {
            state.dragUser = null;
            document.querySelectorAll('.group-user-row.drag-over').forEach((node) => node.classList.remove('drag-over'));
        });
    }

    const groupsContainer = document.getElementById('group-user-groups');
    if (groupsContainer) {
        groupsContainer.addEventListener('click', (e) => {
            // Don't run select-group logic on the second click of a double-
            // click sequence — that one is reserved for inline rename. The
            // first click still selects (e.detail === 1); the second click
            // arrives with e.detail === 2 and is followed by a `dblclick`
            // event. Without this guard, renderAll() recreates the row
            // between clicks and the dblclick listener never fires reliably.
            if (e.detail > 1) return;

            const row = e.target && typeof e.target.closest === 'function'
                ? e.target.closest('[data-group-id]')
                : null;
            if (!row) return;

            const groupId = row.getAttribute('data-group-id');
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

        groupsContainer.addEventListener('dblclick', (e) => {
            const row = e.target && typeof e.target.closest === 'function'
                ? e.target.closest('[data-group-id]')
                : null;
            if (!row) return;
            e.preventDefault();
            e.stopPropagation();
            const groupId = row.getAttribute('data-group-id');
            if (groupId) startInlineRenameGroup(groupId);
        });

        groupsContainer.addEventListener('dragover', (e) => {
            const row = e.target && typeof e.target.closest === 'function'
                ? e.target.closest('[data-drop-group-id]')
                : null;
            if (!row || !state.dragUser) return;
            e.preventDefault();
            row.classList.add('drag-over');
        });

        groupsContainer.addEventListener('dragleave', (e) => {
            const row = e.target && typeof e.target.closest === 'function'
                ? e.target.closest('[data-drop-group-id]')
                : null;
            if (!row) return;
            row.classList.remove('drag-over');
        });

        groupsContainer.addEventListener('drop', (e) => {
            const row = e.target && typeof e.target.closest === 'function'
                ? e.target.closest('[data-drop-group-id]')
                : null;
            if (!row || !state.dragUser) return;
            e.preventDefault();
            row.classList.remove('drag-over');
            const targetGroupId = row.getAttribute('data-drop-group-id');
            const diskId = String(state.selectedDiskId || '').trim();
            const names = Array.isArray(state.dragUser.names) && state.dragUser.names.length > 0
                ? state.dragUser.names
                : [state.dragUser.name];
            moveUsersToGroup(names, diskId, targetGroupId);
            state.dragUser = null;
        });
    }

    const disksContainer = document.getElementById('group-user-disks');
    if (disksContainer) {
        disksContainer.addEventListener('click', async (e) => {
            const row = e.target && typeof e.target.closest === 'function'
                ? e.target.closest('[data-disk-id]')
                : null;
            if (!row) return;

            const diskId = row.getAttribute('data-disk-id');
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
            }
            renderAll();
        });
    }

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

export function initGroupUser() {
    const btn = document.getElementById('btn-open-group-user');
    if (!btn) return;

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openGroupUserModalFlow();
    });

    bootstrapConfig();
}
