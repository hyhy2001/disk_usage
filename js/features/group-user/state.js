// group-user/state.js — centralized mutable state for the Group/User feature.
// Single source of truth; sub-modules import `state` by reference and mutate it.
// The config initializer runs at module load, so utils (sanitize/load) must exist first.

import { sanitizeConfig, loadLocalConfigRaw, DIRTY_KEY } from './utils.js';

export const state = {
    catalogDisks: [],
    config: sanitizeConfig(loadLocalConfigRaw()),
    // Whether the current visitor is an authenticated admin (server-confirmed)
    // and their role. Admins save to the official server config; guests don't.
    isAdmin: false,
    role: '',
    // True once a GUEST has deliberately edited their own config. Persisted in
    // localStorage so it survives reload; makes the guest's local copy win over
    // the official config on boot. Read at module load.
    userDirty: (function () {
        try { return localStorage.getItem(DIRTY_KEY) === '1'; } catch { return false; }
    })(),
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
