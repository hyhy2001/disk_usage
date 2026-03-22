// Detail Page Renderer — 2 tabs: Latest Snapshot & History/Analysis
import { AppState } from './main.js';
import { fmt, fmtDate } from './formatters.js';
import { saveFilters, loadFilters } from './filterStorage.js';

let _store = null;

// AbortController: canceled & replaced each time a new disk is loaded (CQ-02)
let _historyAbortCtrl = null;

// Debounce timer for applyFilters (PF-01)
let _applyTimer = null;

function debouncedApplyFilters() {
    clearTimeout(_applyTimer);
    _applyTimer = setTimeout(applyFilters, 150);
}

// ── Format Helpers ────────────────────────────────────────────────────────

function toInputDate(ms) { return new Date(ms).toISOString().split('T')[0]; }

function pct(part, total) { return total ? ((part / total) * 100).toFixed(1) : '0.0'; }

// ── Bar Row ────────────────────────────────────────────────────────────────

function barRow(label, used, total, fillClass = 'fill-emerald') {
    const p   = pct(used, total);
    const cls = parseFloat(p) > 85 ? 'text-rose' : parseFloat(p) > 65 ? 'text-amber' : 'text-emerald';
    return `
    <div class="sbar-row">
        <div class="sbar-name">${label}</div>
        <div class="sbar-track">
            <div class="sbar-fill ${fillClass}" style="width:${Math.min(parseFloat(p), 100)}%"></div>
        </div>
        <span class="sbar-pct ${cls}">${p}%</span>
        <span class="sbar-val">${fmt(used)}</span>
    </div>`;
}

function section(icon, title, badge, content) {
    const badgeHtml = badge !== null ? `<span class="result-count">${badge}</span>` : '';
    return `
    <div class="snapshot-section glass-panel">
        <div class="snapshot-section-header">
            <div class="snapshot-section-title">${icon} ${title}</div>
            ${badgeHtml}
        </div>
        <div class="snapshot-rows">${content}</div>
    </div>`;
}

// ── TAB 1: Latest Snapshot ────────────────────────────────────────────────

