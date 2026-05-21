/**
 * normalize.js — Normalise dir/file payloads coming from the detail API.
 *
 * The PHP backend has historically used different field names for the
 * same concept (path/p/n, used/s/size, ext/x/xt). These helpers map any
 * accepted shape to a single canonical form so renderers don't need to
 * know about legacy keys.
 *
 * Currently used by userDetailRenderer.js.
 */

/** Best-effort filename extension extraction (lowercase, no leading dot). */
export function extractExt(path) {
    const m = String(path || '').match(/\.([a-zA-Z0-9]+)$/);
    return m ? m[1].toLowerCase() : '?';
}

/** Normalise one directory row → { path, used }. */
export function normalizeDirRow(d) {
    if (!d || typeof d !== 'object') return { path: '', used: 0 };
    return {
        path: String(d.path || d.p || d.n || ''),
        used: Number(d.used ?? d.s ?? d.size ?? 0) || 0,
    };
}

/** Normalise one file row → { path, size, used (=size), xt }. */
export function normalizeFileRow(f) {
    if (!f || typeof f !== 'object') return { path: '', size: 0, used: 0, xt: '' };
    const path = String(f.path || f.p || f.n || '');
    const size = Number(f.size ?? f.s ?? f.used ?? 0) || 0;
    const xt = String(f.xt || f.x || f.ext || extractExt(path) || '').toLowerCase();
    return { path, size, used: size, xt };
}

/** Normalise the full `dir` payload, replacing dirs[] with normalised rows. */
export function normalizeDirPayload(dir) {
    const src = (dir && typeof dir === 'object') ? dir : {};
    const dirs = Array.isArray(src.dirs)
        ? src.dirs.map(normalizeDirRow).filter(r => r.path !== '')
        : [];
    return Object.assign({}, src, { dirs });
}

/** Normalise the full `file` payload, replacing files[] with normalised rows. */
export function normalizeFilePayload(file) {
    const src = (file && typeof file === 'object') ? file : {};
    const files = Array.isArray(src.files)
        ? src.files.map(normalizeFileRow).filter(r => r.path !== '')
        : [];
    return Object.assign({}, src, { files });
}
