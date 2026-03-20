// Detail Page Renderer — 2 tabs: Latest Snapshot & History/Analysis
import { AppState } from './main.js';

let _store = null;

// ── Format Helpers ────────────────────────────────────────────────────────

function fmt(bytes) {
    if (bytes === null || bytes === undefined) return '—';
    const TB = 1e12, GB = 1e9, MB = 1e6, KB = 1e3;
    if (bytes >= TB)  return `${(bytes / TB).toFixed(2)} TB`;
    if (bytes >= GB)  return `${(bytes / GB).toFixed(1)} GB`;
    if (bytes >= MB)  return `${(bytes / MB).toFixed(0)} MB`;
    if (bytes >= KB)  return `${(bytes / KB).toFixed(0)} KB`;
    return `${bytes} B`;
}

function fmtDate(ms) {
    return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

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
            <span class="legend-dot dot-amber"></span><span>Scanned ${fmt(scannedBytes)}</span>
            <span class="sep">·</span>
            <span class="legend-dot dot-slate"></span><span>Unknown ${fmt(gapBytes)}</span>
        </div>`;




    const leftCol = [
        section('📦', 'General System', null, stackedBar),
        section('🏷️', 'Team Usage', `${teams.length} teams`, teamRows),
    ].join('');

    const rightCol = [
        section('👤', 'Top 10 Users', `${users.length} total`, userRows),
        section('📁', 'Other Usage', `${other.length} total`, otherRows),
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
            onclick="window._toggleUserFilter(this)">
            <span class="user-filter-check">${sel ? '✓' : ''}</span>
            <span class="user-filter-name">${n}</span>
        </div>`;
    }).join('');

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
                <h3>📊 Usage Matrix</h3>
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

export function applyFilters() {
    const f        = readFilters();
    const chartMgr = AppState.chartManagerInstance;

    // Resolve which users appear in the pivot table / charts
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
            const histTitle = document.querySelector('#historyTotalChart')?.parentElement?.previousElementSibling?.querySelector('.history-chart-title');
            if (histTitle) histTitle.textContent = '📈 Selected Users Usage';
            chartMgr.renderUserTrendChart(_store.userTimelineMap, pivotUsers, f.startMs, f.endMs);
        } else {
            const histTitle = document.querySelector('#historyTotalChart')?.parentElement?.previousElementSibling?.querySelector('.history-chart-title');
            if (histTitle) histTitle.textContent = '📈 Total Disk Usage';
            const filtered = (_store.getTimelineData() || [])
                .filter(d => d.timestamp >= f.startMs && d.timestamp <= f.endMs);
            chartMgr.renderHistoryTotalChart(filtered);
        }

        const growers = _store.getTopUsersByGrowth(f.startMs, f.endMs).slice(0, 10);
        chartMgr.renderTopGrowersChart(growers);
    }

    renderPivotView(_store.getPivotData(f.startMs, f.endMs, pivotUsers));
}

function resetFilters() {
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
    document.querySelectorAll('.detail-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tab;
            // Update button states
            document.querySelectorAll('.detail-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // Show/hide panes
            document.querySelectorAll('.detail-tab-pane').forEach(p => p.classList.remove('active'));
            document.getElementById(`tab-pane-${target}`)?.classList.add('active');
        });
    });
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
    const dr = _store.getDateRange();

    // Init tabs
    initDetailTabs();

    // Stats bar
    renderGeneralSystem();

    // Populate snapshot tab immediately
    renderSnapshotView();

    // History tab init
    initHistoryTab();
}

function initHistoryTab() {
    const dr      = _store.getDateRange();
    const startEl = document.getElementById('filter-date-start');
    const endEl   = document.getElementById('filter-date-end');

    // Default: last 30 days
    const defaultStart = Math.max(dr.min, dr.max - 29 * 86400000);
    if (startEl) startEl.value = toInputDate(defaultStart);
    if (endEl)   endEl.value   = toInputDate(dr.max);

    // Render chips: top-1 active first (onboarding hint), rest inactive
    const top1Name    = _store.getTopUsers(1)[0]?.name;
    const defaultSet  = top1Name ? new Set([top1Name]) : new Set();
    const allNames    = _store.getAllUserNames();
    // Put top by usage first, then alphabetical
    const topNames    = _store.getTopUsers(allNames.length).map(u => u.name);
    const sortedNames = [...topNames, ...allNames.filter(n => !topNames.includes(n))];
    renderUserChips(sortedNames, defaultSet);

    // Preset range buttons
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
        });
    });

    startEl?.addEventListener('change', applyFilters);
    endEl?.addEventListener('change', applyFilters);
    document.getElementById('filter-user-sort')?.addEventListener('change', applyFilters);

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
            const chk = el.querySelector('.user-filter-check');
            if (chk) chk.textContent = '';
        });
        if (wrap?._updateCount) wrap._updateCount();
        applyFilters();
    });

    document.getElementById('user-filter-search')?.addEventListener('input', function() {
        const q = this.value.toLowerCase();
        document.querySelectorAll('#user-chips .user-filter-item').forEach(el => {
            el.style.display = el.dataset.user.toLowerCase().includes(q) ? '' : 'none';
        });
    });

    document.getElementById('btn-reset-filter')?.addEventListener('click', resetFilters);

    applyFilters();
}


// Toggle a filter box item (History tab)
window._toggleUserFilter = function(el) {
    el.classList.toggle('selected');
    const chk = el.querySelector('.user-filter-check');
    if (chk) chk.textContent = el.classList.contains('selected') ? '✓' : '';
    const wrap = document.getElementById('user-chips');
    if (wrap?._updateCount) wrap._updateCount();
    applyFilters();
};

// Legacy compatibility
window.__applyFilters = applyFilters;