function renderSnapshotView() {
    const snap = _store.getLatestSnapshot();
    if (!snap) {
        document.getElementById('tab-snapshot-body').innerHTML =
            '<p class="table-empty">No snapshot data yet.</p>';
        return;
    }

    const { general, teams, users, other } = snap;
    const sys = general.total;   // df -h total (authoritative)
    const usedByDf = general.used;

    // ── General System
    const usedPct = pct(usedByDf, sys);
    const pctCls  = parseFloat(usedPct) > 85 ? 'text-rose' : parseFloat(usedPct) > 65 ? 'text-amber' : 'text-emerald';

    // ── Teams (relative to total disk capacity)
    const teamRows = teams.map(t =>
        barRow(`<span class="team-badge">${t.name}</span>`, t.used, sys, 'fill-sky')
    ).join('') || '<p class="table-empty">No team data.</p>';

    // ── Top 10 Users (relative to total disk capacity)
    const top10 = users.slice(0, 10);
    const userRows = top10.map((u, i) =>
        `<div class="sbar-row">
            <div class="sbar-name"><span class="rank-badge">#${i + 1}</span> <span class="user-name">${u.name}</span></div>
            <div class="sbar-track">
                <div class="sbar-fill fill-sky" style="width:${Math.min(parseFloat(pct(u.used, sys)), 100)}%"></div>
            </div>
            <span class="sbar-pct text-sky">${pct(u.used, sys)}%</span>
            <span class="sbar-val">${fmt(u.used)}</span>
        </div>`
    ).join('') || '<p class="table-empty">No user data.</p>';

    // ── Other Usage (top 10, relative to total)
    const otherRows = other.slice(0, 10).map(o =>
        barRow(o.name, o.used, sys, 'fill-amber')
    ).join('') || '<p class="table-empty">No other usage data in this snapshot.</p>';

    // ── Stacked scan bar: widths as % of TOTAL so amber+slate = used/total (78.9%)
    const scannedBytes  = teams.reduce((s, t) => s + (t.used || 0), 0);
    const gapBytes      = Math.max(0, usedByDf - scannedBytes);
    // Use % of TOTAL so the two segments together fill exactly 'used/total' of the track
    const scannedOfTotal = sys ? ((scannedBytes / sys) * 100).toFixed(2) : 0;
    const gapOfTotal     = sys ? ((gapBytes     / sys) * 100).toFixed(2) : 0;
    const scannedOfUsed  = usedByDf ? ((scannedBytes / usedByDf) * 100).toFixed(1) : 0;
    const gapOfUsed      = usedByDf ? ((gapBytes     / usedByDf) * 100).toFixed(1) : 0;
    const stackedBar = `
        <div class="sbar-row general-row">
            <div class="sbar-name">Used</div>
            <div class="sbar-track sbar-track-stacked">
                <div class="sbar-seg seg-amber" style="width:${scannedOfTotal}%"
                     title="Scanned: ${fmt(scannedBytes)} (${scannedOfUsed}% of used)"></div>
                <div class="sbar-seg seg-slate"  style="width:${gapOfTotal}%"
                     title="Unknown: ${fmt(gapBytes)} (${gapOfUsed}% of used)"></div>
            </div>
            <span class="sbar-pct ${pctCls}">${usedPct}%</span>
            <div class="general-val-col">
                <span class="sbar-val">${fmt(usedByDf)} / ${fmt(sys)}</span>
                <span class="general-free text-sky">Free: ${fmt(general.free)}</span>
            </div>
        </div>
        <div class="general-legend-row">
            <span class="legend-pair"><span class="legend-dot dot-amber"></span><span>Scanned ${fmt(scannedBytes)}</span></span>
            <span class="sep">·</span>
            <span class="legend-pair"><span class="legend-dot dot-slate"></span><span>Unknown ${fmt(gapBytes)}</span></span>
        </div>`;




    const leftCol = [
        section(`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`, 'General System', null, stackedBar),
        section(`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`, 'Team Usage', `${teams.length} teams`, teamRows),
    ].join('');

    const rightCol = [
        section(`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`, 'Top 10 Users', `${users.length} total`, userRows),
        section(`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`, 'Other User', `${other.length} total`, otherRows),
    ].join('');

    document.getElementById('tab-snapshot-body').innerHTML =
        `<div class="snapshot-two-col">
            <div class="snapshot-col">${leftCol}</div>
            <div class="snapshot-col">${rightCol}</div>
        </div>`;
}

// ── TAB 2: History & Analysis ─────────────────────────────────────────────

function readFilters() {
    const dr      = _store.getDateRange();
    const startEl = document.getElementById('filter-date-start');
    const endEl   = document.getElementById('filter-date-end');
    const startMs = startEl?.value ? new Date(startEl.value).getTime() : dr.min;
    const endMs   = endEl?.value   ? new Date(endEl.value).getTime() + 86399999 : dr.max;

    // Filter box item selection
    const selected = Array.from(document.querySelectorAll('#user-chips .user-filter-item.selected'))
        .map(el => el.dataset.user).filter(Boolean);
    const allNames = _store.getAllUserNames();
    // null = all users (auto-sort); [] = none selected; array = explicit
    const selectedUsers = (selected.length > 0 && selected.length < allNames.length)
        ? selected
        : (selected.length === 0 ? [] : null);

    const userSortMode = document.getElementById('filter-user-sort')?.value || 'total';
    return { startMs, endMs, selectedUsers, userSortMode };
}

