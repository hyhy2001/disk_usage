/**
 * filterStorage.js — Persist and restore dashboard filter state via localStorage.
 *
 * Stored keys (all under a single JSON blob):
 *   activeDisk      — string, disk ID (e.g. "disk_sda")
 *   activePage      — "overview" | "detail"
 *   activeTab       — "snapshot" | "history" | "permissions"
 *   dateStart       — ISO date string (e.g. "2026-01-01")
 *   dateEnd         — ISO date string
 *   selectedUsers   — string[] user names
 *   hRangeDays      — number | NaN (NaN = "All")
 *   usersLogScale   — boolean
 *   growersLogScale — boolean
 *   timelineRange   — "7"|"30"|"180"|"365"|"1825"|"all"
 */

const STORAGE_KEY = 'storageos_filters_v1';

/**
 * Merge-save a partial state object — only supplied keys are updated.
 * @param {Partial<FilterState>} partial
 */
export function saveFilters(partial) {
    try {
        const prev = loadFilters();
        const next = { ...prev, ...partial };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (_) {
        // Silently ignore (private mode, quota exceeded, etc.)
    }
}

/**
 * Load the full saved state. Returns an empty object if nothing saved yet.
 * @returns {Partial<FilterState>}
 */
export function loadFilters() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (_) {
        return {};
    }
}

/**
 * Clear all saved filter state.
 */
export function clearFilters() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }
}
