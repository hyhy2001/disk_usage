// group-user/domain.js — domain/derivation logic for the Group/User feature.
// Layer C: reads/mutates state.config; imports utils + persist + state. No DOM.

import { isOtherGroup, normalizeUserList, areSortedListsEqual, buildSystemDefaultAssignmentsForDisk } from './utils.js';
import { state } from './state.js';
import { loadDiskCatalog, loadUsersForDisk } from './persist.js';

export function ensureDefaultGroup() {
    if (state.config.groups.length > 0) return;
    state.config.groups.push({
        id: `group_${Date.now()}`,
        name: 'Group 1',
        diskUsers: {},
    });
}

export function getSelectedGroup() {
    const primary = state.config.groups.find(g => g.id === state.selectedGroupId);
    if (primary) return primary;
    const firstSelected = Array.isArray(state.selectedGroupIds) ? state.selectedGroupIds[0] : null;
    if (!firstSelected) return null;
    return state.config.groups.find((g) => g.id === firstSelected) || null;
}

export function nextGroupName() {
    let idx = 1;
    const names = new Set(state.config.groups.map(g => g.name));
    while (names.has(`Group ${idx}`)) idx += 1;
    return `Group ${idx}`;
}

export function getGroupsFromSelectionForDelete() {
    const selected = new Set((Array.isArray(state.selectedGroupIds) ? state.selectedGroupIds : []).filter(Boolean));
    if (selected.size === 0 && state.selectedGroupId) selected.add(state.selectedGroupId);
    return state.config.groups.filter((g) => selected.has(g.id));
}

export function removeUserFromOtherGroupsForDisk(userName, diskId, keepGroupId) {
    state.config.groups.forEach((g) => {
        if (g.id === keepGroupId) return;
        const list = Array.isArray(g.diskUsers?.[diskId]) ? g.diskUsers[diskId] : null;
        if (!list) return;
        g.diskUsers[diskId] = list.filter(u => u !== userName);
    });
}

export function computeEffectiveOtherUsersForDisk(diskId) {
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

export function ensureGroupByName(groupName) {
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

export function applySystemGroupsSeedForDisk(diskId, systemGroups, allUsers = []) {
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

export function getSystemGroupRowsForDisk(diskId) {
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

export async function buildSystemDefaultAssignmentsForAllDisks() {
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

export function buildCurrentAssignmentsByDisk() {
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

export async function buildUserChangesPatch() {
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