function renderUserFilterBox(sortedNames, defaultSet) {
    const wrap = document.getElementById('user-chips');
    if (!wrap) return;

    const countEl = document.getElementById('history-user-count');
    const updateCount = () => {
        const n = wrap.querySelectorAll('.user-filter-item.selected').length;
        if (countEl) countEl.textContent = `${n} / ${sortedNames.length}`;
    };
    // Store update fn for reuse
    wrap._updateCount = updateCount;

    wrap.innerHTML = sortedNames.map(n => {
        const sel = defaultSet.has(n);
        return `<div class="user-filter-item${sel ? ' selected' : ''}" data-user="${n}"
            tabindex="0" role="option" aria-selected="${sel}">
            <span class="user-filter-check">${sel ? '✓' : ''}</span>
            <span class="user-filter-name">${n}</span>
        </div>`;
    }).join('');

    // Event delegation — auto-removed when AbortController aborts on disk switch (ACC-03)
    const evtSignal = _historyAbortCtrl?.signal;
    wrap.addEventListener('click', e => {
        const item = e.target.closest('.user-filter-item');
        if (item) _toggleUserFilter(item);
    }, { signal: evtSignal });
    wrap.addEventListener('keydown', e => {
        const item = e.target.closest('.user-filter-item');
        if (item && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            _toggleUserFilter(item);
        }
    }, { signal: evtSignal });

    updateCount();
}

// Keep old name as alias so resetFilters can call it too
const renderUserChips = renderUserFilterBox;

function renderPivotView(pivotData) {
    const { dates, userNames, matrix } = pivotData;

    if (!dates.length || !userNames.length) {
        document.getElementById('detail-view-area').innerHTML =
            '<p class="table-empty">No data for selected range.</p>';
        return;
    }

    // Bar width = usage / total disk capacity (df -h total)
    const totalCap = _store.latestStats.total || 1;

    // Compute trend per user: latest vs prev snapshot in userTimelineMap
    const userTrend = (name) => {
        const tl = _store.userTimelineMap?.get(name);
        if (!tl || tl.length < 2) return null;
        const sorted = [...tl].sort((a, b) => a.timestamp - b.timestamp);
        const prev = sorted[sorted.length - 2].used;
        const curr = sorted[sorted.length - 1].used;
        const delta = curr - prev;
        const pct   = prev ? ((delta / prev) * 100).toFixed(1) : '0.0';
        return { delta, pct };
    };

    const headerCols = userNames.map(u => {
        const t = userTrend(u);
        let badge = '<span class="trend-neutral pivot-trend">→</span>';
        if (t && t.delta > 0) badge = `<span class="trend-up pivot-trend">▲ ${t.pct}%</span>`;
        if (t && t.delta < 0) badge = `<span class="trend-down pivot-trend">▼ ${Math.abs(t.pct)}%</span>`;
        return `<th class="pivot-user-th"><span class="user-name" title="${u}">${u}</span>${badge}</th>`;
    }).join('');

    const rows = dates.map(ts => {
        const row = matrix.get(ts);
        const cells = userNames.map(u => {
            const v  = row.get(u);
            const bp      = (((v || 0) / totalCap) * 100).toFixed(1);
            const tooltip = v !== null
                ? `${fmt(v)} · ${bp}% of ${fmt(totalCap)}`
                : 'No data';
            return `<td class="pivot-cell">
                <span class="pivot-val">${v !== null ? fmt(v) : '—'}</span>
                <div class="pivot-mini-bar" data-tooltip="${tooltip}"><div class="pivot-mini-fill" style="width:${bp}%"></div></div>
            </td>`;
        }).join('');
        return `<tr><td class="pivot-date-cell">${fmtDate(ts)}</td>${cells}</tr>`;
    }).join('');

    document.getElementById('detail-view-area').innerHTML = `
        <div class="result-section">
            <div class="result-section-header">
                <h3><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> Usage Matrix</h3>
                <span class="result-count">${dates.length} days × ${userNames.length} users</span>
            </div>
            <div class="table-wrapper pivot-wrapper" style="overflow-x:auto">
                <table class="pivot-table">
                    <thead><tr><th class="pivot-date-th">Date</th>${headerCols}</tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>`;
}

