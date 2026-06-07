// userDetail/fetch.js — API fetch layer for the Detail User tab.
// Leaf module: depends only on state + helpers (normalize). Calls nothing in render/core.

import { state, FILE_PAGE } from './state.js';
import { _normalizeDirPayload, _normalizeFilePayload } from './helpers.js';

const _inflight = new Map();
export async function _fetchApiText(url, opts = {}) {
    const key = url;
    if (!opts.signal && _inflight.has(key)) return _inflight.get(key);
    const p = fetch(url, { cache: 'no-store', ...opts })
        .then(r => { if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status }); return r.text(); })
        .finally(() => _inflight.delete(key));
    if (!opts.signal) _inflight.set(key, p);
    return p;
}

export function _parseApiJson(text) {
    try {
        return JSON.parse(text);
    } catch (_jsonErr) {
        try {
            return JSON.parse(atob(text));
        } catch (_b64Err) {
            const preview = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
            throw new Error(preview ? `Invalid API response: ${preview}` : 'Invalid API response');
        }
    }
}

export async function _fetchDir(diskId, user, cursor = null, limit = FILE_PAGE) {
    if (state.abortCtrl) state.abortCtrl.abort();
    state.abortCtrl = new AbortController();
    const b64User = btoa(unescape(encodeURIComponent(user)));
    let url = `api.php?id=${encodeURIComponent(diskId)}&type=dirs&user_b64=${encodeURIComponent(b64User)}&limit=${limit}`;
    if (cursor !== null && cursor !== undefined && String(cursor) !== '') url += `&cursor=${encodeURIComponent(cursor)}`;
    if (state.currentFilters.query) url += `&filter_query=${encodeURIComponent(state.currentFilters.query)}`;
    if (state.currentFilters.minSize > 0) url += `&filter_min_size=${state.currentFilters.minSize}`;
    if (state.currentFilters.maxSize > 0) url += `&filter_max_size=${state.currentFilters.maxSize}`;
    const t0 = performance.now();
    const text = await _fetchApiText(url, { signal: state.abortCtrl.signal });
    const t1 = performance.now();
    console.log(`[Detail User] fetchDir: cursor=${cursor} limit=${limit} time=${(t1-t0).toFixed(0)}ms`);
    const json = _parseApiJson(text);
    if (json.status !== 'success') throw new Error(json.message || 'API error');
    return _normalizeDirPayload(json.data.dir);
}

export async function _fetchDetail(diskId, user, dirCursor = null, fileCursor = null, limit = FILE_PAGE) {
    if (state.abortCtrl) state.abortCtrl.abort();
    state.abortCtrl = new AbortController();
    const b64User = btoa(unescape(encodeURIComponent(user)));
    let url = `api.php?id=${encodeURIComponent(diskId)}&type=detail&user_b64=${encodeURIComponent(b64User)}&limit=${limit}`;
    if (dirCursor !== null && dirCursor !== undefined && String(dirCursor) !== '') url += `&dir_cursor=${encodeURIComponent(dirCursor)}`;
    if (fileCursor !== null && fileCursor !== undefined && String(fileCursor) !== '') url += `&file_cursor=${encodeURIComponent(fileCursor)}`;
    if (state.currentFilters.query) url += `&filter_query=${encodeURIComponent(state.currentFilters.query)}`;
    if (state.currentFilters.ext) url += `&filter_ext=${encodeURIComponent(state.currentFilters.ext)}`;
    if (state.currentFilters.minSize > 0) url += `&filter_min_size=${state.currentFilters.minSize}`;
    if (state.currentFilters.maxSize > 0) url += `&filter_max_size=${state.currentFilters.maxSize}`;
    const t0 = performance.now();
    const text = await _fetchApiText(url, { signal: state.abortCtrl.signal });
    const t1 = performance.now();
    console.log(`[Detail User] fetchDetail: dirCursor=${dirCursor} fileCursor=${fileCursor} limit=${limit} time=${(t1-t0).toFixed(0)}ms`);
    const json = _parseApiJson(text);
    if (json.status !== 'success') throw new Error(json.message || 'API error');
    return json.data;
}

export async function _fetchFilePage(diskId, user, cursor = null, limit = FILE_PAGE) {
    const b64User = btoa(unescape(encodeURIComponent(user)));
    let url = `api.php?id=${encodeURIComponent(diskId)}&type=files&user_b64=${encodeURIComponent(b64User)}&limit=${limit}`;
    if (cursor !== null && cursor !== undefined && String(cursor) !== '') url += `&cursor=${encodeURIComponent(cursor)}`;
    if (state.currentFilters.query) url += `&filter_query=${encodeURIComponent(state.currentFilters.query)}`;
    if (state.currentFilters.ext) url += `&filter_ext=${encodeURIComponent(state.currentFilters.ext)}`;
    if (state.currentFilters.minSize > 0) url += `&filter_min_size=${state.currentFilters.minSize}`;
    if (state.currentFilters.maxSize > 0) url += `&filter_max_size=${state.currentFilters.maxSize}`;

    const t0 = performance.now();
    const text = await _fetchApiText(url);
    const t1 = performance.now();
    console.log(`[Detail User] fetchFilePage: cursor=${cursor} limit=${limit} time=${(t1-t0).toFixed(0)}ms`);
    const json = _parseApiJson(text);
    if (json.status !== 'success') throw new Error(json.message || 'API error');
    return _normalizeFilePayload(json.data.file);
}

export async function _fetchUserList(diskId) {
    const url = `api.php?id=${encodeURIComponent(diskId)}&type=users`;
    try {
        const json = await window.appFetcher._fetchJson(url, { cacheTimeMs: 30000 });
        return json?.data?.users || [];
    } catch (_err) {
        return [];
    }
}

export async function _fetchExportPage(kind, diskId, user, cursor = null, limit = 20000) {
    const b64User = btoa(unescape(encodeURIComponent(user)));
    let url = `api.php?id=${encodeURIComponent(diskId)}&type=${kind === 'dirs' ? 'dirs' : 'files'}&user_b64=${encodeURIComponent(b64User)}&limit=${limit}`;
    if (cursor !== null && cursor !== undefined && String(cursor) !== '') url += `&cursor=${encodeURIComponent(cursor)}`;
    if (state.currentFilters.query) url += `&filter_query=${encodeURIComponent(state.currentFilters.query)}`;
    if (kind !== 'dirs' && state.currentFilters.ext) url += `&filter_ext=${encodeURIComponent(state.currentFilters.ext)}`;
    if (state.currentFilters.minSize > 0) url += `&filter_min_size=${state.currentFilters.minSize}`;
    if (state.currentFilters.maxSize > 0) url += `&filter_max_size=${state.currentFilters.maxSize}`;
    const text = await _fetchApiText(url, {});
    const json = _parseApiJson(text);
    if (json.status !== 'success') throw new Error(json.message || 'API error');
    if (kind === 'dirs') return _normalizeDirPayload(json.data.dir);
    return _normalizeFilePayload(json.data.file);
}
