/**
 * sort.js — Comparison helpers for disk-card sorting.
 *
 * Two call sites use the same sort policy but operate on different shapes:
 *
 *   1. dataFetcher._initSortUI: sorts DOM cards by reading `dataset.usedPct`,
 *      `dataset.freeBytes`, `dataset.name`.
 *   2. dataFetcher._renderTeamComparisonChart: sorts API objects by
 *      `_disk_name`, `general_system.{total,used}`.
 *
 * `compareDiskCards` accepts an extractor that returns
 *   { name, usedPct, free }
 * normalised the same way regardless of underlying shape.
 */

/**
 * Compare two disk-card-like values by the named sort key.
 * @param {*} a
 * @param {*} b
 * @param {string} sortKey  one of "alpha-asc", "alpha-desc", "usage-desc", "free-desc"
 * @param {(item:*) => {name:string, usedPct:number, free:number}} extract
 * @returns {number}
 */
export function compareDiskCards(a, b, sortKey, extract) {
    const A = extract(a);
    const B = extract(b);
    if (sortKey === 'alpha-asc')  return A.name.localeCompare(B.name);
    if (sortKey === 'alpha-desc') return B.name.localeCompare(A.name);
    if (sortKey === 'usage-desc') return B.usedPct - A.usedPct;
    if (sortKey === 'free-desc')  return B.free - A.free;
    return 0;
}

/** Extractor for DOM cards driven by data-* attributes. */
export function extractFromDataset(card) {
    return {
        name: card.dataset.name || '',
        usedPct: parseFloat(card.dataset.usedPct) || 0,
        free: parseFloat(card.dataset.freeBytes) || 0,
    };
}

/** Extractor for API team-data objects. */
export function extractFromApiDisk(d) {
    const sys = d?.general_system || {};
    const total = sys.total || 0;
    const used = sys.used || 0;
    return {
        name: (d?._disk_name || '').toLowerCase(),
        usedPct: total > 0 ? (used / total) * 100 : 0,
        free: Math.max(0, total - used),
    };
}