let _logScale = false;

export function initScaleToggle() {
    const btn = document.getElementById('btn-scale-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
        _logScale = !_logScale;
        btn.textContent = _logScale ? 'Linear' : 'Log';
        btn.classList.toggle('active', _logScale);
        applyFilters();
    });
}

export function applyFilters() {
    if (!_store) return;  // No data — bail early (empty disk or not yet loaded)
    const f        = readFilters();
    const chartMgr = AppState.chartManagerInstance;

    // Persist current filter state
    const startEl = document.getElementById('filter-date-start');
    const endEl   = document.getElementById('filter-date-end');
    const selectedChips = Array.from(document.querySelectorAll('#user-chips .user-filter-item.selected'))
        .map(el => el.dataset.user).filter(Boolean);
    const activeRangeBtn = document.querySelector('.hrange-btn.active');
    saveFilters({
        dateStart: startEl?.value,
        dateEnd: endEl?.value,
        selectedUsers: selectedChips,
        hRangeDays: activeRangeBtn ? activeRangeBtn.dataset.days : '30',
        usersLogScale: _logScale,
    });

    // Resolve which users appear in the charts
    let pivotUsers;
    if (f.selectedUsers?.length) {
        pivotUsers = f.selectedUsers;
    } else if (f.selectedUsers !== null) {
        pivotUsers = [];  // empty selection: show nothing
    } else {
        // Default: sort by growth when no explicit selection
        pivotUsers = _store.getTopUsersByGrowth(f.startMs, f.endMs).map(u => u.name);
    }

    // ── History charts ──────────────────────────────────────────────────────
    if (chartMgr) {
        if (pivotUsers && f.selectedUsers && f.selectedUsers.length > 0) {
            chartMgr.renderUserTrendChart(_store.userTimelineMap, pivotUsers, f.startMs, f.endMs, _logScale);
        } else {
            const filtered = (_store.getTimelineData() || [])
                .filter(d => d.timestamp >= f.startMs && d.timestamp <= f.endMs);
            chartMgr.renderHistoryTotalChart(filtered);
        }

        const growers = _store.getTopUsersByGrowth(f.startMs, f.endMs).slice(0, 10);
        chartMgr.renderTopGrowersChart(growers);
    }

    // Data Table removed — charts are sufficient
    const dva = document.getElementById('detail-view-area');
    if (dva) dva.innerHTML = '';

}

function resetFilters() {
    if (!_store) return;
    const dr  = _store.getDateRange();
    const se  = document.getElementById('filter-date-start');
    const ee  = document.getElementById('filter-date-end');

    // Reset to last 30 days
    const startMs = Math.max(dr.min, dr.max - 29 * 86400000);
    if (se) se.value = toInputDate(startMs);
    if (ee) ee.value = toInputDate(dr.max);

    // Restore top-1 filter item selected
    const top1Set = new Set([_store.getTopUsers(1)[0]?.name].filter(Boolean));
    document.querySelectorAll('#user-chips .user-filter-item').forEach(el => {
        const sel = top1Set.has(el.dataset.user);
        el.classList.toggle('selected', sel);
        const chk = el.querySelector('.user-filter-check');
        if (chk) chk.textContent = sel ? '✓' : '';
    });
    const wrap = document.getElementById('user-chips');
    if (wrap?._updateCount) wrap._updateCount();

    // Highlight 30D preset
    document.querySelectorAll('.hrange-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.hrange-btn[data-days="30"]')?.classList.add('active');

    const sortEl = document.getElementById('filter-user-sort');
    if (sortEl) sortEl.value = 'total';
    applyFilters();
}

// ── Tab switching ──────────────────────────────────────────────────────────

