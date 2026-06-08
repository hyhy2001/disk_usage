// group-user/persist.js — persistence/IO layer for the Group/User feature.
// Layer B: imports utils + state + showToast. Never calls render/event code.

import { showToast } from '../../core/main.js';
import {
    STORAGE_KEY, VIEW_STATE_KEY, CURRENT_SCHEMA_VERSION,
    deepClone, utf8ToB64, b64ToUtf8, sanitizeConfig, makeDiskCatalog,
} from './utils.js';
import { state } from './state.js';

export function emitConfigEvent(name) {
    const payload = deepClone(state.config);
    window.__DU_GROUP_CONFIG = payload;
    document.dispatchEvent(new CustomEvent(name, { detail: { config: payload } }));
}

export function loadLocalViewStateRaw() {
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

export function persistViewState() {
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

export function normalizeAndSaveLocal() {
    try {
        state.config = sanitizeConfig(state.config);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
    } catch (err) {
        showToast('Save failed', err?.message || 'Unable to persist Group User config.', 'error');
    }
}

export async function fetchJson(url, options = {}) {
    const finalOptions = Object.assign({ cache: 'no-store' }, options || {});
    const res = await fetch(url, finalOptions);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        return JSON.parse(b64ToUtf8(text));
    }
}

export async function loadServerConfig() {
    const res = await fetchJson('api.php?type=group_config&action=get', { cache: 'no-store' });
    const cfg = res?.data?.config || { schema_version: CURRENT_SCHEMA_VERSION, groups: [] };
    return sanitizeConfig(cfg);
}

// Read the du_csrf cookie the group_config endpoint issues (JS-readable by
// design — see the double-submit note in group_config.php). Returns '' if absent.
function readCsrfCookie() {
    const m = document.cookie.match(/(?:^|;\s*)du_csrf=([0-9a-fA-F]{32})(?:;|$)/);
    return m ? m[1] : '';
}

export async function saveServerConfigNow() {
    const payload = new URLSearchParams({
        config_b64: utf8ToB64(JSON.stringify(state.config)),
    });

    const headers = { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' };
    const csrf = readCsrfCookie();
    if (csrf) headers['X-CSRF-Token'] = csrf;

    await fetchJson('api.php?type=group_config&action=save', {
        method: 'POST',
        headers,
        body: payload.toString(),
        cache: 'no-store',
    });
}

export function scheduleServerSave() {
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

export function persistConfigAndBroadcast() {
    state.config.updated_at = new Date().toISOString();
    normalizeAndSaveLocal();
    scheduleServerSave();
    emitConfigEvent('groupUserConfigChanged');
}

export async function loadDiskCatalog() {
    const raw = await fetchJson('api.php?type=disks', { cache: 'no-store' });
    if (!Array.isArray(raw)) throw new Error('Invalid disks payload');
    state.catalogDisks = makeDiskCatalog(raw);
}

export async function loadUsersForDisk(diskId) {
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
