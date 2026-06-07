// userDetail/export.js — CSV (.csv.gz) export for the Detail User tab.
// Depends on state + fetch + helpers + core toasts. No render/event calls.

import { showToast, showProgressToast, updateProgressToast, closeProgressToast } from '../../core/main.js';
import { streamExportGzip } from '../../utils/csvExport.js';
import { state } from './state.js';
import { _fetchExportPage } from './fetch.js';
import { _toAbsoluteDisplayPath, _hasExtFilter } from './helpers.js';

const UD_BTN_SPINNER_SVG = `
<span class="btn-inline-spinner" aria-hidden="true">
    <svg width="13" height="13" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2" opacity="0.28"></circle>
        <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path>
    </svg>
</span>`;

function _exportFileName(kind) {
    const safeUser = String(state.selectedUser || 'user').replace(/[^A-Za-z0-9._-]+/g, '_');
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `${kind}_${safeUser}_${ts}`;
}

async function _startUserCsvExport(kind) {
    if (!state.currentDisk || !state.selectedUser) return;

    const btn = document.querySelector(kind === 'dirs' ? '#ud-export-dirs-user' : '#ud-export-files-user');
    const originalBtnHTML = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = UD_BTN_SPINNER_SVG;
    }

    const toastId = `ud-export-${kind}`;
    showProgressToast(toastId, `Exporting ${kind === 'dirs' ? 'Top Dirs' : 'Top Files'} (.csv.gz)`);

    try {
        const PAGE = kind === 'files' ? 50000 : 20000;
        let rowsExported = 0;
        let finished = false;
        let totalHint = null;
        let cursor = null;

        const headers = kind === 'dirs'
            ? ['User', 'Path', 'Used (bytes)']
            : ['User', 'Path', 'Size (bytes)', 'Extension'];

        if (kind === 'dirs' && _hasExtFilter()) {
            finished = true;
            totalHint = 0;
            updateProgressToast(toastId, 100, '0/0 rows');
        }

        const ok = await streamExportGzip(
            _exportFileName(kind),
            headers,
            async () => {
                if (finished) return { rows: [], isLast: true };

                const payload = await _fetchExportPage(kind, state.currentDisk, state.selectedUser, cursor, PAGE);
                const rows = kind === 'dirs' ? (payload?.dirs || []) : (payload?.files || []);
                cursor = payload?.next_cursor ?? null;
                const rawHint = kind === 'dirs'
                    ? (payload?.total_dirs_full ?? null)
                    : (payload?.total_files_full ?? null);
                if (rawHint !== null && Number(rawHint) > 0) totalHint = Number(rawHint);

                rowsExported += rows.length;
                const hasMore = !!payload?.has_more;
                finished = (rows.length === 0) || !hasMore;

                const pct = totalHint > 0 ? Math.min(100, Math.round((rowsExported / totalHint) * 100)) : (finished ? 100 : 0);
                updateProgressToast(toastId, pct, `${rowsExported.toLocaleString()}/${(totalHint || 0).toLocaleString()} rows`);

                const mapped = rows.map(r => {
                    if (kind === 'dirs') {
                        return {
                            user: state.selectedUser,
                            path: _toAbsoluteDisplayPath(r?.path || ''),
                            used: Number(r?.used || 0),
                        };
                    }
                    return {
                        user: state.selectedUser,
                        path: _toAbsoluteDisplayPath(r?.path || ''),
                        size: Number(r?.size || 0),
                        xt: r?.xt || '',
                    };
                });

                return { rows: mapped, isLast: finished };
            },
            (row, header) => {
                if (kind === 'dirs') {
                    if (header === 'User') return row.user;
                    if (header === 'Path') return row.path;
                    if (header === 'Used (bytes)') return row.used;
                    return '';
                }
                if (header === 'User') return row.user;
                if (header === 'Path') return row.path;
                if (header === 'Size (bytes)') return row.size;
                if (header === 'Extension') return row.xt;
                return '';
            }
        );

        if (!ok) {
            closeProgressToast(toastId);
            showToast('Export Not Supported', 'Your browser does not support stream gzip export. Please use a Chromium-based browser.', 'warning');
            return;
        }

        updateProgressToast(toastId, 100, 'Completed');
        setTimeout(() => closeProgressToast(toastId), 500);
        showToast('Export Completed', `${kind === 'dirs' ? 'Top Dirs' : 'Top Files'} exported as .csv.gz`, 'success');
    } catch (err) {
        closeProgressToast(toastId);
        if (err?.message === 'AbortError') {
            showToast('Export Cancelled', 'Save dialog was closed.', 'info');
        } else {
            showToast('Export Failed', err?.message || 'Unexpected error during export.', 'error');
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalBtnHTML;
        }
    }
}

export async function _udExportDirs() {
    _startUserCsvExport('dirs');
}

export async function _udExportFiles() {
    _startUserCsvExport('files');
}