function initDetailTabs() {
    const savedTab = loadFilters().activeTab;

    document.querySelectorAll('.detail-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tab;
            // Update button states
            document.querySelectorAll('.detail-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // Show/hide panes
            document.querySelectorAll('.detail-tab-pane').forEach(p => p.classList.remove('active'));
            document.getElementById(`tab-pane-${target}`)?.classList.add('active');
            saveFilters({ activeTab: target });
        });
    });

    // Restore previously active tab
    if (savedTab) {
        const savedBtn = document.querySelector(`.detail-tab-btn[data-tab="${savedTab}"]`);
        if (savedBtn) savedBtn.click();
    }
}

// ── General stat bar ───────────────────────────────────────────────────────

function renderGeneralSystem() {
    const s  = _store.latestStats;
    const p  = s.total ? ((s.used / s.total) * 100).toFixed(1) : '0';
    const cl = parseFloat(p) > 85 ? '#f43f5e' : '';
    const scanned = (_store.latestSnapshot?.teams || []).reduce((sum, t) => sum + (t.used || 0), 0);

    const setNum = (id, text, color) => {
        const el = document.querySelector(`#${id} .stat-number`);
        if (!el) return;
        el.textContent = text;
        if (color !== undefined) el.style.color = color;
    };

    setNum('shared-stat-total',   fmt(s.total));
    setNum('shared-stat-used',    fmt(s.used));
    setNum('shared-stat-scanned', fmt(scanned));
    setNum('shared-stat-free',    fmt(s.available));
    setNum('shared-stat-pct',     `${p}%`, cl);
}

// ── Init ───────────────────────────────────────────────────────────────────

export function renderDetailTables(dataStore) {
    _store = dataStore;

    // Remove any empty-state overlays left by a previous empty disk
    _clearChartOverlays();

    // Init tabs
    initDetailTabs();

    // Stats bar
    renderGeneralSystem();

    // Populate snapshot tab immediately
    renderSnapshotView();

    // History tab init
    initHistoryTab();
}

// Helper: remove empty overlays injected by resetDashboardToEmpty
function _clearChartOverlays() {
    document.querySelectorAll('.chart-empty-overlay').forEach(el => el.remove());
}

/**
 * Resets the entire dashboard to an empty/clean state.
 * Called when the selected disk has no JSON reports.
 * @param {ChartManager} chartMgr - The ChartManager instance to destroy charts.
 */
