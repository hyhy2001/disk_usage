// group-user/state.js — centralized mutable state for the Group/User feature.
// Single source of truth; sub-modules import `state` by reference and mutate it.
// The config initializer runs at module load, so utils (sanitize/load) must exist first.

import { sanitizeConfig, loadLocalConfigRaw } from './utils.js';

export const state = {
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
