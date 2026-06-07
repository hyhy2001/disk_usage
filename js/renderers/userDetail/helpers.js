// userDetail/helpers.js — pure helpers for the Detail User tab.
// No DOM, no cross-group calls. Only _toAbsoluteDisplayPath reads state (scanRoot).

import { state } from './state.js';

export function _hasExtFilter() {
    return !!(state.currentFilters.ext && String(state.currentFilters.ext).trim() !== '');
}

export function _ext(path) {
    const m = path.match(/\.([a-zA-Z0-9]+)$/);
    return m ? m[1].toLowerCase() : '?';
}

export function _extColor(ext) {
    const map = {
        bin: '#f59e0b', log: '#64748b', gz: '#8b5cf6',
        csv: '#10b981', json: '#06b6d4', txt: '#94a3b8',
    };
    return map[ext] || '#475569';
}

export function _toAbsoluteDisplayPath(p) {
    const strip = (s) => String(s || '').replace(/\/+$/, '');
    if (!p) return strip(state.scanRoot);
    const path = String(p).replace(/\/+$/, '');
    // Already absolute
    if (path.startsWith('/')) return path;
    // Relative path from DB starts with scan root basename (e.g. "def/pathA")
    // Reconstruct absolute: /abc/def + /pathA
    if (state.scanRoot) {
        const rootNorm = strip(state.scanRoot);
        const rootBasename = rootNorm.split('/').pop();
        if (rootBasename && path === rootBasename) return rootNorm;
        if (rootBasename && path.startsWith(rootBasename + '/')) {
            return rootNorm + '/' + path.slice(rootBasename.length + 1);
        }
        // No basename prefix — just join
        return rootNorm + '/' + path;
    }
    return path;
}

export function _normalizeDirRow(d) {
    if (!d || typeof d !== 'object') return { path: '', used: 0 };
    return {
        path: String(d.path || d.p || d.n || ''),
        used: Number(d.used ?? d.s ?? d.size ?? 0) || 0,
    };
}

export function _normalizeFileRow(f) {
    if (!f || typeof f !== 'object') return { path: '', size: 0, used: 0, xt: '' };
    const path = String(f.path || f.p || f.n || '');
    const size = Number(f.size ?? f.s ?? f.used ?? 0) || 0;
    const xt = String(f.xt || f.x || f.ext || _ext(path) || '').toLowerCase();
    return { path, size, used: size, xt };
}

export function _normalizeDirPayload(dir) {
    const src = (dir && typeof dir === 'object') ? dir : {};
    const dirs = Array.isArray(src.dirs)
        ? src.dirs.map(_normalizeDirRow).filter(r => r.path !== '')
        : [];
    return Object.assign({}, src, { dirs });
}

export function _normalizeFilePayload(file) {
    const src = (file && typeof file === 'object') ? file : {};
    const files = Array.isArray(src.files)
        ? src.files.map(_normalizeFileRow).filter(r => r.path !== '')
        : [];
    return Object.assign({}, src, { files });
}

export function _shortPath(path, maxLen = 55) {
    if (path.length <= maxLen) return path;
    const parts = path.split('/');
    return '…/' + parts.slice(-3).join('/');
}

export function _sliderToSize(val) {
    if (val <= 0) return 0;
    const maxLog = Math.log(100 * 1024 * 1024 * 1024);
    return Math.floor(Math.exp((val / 100) * maxLog));
}

// Convert a byte size back to the 0-100 slider value.
export function _sizeToSlider(size) {
    if (size <= 0) return 0;
    const maxLog = Math.log(100 * 1024 * 1024 * 1024);
    const val = (Math.log(size) / maxLog) * 100;
    return Math.min(100, Math.floor(val));
}