export function resetDashboardToEmpty(chartMgr) {
    // 0. Null out the store — prevents lingering event listeners from re-rendering old data
    _store = null;
    // 1. Reset stat cards to —
    ['shared-stat-total', 'shared-stat-used', 'shared-stat-scanned', 'shared-stat-free', 'shared-stat-pct'].forEach(id => {
        const el = document.querySelector(`#${id} .stat-number`);
        if (el) { el.textContent = '—'; el.style.color = ''; }
    });

    // 2. Destroy chart instances first, then clear canvases
    if (chartMgr) {
        // Destroy first so Chart.js stops owning the canvases
        if (chartMgr.timelineChart)     { chartMgr.timelineChart.destroy();     chartMgr.timelineChart     = null; }
        if (chartMgr.teamChart)         { chartMgr.teamChart.destroy();         chartMgr.teamChart         = null; }
        if (chartMgr.usersChart)        { chartMgr.usersChart.destroy();        chartMgr.usersChart        = null; }
        if (chartMgr._histTotalChart)   { chartMgr._histTotalChart.destroy();   chartMgr._histTotalChart   = null; }
        if (chartMgr._histGrowersChart) { chartMgr._histGrowersChart.destroy(); chartMgr._histGrowersChart = null; }
        chartMgr._fullTimeline = null;
        chartMgr._usersData    = null;
        chartMgr._teamData     = null;

        // Then clear the pixel content so no ghost image remains
        ['timelineChart', 'teamChart', 'usersChart', 'historyTotalChart', 'historyGrowersChart'].forEach(id => {
            const canvas = document.getElementById(id);
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        });
    }

    // 3. Timeline stat header
    const tsh = document.getElementById('timeline-stat-header');
    if (tsh) tsh.innerHTML = '<span class="tsh-value">— TB</span>';

    // 4. Period table
    const periodTbody = document.getElementById('overview-period-table');
    if (periodTbody) {
        periodTbody.innerHTML = '<tr><td colspan="8" class="table-empty">No data to calculate trends.</td></tr>';
    }

    // 5. Snapshot tab — styled empty state
    const snapBody = document.getElementById('tab-snapshot-body');
    if (snapBody) {
        snapBody.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                </div>
                <h3>No Snapshot Data</h3>
                <p>This disk has no JSON reports yet. Run a scan to generate data.</p>
            </div>`;
    }

    // 6. History tab — clear controls and show empty state
    const userChips = document.getElementById('user-chips');
    if (userChips) userChips.innerHTML = '';
    const historyUserCount = document.getElementById('history-user-count');
    if (historyUserCount) historyUserCount.textContent = '0 / 0';

    // Clear chart stat text labels
    const growersStatEl = document.getElementById('history-growers-stat');
    if (growersStatEl) growersStatEl.textContent = '';
    const totalStatEl = document.getElementById('history-total-stat');
    if (totalStatEl) totalStatEl.textContent = '';

    // Replace chart panels with empty state message
    const historyChartsArea = document.querySelector('.history-charts-row, .history-content, #tab-pane-detail .charts-row');
    const detailViewArea = document.getElementById('detail-view-area');
    if (detailViewArea) detailViewArea.innerHTML = '';

    // Show empty state inside each chart wrapper so the layout stays intact
    ['historyTotalChart', 'historyGrowersChart'].forEach(id => {
        const canvas = document.getElementById(id);
        const wrapper = canvas?.parentElement;
        if (wrapper) {
            wrapper.style.position = 'relative';
            // Remove any leftover empty-state overlay first
            wrapper.querySelector('.chart-empty-overlay')?.remove();
            const overlay = document.createElement('div');
            overlay.className = 'chart-empty-overlay empty-state';

            overlay.innerHTML = `
                <div class="empty-state-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
                    </svg>
                </div>
                <p style="font-size:0.8rem;margin:0;">No data available</p>`;
            wrapper.appendChild(overlay);
        }
    });
}



function initHistoryTab() {
    // Abort all listeners from the previous disk load to prevent accumulation (CQ-02)
    if (_historyAbortCtrl) _historyAbortCtrl.abort();
    _historyAbortCtrl = new AbortController();
    const { signal } = _historyAbortCtrl;

    const dr      = _store.getDateRange();
    const startEl = document.getElementById('filter-date-start');
    const endEl   = document.getElementById('filter-date-end');
    const saved   = loadFilters();

    // Restore saved date range or default to last 30 days
    const defaultStart = Math.max(dr.min, dr.max - 29 * 86400000);
    if (startEl) startEl.value = saved.dateStart || toInputDate(defaultStart);
    if (endEl)   endEl.value   = saved.dateEnd   || toInputDate(dr.max);

    // Restore log scale
    if (saved.usersLogScale) {
        _logScale = saved.usersLogScale;
        const btn = document.getElementById('btn-scale-toggle');
        if (btn) { btn.textContent = _logScale ? 'Linear' : 'Log'; btn.classList.toggle('active', _logScale); }
    }

    // Determine which users to pre-select
    const allNames  = _store.getAllUserNames();
    const topNames  = _store.getTopUsers(allNames.length).map(u => u.name);
    const sortedNames = [...topNames, ...allNames.filter(n => !topNames.includes(n))];

    const savedUsers = saved.selectedUsers;
    let defaultSet;
    if (savedUsers && savedUsers.length > 0) {
        // Restore previously selected users (only those still in dataset)
        const valid = new Set(allNames);
        defaultSet = new Set(savedUsers.filter(u => valid.has(u)));
    } else {
        const top1Name = _store.getTopUsers(1)[0]?.name;
        defaultSet = top1Name ? new Set([top1Name]) : new Set();
    }
    renderUserChips(sortedNames, defaultSet);

    // Restore active range preset button
    const savedRange = saved.hRangeDays;
    if (savedRange !== undefined) {
        document.querySelectorAll('.hrange-btn').forEach(b => b.classList.remove('active'));
        const matchBtn = document.querySelector(`.hrange-btn[data-days="${savedRange}"]`);
        if (matchBtn) {
            matchBtn.classList.add('active');
            // Re-apply the date range from the saved preset
            const days  = parseInt(savedRange);
            const endMs = dr.max;
            const startMs = isNaN(days) ? dr.min : Math.max(dr.min, endMs - (days - 1) * 86400000);
            if (startEl) startEl.value = toInputDate(startMs);
            if (endEl)   endEl.value   = toInputDate(endMs);
        }
    }

    // Preset range buttons — all use { signal } to auto-cleanup on disk change
    document.querySelectorAll('.hrange-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const days    = parseInt(btn.dataset.days);
            const endMs   = dr.max;
            const startMs = isNaN(days) ? dr.min : Math.max(dr.min, endMs - (days - 1) * 86400000);
            if (startEl) startEl.value = toInputDate(startMs);
            if (endEl)   endEl.value   = toInputDate(endMs);
            document.querySelectorAll('.hrange-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyFilters();
        }, { signal });
    });

    startEl?.addEventListener('change', applyFilters, { signal });
    endEl?.addEventListener('change', applyFilters, { signal });
    document.getElementById('filter-user-sort')?.addEventListener('change', applyFilters, { signal });

    document.getElementById('btn-top10')?.addEventListener('click', () => {
        const top10 = new Set(_store.getTopUsers(10).map(u => u.name));
        const wrap  = document.getElementById('user-chips');
        wrap?.querySelectorAll('.user-filter-item').forEach(el => {
            const sel = top10.has(el.dataset.user);
            el.classList.toggle('selected', sel);
            const chk = el.querySelector('.user-filter-check');
            if (chk) chk.textContent = sel ? '✓' : '';
        });
        if (wrap?._updateCount) wrap._updateCount();
        applyFilters();
    });

    document.getElementById('btn-clear-users')?.addEventListener('click', () => {
        const wrap = document.getElementById('user-chips');
        wrap?.querySelectorAll('.user-filter-item').forEach(el => {
            el.classList.remove('selected');
            el.setAttribute('aria-selected', 'false');
            const chk = el.querySelector('.user-filter-check');
            if (chk) chk.textContent = '';
        });
        if (wrap?._updateCount) wrap._updateCount();
        applyFilters();
    }, { signal });

    document.getElementById('user-filter-search')?.addEventListener('input', function() {
        const q = this.value.toLowerCase();
        document.querySelectorAll('#user-chips .user-filter-item').forEach(el => {
            el.style.display = el.dataset.user.toLowerCase().includes(q) ? '' : 'none';
        });
    }, { signal });

    document.getElementById('btn-reset-filter')?.addEventListener('click', resetFilters, { signal });

    applyFilters();
}


// Toggle a filter box item — module-local, keyboard-accessible, with debounce (ACC-03 + PF-01)
function _toggleUserFilter(el) {
    el.classList.toggle('selected');
    const sel = el.classList.contains('selected');
    el.setAttribute('aria-selected', String(sel));
    const chk = el.querySelector('.user-filter-check');
    if (chk) chk.textContent = sel ? '✓' : '';
    const wrap = document.getElementById('user-chips');
    if (wrap?._updateCount) wrap._updateCount();
    debouncedApplyFilters();
}

// Legacy compatibility
window.__applyFilters = applyFilters;
