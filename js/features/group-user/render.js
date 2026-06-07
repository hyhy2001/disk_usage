// group-user/render.js — DOM render layer for the Group/User feature.
// Layer D: imports utils + persist + domain + state + escHtml. Never calls on* handlers
// (events are wired via delegation in the orchestrator), so no render↔events cycle.

import { escHtml } from '../../utils/dom.js';
import { getFilteredRows, isOtherGroup, iconTrash } from './utils.js';
import { state } from './state.js';
import { persistConfigAndBroadcast, persistViewState, loadUsersForDisk } from './persist.js';
import {
    getSystemGroupRowsForDisk, getSelectedGroup, applySystemGroupsSeedForDisk,
    computeEffectiveOtherUsersForDisk, getGroupsFromSelectionForDelete,
} from './domain.js';

export function syncFilterInputs() {
    const groupSearch = document.getElementById('group-user-search-groups');
    const diskSearch = document.getElementById('group-user-search-disks');
    const userSearch = document.getElementById('group-user-search-users');
    if (groupSearch) groupSearch.value = state.filters.groups || '';
    if (diskSearch) diskSearch.value = state.filters.disks || '';
    if (userSearch) userSearch.value = state.filters.users || '';
}

export function renderGroups() {
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
                <span class="group-user-row-main">${escHtml(g.name)}</span>
                <span class="group-user-row-meta">${g.userCount} users</span>
            </button>
        `;
    }).join('') || '<div class="group-user-empty">No team space matched.</div>';

}

export function renderHeaderGroupSwitch() {
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
            return `<option value="${escHtml(r.name)}"${selected}>${escHtml(r.name)} (${r.diskCount})</option>`;
        }),
    ].join('');
}

export function renderDisks() {
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
                <span class="group-user-row-main">${escHtml(disk.name)}</span>
                <span class="group-user-row-meta" title="${escHtml(teamText)}">${escHtml(teamText)}</span>
            </button>
        `;
    }).join('') || '<div class="group-user-empty">No disk matched this team space.</div>';

}

export function renderUsersLoading() {
    const container = document.getElementById('group-user-users');
    if (!container) return;
    container.innerHTML = '<div class="group-user-empty">Loading users...</div>';
}

export function renderUsers() {
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
                    <span class="group-user-row-main">${escHtml(user)}</span>
                    ${canRemoveUsers
        ? `<button class="group-user-row-action" data-remove-user="${encodeURIComponent(user)}" type="button" title="Remove user">${iconTrash()}</button>`
        : ''}
                </div>
            `).join('');

        })
        .catch((err) => {
            if (token !== state.usersLoadingToken) return;
            container.innerHTML = `<div class="group-user-empty">Failed to load users: ${escHtml(err.message || 'Unknown error')}</div>`;
        });
}

export function renderAll() {
    renderHeaderGroupSwitch();
    renderDisks();
    renderGroups();
    renderUsers();
    persistViewState();
    syncHeaderActionState();
}

export function syncHeaderActionState() {
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
