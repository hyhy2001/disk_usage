// group-user/utils.js — pure leaf helpers + shared constants for the Group/User feature.
// No `state`, no DOM, no cross-module calls (lowest layer; everything imports from here).

export const STORAGE_KEY = 'du_group_user_config_v2';
export const VIEW_STATE_KEY = 'du_group_user_view_state_v1';
export const EXPORT_FILE = 'group_user_config.v2.json';
export const CURRENT_SCHEMA_VERSION = 3;

export function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

export function utf8ToB64(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

export function b64ToUtf8(str) {
    return decodeURIComponent(escape(atob(str)));
}

export function loadLocalConfigRaw() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('du_group_user_config_v1');
        if (!raw) return { schema_version: CURRENT_SCHEMA_VERSION, groups: [] };
        return JSON.parse(raw);
    } catch {
        return { schema_version: CURRENT_SCHEMA_VERSION, groups: [] };
    }
}

export function sanitizeConfig(parsed) {
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

export function makeDiskCatalog(rawDisks) {
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

export function iconPlus() {
    return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>';
}

export function iconTrash() {
    return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>';
}

export function getFilteredRows(rows, keyName, filterTerm) {
    const q = (filterTerm || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => String(r?.[keyName] || '').toLowerCase().includes(q));
}

export function isOtherGroup(group) {
    return String(group?.name || '').trim().toLowerCase() === 'other';
}

export function normalizeUserList(list) {
    if (!Array.isArray(list)) return [];
    return [...new Set(list.map((u) => String(u || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
}

export function areSortedListsEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

export function buildSystemDefaultAssignmentsForDisk(payload) {
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
