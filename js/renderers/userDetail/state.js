// userDetail/state.js — centralized mutable state for the Detail User tab.
// Single source of truth: sub-modules import `state` by reference and mutate its
// properties (object writes propagate across modules; only reassigning a `let`
// binding would not). Immutable page-size/default consts live here too.

export const FILE_PAGE     = 500;  // rows per page
export const DROPDOWN_PAGE = 30;
export const DEFAULT_FILTERS = { query: '', ext: '', minSize: 0, maxSize: 0 };

export const state = {
    selectedUser: null,
    currentDisk: null,
    abortCtrl: null,
    otherUsers: [],
    filePage: 1,
    fileCursorStack: [],
    fileNextCursor: null,
    fileHasMore: false,
    currentSentFileCursor: null,
    dirPage: 1,
    dirCursorStack: [],
    dirNextCursor: null,
    dirHasMore: false,
    currentSentDirCursor: null,
    // Guarded read: a corrupt localStorage value must not throw at module load and
    // white-screen the whole app — fall back to defaults instead.
    currentFilters: (() => {
        try {
            const raw = localStorage.getItem('ud_filters');
            const parsed = raw ? JSON.parse(raw) : null;
            return (parsed && typeof parsed === 'object') ? { ...DEFAULT_FILTERS, ...parsed } : { ...DEFAULT_FILTERS };
        } catch (_) {
            return { ...DEFAULT_FILTERS };
        }
    })(),
    allUserNames: [],
    scanRoot: '',
    dropdownQuery: '',
    dropdownShown: 0,
};
