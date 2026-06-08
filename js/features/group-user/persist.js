// group-user/persist.js — persistence/IO layer for the Group/User feature.
// Layer B: imports utils + state + showToast. Never calls render/event code.

import { showToast } from '../../core/main.js';
import {
    STORAGE_KEY, VIEW_STATE_KEY, DIRTY_KEY,
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

// Fetch the server state for group config. New model: the server holds ONE
// official config (set by admins). Returns { official, isAdmin, role } where
// official is a sanitized config or null. Also records admin status in state.
export async function loadServerConfig() {
    const res = await fetchJson('api.php?type=group_config&action=get', { cache: 'no-store' });
    const data = res?.data || {};
    state.isAdmin = !!data.is_admin;
    state.role = data.role || '';
    const official = data.official
        ? sanitizeConfig(data.official)
        : null;
    return { official, isAdmin: state.isAdmin, role: state.role };
}

// Read the admin CSRF token from the admin status endpoint. Saving the official
// config is an admin action gated by the admin session + CSRF (not the guest
// double-submit cookie). Returns '' if not an admin / no token.
async function fetchAdminCsrfToken() {
    try {
        const res = await fetchJson('api.php?type=admin&action=status', { cache: 'no-store' });
        return res?.data?.csrf_token || '';
    } catch {
        return '';
    }
}

// Admin-only: persist the current config as the OFFICIAL server config. Guests
// never call this (their edits stay in localStorage). Throws on failure so the
// caller can surface it.
export async function saveOfficialConfigNow() {
    const csrf = await fetchAdminCsrfToken();
    if (!csrf) throw new Error('Not authenticated as admin.');

    const payload = new URLSearchParams({
        config_b64: utf8ToB64(JSON.stringify(state.config)),
    });
    await fetchJson('api.php?type=group_config&action=save', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'X-CSRF-Token': csrf,
        },
        body: payload.toString(),
        cache: 'no-store',
    });
}

// Debounced official save for admins. On failure, surface a throttled toast.
export function scheduleOfficialSave() {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(async () => {
        try {
            await saveOfficialConfigNow();
        } catch (err) {
            const now = Date.now();
            if ((now - state.saveErrorToastAt) > 5000) {
                state.saveErrorToastAt = now;
                showToast('Official save failed', err?.message || 'Could not save the official Group User config.', 'warning');
            }
        }
    }, 260);
}

// Flush a pending debounced official save immediately (e.g. on modal close) so
// an admin's last edit within the debounce window isn't lost. No-op for guests
// or when nothing is pending.
export function flushOfficialSave() {
    if (!state.isAdmin || !state.saveTimer) return;
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    saveOfficialConfigNow().catch((err) => {
        const now = Date.now();
        if ((now - state.saveErrorToastAt) > 5000) {
            state.saveErrorToastAt = now;
            showToast('Official save failed', err?.message || 'Could not save the official Group User config.', 'warning');
        }
    });
}

// Mark the guest's local copy as a deliberate edit so it wins over the official
// config on the next boot. No-op semantics for admins (they set official).
export function markGuestDirty() {
    state.userDirty = true;
    try { localStorage.setItem(DIRTY_KEY, '1'); } catch { /* ignore quota */ }
}

// Clear the guest dirty flag (used by "reset to official").
export function clearGuestDirty() {
    state.userDirty = false;
    try { localStorage.removeItem(DIRTY_KEY); } catch { /* ignore */ }
}

// Called on every config edit. Admins push to the official server config;
// guests keep a localStorage-only copy and mark it dirty so it persists across
// reloads and overrides the official default for that browser.
export function persistConfigAndBroadcast() {
    state.config.updated_at = new Date().toISOString();
    normalizeAndSaveLocal();
    if (state.isAdmin) {
        scheduleOfficialSave();
    } else {
        markGuestDirty();
    }
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
