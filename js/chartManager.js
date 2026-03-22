import { smartFmt, smartFmtTick, pickUnit } from './formatters.js';

/** Chart theme — returns appropriate colors based on current light/dark mode */
function ct() {
    const light = document.documentElement.dataset.theme === 'light';
    return {
        grid:    light ? 'rgba(0,0,0,0.065)' : 'rgba(255,255,255,0.05)',
        gridSm:  light ? 'rgba(0,0,0,0.05)'  : 'rgba(255,255,255,0.04)',
        gridXs:  light ? 'rgba(0,0,0,0.04)'  : 'rgba(255,255,255,0.03)',
        tick:    light ? '#6B7280'            : '#475569',
        tickDim: light ? '#9CA3AF'            : '#94a3b8',
        tipBg:   light ? 'rgba(250,249,246,0.97)' : 'rgba(10,14,20,0.94)',
        tipTitle:light ? '#1F2937'            : '#fbbf24',
        tipBody: light ? '#374151'            : '#cbd5e1',
        tipBdr:  light ? 'rgba(0,0,0,0.08)'  : 'rgba(251,191,36,0.3)',
    };
}

export class ChartManager {
    constructor() {
        this.timelineChart = null;
        this.teamChart = null;
        this.usersChart = null;
        this._histTotalChart   = null;
        this._histGrowersChart = null;
        // Scale states for the two horizontal bar charts
        this._usersLogScale   = false;
        this._growersLogScale = false;
        // Cached datasets for theme-change re-renders
        this._usersData   = null;
        this._growersData = null;
        this._teamData    = null;
        this._teamTotal   = 0;

        // Brand Colors
        this.colors = {
            emerald: '#10b981',
            rose: '#f43f5e',
            sky: '#0ea5e9',
            amber: '#f59e0b',
            slate: '#94a3b8'
        };

        Chart.defaults.font.family = "'Inter', sans-serif";
        this._updateChartDefaults();

        // Re-theme all charts when user toggles light/dark — NO data re-fetch
        document.addEventListener('themeChanged', () => {
            this._updateChartDefaults();
            this._applyThemeToCharts();
        });
    }

    /**
     * Updates chart colors in-place without destroying/recreating charts.
     * Called on theme toggle — keeps data intact, no animation flash.
     */
    _applyThemeToCharts() {
        const colors = ct();
        const isLight = document.documentElement.dataset.theme === 'light';

        // ── Timeline chart ─────────────────────────────────────────────────
        if (this.timelineChart) {
            const canvas = document.getElementById('timelineChart');
            if (canvas) {
                const ctx = canvas.getContext('2d');
                const grad = ctx.createLinearGradient(0, 0, 0, canvas.offsetHeight || 300);
                grad.addColorStop(0,    isLight ? 'rgba(251,191,36,0.55)' : 'rgba(251,191,36,0.26)');
                grad.addColorStop(0.65, isLight ? 'rgba(251,191,36,0.15)' : 'rgba(251,191,36,0.06)');
                grad.addColorStop(1,    isLight ? 'rgba(251,191,36,0.03)' : 'rgba(251,191,36,0.02)');
                if (this.timelineChart.data.datasets[0]) {
                    this.timelineChart.data.datasets[0].backgroundColor = grad;
                }
            }
            // Patch axis/tooltip colors
            const opts = this.timelineChart.options;
            if (opts.scales?.x) opts.scales.x.grid.color = colors.gridXs;
            if (opts.scales?.x?.ticks) opts.scales.x.ticks.color = colors.tick;
            if (opts.scales?.y) opts.scales.y.grid.color = colors.gridSm;
            if (opts.scales?.y?.ticks) opts.scales.y.ticks.color = colors.tick;
            if (opts.plugins?.tooltip) {
                opts.plugins.tooltip.backgroundColor = colors.tipBg;
                opts.plugins.tooltip.titleColor      = colors.tipTitle;
                opts.plugins.tooltip.bodyColor       = colors.tipBody;
                opts.plugins.tooltip.borderColor     = colors.tipBdr;
            }
            if (opts.plugins?.legend?.labels) opts.plugins.legend.labels.color = colors.tickDim;
            this.timelineChart.update('none');
        }

        // ── History total chart ─────────────────────────────────────────────
        if (this._histTotalChart) {
            const el = document.getElementById('historyTotalChart');
            if (el) {
                const ctx = el.getContext('2d');
                const grad = ctx.createLinearGradient(0, 0, 0, el.offsetHeight || 180);
                grad.addColorStop(0,   isLight ? 'rgba(251,191,36,0.55)' : 'rgba(251,191,36,0.28)');
                grad.addColorStop(0.7, isLight ? 'rgba(251,191,36,0.12)' : 'rgba(251,191,36,0.04)');
                grad.addColorStop(1,   'rgba(251,191,36,0)');
                if (this._histTotalChart.data.datasets[0]) {
                    this._histTotalChart.data.datasets[0].backgroundColor = grad;
                }
            }
            const opts = this._histTotalChart.options;
            if (opts.scales?.x?.ticks) opts.scales.x.ticks.color = colors.tick;
            if (opts.scales?.y?.ticks) opts.scales.y.ticks.color = colors.tick;
            if (opts.plugins?.tooltip) {
                opts.plugins.tooltip.backgroundColor = colors.tipBg;
                opts.plugins.tooltip.titleColor      = colors.tipTitle;
                opts.plugins.tooltip.bodyColor       = colors.tipBody;
                opts.plugins.tooltip.borderColor     = colors.tipBdr;
            }
            this._histTotalChart.update('none');
        }

        // ── Users chart ─────────────────────────────────────────────────────
        if (this.usersChart) {
            const opts = this.usersChart.options;
            if (opts.scales?.x?.grid) opts.scales.x.grid.color = colors.grid;
            if (opts.plugins?.tooltip) {
                opts.plugins.tooltip.backgroundColor = colors.tipBg;
                opts.plugins.tooltip.titleColor      = colors.tipBody;
                opts.plugins.tooltip.bodyColor       = colors.tipBody;
                opts.plugins.tooltip.borderColor     = colors.tipBdr;
            }
            this.usersChart.update('none');
        }

        // ── Growers chart ───────────────────────────────────────────────────
        if (this._histGrowersChart) {
            const opts = this._histGrowersChart.options;
            if (opts.scales?.x?.ticks) opts.scales.x.ticks.color = colors.tick;
            if (opts.scales?.y?.ticks) opts.scales.y.ticks.color = colors.tickDim;
            if (opts.plugins?.tooltip) {
                opts.plugins.tooltip.backgroundColor = colors.tipBg;
                opts.plugins.tooltip.bodyColor       = colors.tipBody;
            }
            this._histGrowersChart.update('none');
        }

        // ── Team doughnut — center text redraws automatically on update ─────
        if (this.teamChart) {
            this.teamChart.update('none');
        }
    }


    _updateChartDefaults() {
        const light = document.documentElement.dataset.theme === 'light';
        Chart.defaults.color = light ? '#6B7280' : '#94a3b8';
    }

    // ── Resize registry ───────────────────────────────────────────────────────
    // Tracks {chart, onResize} for every active chart so the global window
    // 'resize' listener can call chart.resize() on all of them at once.
    _registry = new Map();  // canvasId → { chart, canvas, onResize }

    /**
     * Register a chart in the resize registry and attach a ResizeObserver.
     * A shared, debounced window 'resize' handler resizes ALL registered charts
     * — this is the most reliable cross-browser responsive method for Chart.js.
     *
     * @param {HTMLCanvasElement} canvas   - The chart canvas
     * @param {Chart}             chart    - Chart.js instance
     * @param {Function|null}     onResize - Optional gradient-rebuild callback
     *                                       called as (chart, ctx, width, height)
     */
    _watchResize(canvas, chart, onResize = null) {
        if (!canvas || !chart) return;

        const id = canvas.id;

        // Disconnect any previous observer for this slot
        const prev = this._registry.get(id);
        if (prev?._obs) prev._obs.disconnect();

        // ① ResizeObserver on the wrapper (catches container-level changes)
        const wrapper = canvas.parentElement;
        let _obs = null;
        if (typeof ResizeObserver !== 'undefined' && wrapper) {
            _obs = new ResizeObserver(() => this._doResize(id));
            _obs.observe(wrapper);
        }

        this._registry.set(id, { chart, canvas, onResize, _obs });

        // ② Ensure global window-resize handler is installed (installed once)
        if (!this._winResizeInstalled) {
            this._winResizeInstalled = true;
            let _winTimer = null;
            window.addEventListener('resize', () => {
                clearTimeout(_winTimer);
                _winTimer = setTimeout(() => this._resizeAll(), 100);
            });
        }
    }

    /** Resize a single chart by canvas id */
    _doResize(id) {
        const entry = this._registry.get(id);
        if (!entry) return;
        const { chart, canvas, onResize } = entry;
        if (!chart || chart.ctx === null) { this._registry.delete(id); return; }

        const wrapper = canvas.parentElement;
        if (onResize && wrapper) {
            onResize(chart, canvas.getContext('2d'), wrapper.offsetWidth, wrapper.offsetHeight);
        }
        chart.resize();
    }

    /** Resize ALL registered charts (called by window resize) */
    _resizeAll() {
        for (const id of this._registry.keys()) {
            this._doResize(id);
        }
    }

    /** Unregister and stop observing a canvas */
    _unwatchResize(canvasId) {
        const entry = this._registry.get(canvasId);
        if (entry?._obs) entry._obs.disconnect();
        this._registry.delete(canvasId);
    }

    render(dataStore) {
        this._fullTimeline = dataStore.getTimelineData();
        this._dataStore    = dataStore;               // keep ref for team-click
        this.renderTimeline(this._fullTimeline);
        this.renderPeriodTable(this._fullTimeline);
        this.renderTeamChart(
            dataStore.getTeamDistribution(),
            dataStore.latestStats.used,
            dataStore
        );
        this.renderUsersChart(dataStore.getTopUsers(10));
        this._bindRangeBtns();
    }

    _bindRangeBtns() {
        document.querySelectorAll('.range-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const range = btn.dataset.range;
                const full  = this._fullTimeline || [];
                if (range === 'all') {
                    this.renderTimeline(full);
                } else {
                    const days  = parseInt(range);
                    const cutMs = full.length ? full[full.length - 1].timestamp - days * 86400000 : 0;
                    this.renderTimeline(full.filter(d => d.timestamp >= cutMs));
                }
            });
        });
    }



    renderPeriodTable(timelineData) {
        const tbody = document.getElementById('overview-period-table');
        if (!tbody) return;
        
        if (!timelineData || timelineData.length < 2) {
             tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Not enough data to calculate trends.</td></tr>';
             return;
        }

        const lastPoint = timelineData[timelineData.length - 1];
        const lastTs = lastPoint.timestamp;

        const periods = [
            { label: '1 Day',         ms: 86400000,        days: 1   },
            { label: '7 Days',        ms: 7  * 86400000,   days: 7   },
            { label: '30 Days',       ms: 30 * 86400000,   days: 30  },
            { label: '3 Months',      ms: 90 * 86400000,   days: 90  },
            { label: '6 Months',      ms: 180 * 86400000,  days: 180 },
            { label: '1 Year',        ms: 365 * 86400000,  days: 365 },
            { label: 'Max (All Time)',ms: Infinity,         days: 1   },
        ];

        const calc = periods.map(p => {
            const targetTs = lastTs - p.ms;
            let refPoint = timelineData[0];
            if (p.ms !== Infinity) {
                refPoint = timelineData.slice().reverse().find(d => d.timestamp <= targetTs) || timelineData[0];
            }
            const diffBytes = lastPoint.used - refPoint.used;
            const pct = refPoint.used > 0 ? ((diffBytes / refPoint.used) * 100).toFixed(2) : '0.00';
            let actualDays = p.days;
            if (p.ms === Infinity) actualDays = Math.max(1, (lastTs - refPoint.timestamp) / 86400000);
            const avgDaily = diffBytes / actualDays;
            return { diff: diffBytes, pct, avg: avgDaily, isUp: diffBytes >= 0, empty: diffBytes === 0 };
        });

        const colorClass = (isUp, isEmpty) => isEmpty ? '' : (isUp ? 'text-rose' : 'text-emerald');
        const arrow = (isUp, isEmpty) => isEmpty ? '' : (isUp ? '▲ ' : '▼ ');
        const sign  = (isUp, isEmpty) => isEmpty ? '' : (isUp ? '+' : '');

        let html = `<tr><td><strong>Growth (Capacity)</strong></td>`;
        calc.forEach(c => {
            html += `<td class="${colorClass(c.isUp, c.empty)}">${arrow(c.isUp, c.empty)}${smartFmt(c.diff)}</td>`;
        });
        html += `</tr><tr><td><strong>% Change</strong></td>`;
        calc.forEach(c => {
            html += `<td class="${colorClass(c.isUp, c.empty)}">${sign(c.isUp, c.empty)}${c.pct}%</td>`;
        });
        html += `</tr><tr><td><strong>Avg Daily Change</strong></td>`;
        calc.forEach(c => {
            html += `<td class="${colorClass(c.isUp, c.empty)}">${arrow(c.isUp, c.empty)}${smartFmt(c.avg)}/d</td>`;
        });
        html += `</tr>`;

        tbody.innerHTML = html;
    }

    renderTimeline(timelineData) {
        const ctx = document.getElementById('timelineChart').getContext('2d');

        // Gradient fill under the Used line — more opaque in light mode for visibility
        const _light = document.documentElement.dataset.theme === 'light';
        const gradientFill = ctx.createLinearGradient(0, 0, 0, 400);
        gradientFill.addColorStop(0,    _light ? 'rgba(251,191,36,0.55)' : 'rgba(251,191,36,0.26)');
        gradientFill.addColorStop(0.65, _light ? 'rgba(251,191,36,0.15)' : 'rgba(251,191,36,0.06)');
        gradientFill.addColorStop(1,    _light ? 'rgba(251,191,36,0.03)' : 'rgba(251,191,36,0.02)');

        const labels    = timelineData.map(d => new Date(d.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }));
        const usedData  = timelineData.map(d => d.used / 1e12);
        const scanData  = timelineData.map(d => (d.scanned || 0) / 1e12);
        
        const totalData = timelineData.map(d => d.total / 1e12);

        const deltaData = [0];
        for (let i = 1; i < usedData.length; i++) {
           deltaData.push((usedData[i] - usedData[i-1]));
        }

        const formatBytesDynamically = (tb) => {
            if (tb === 0) return '0 B';
            const b = tb * 1e12;
            const num = Math.abs(b);
            if (num >= 1e12) return (b / 1e12).toFixed(2) + ' TB';
            if (num >= 1e9)  return (b / 1e9).toFixed(2) + ' GB';
            if (num >= 1e6)  return (b / 1e6).toFixed(2) + ' MB';
            if (num >= 1e3)  return (b / 1e3).toFixed(2) + ' KB';
            return b.toFixed(2) + ' B';
        };


        // ── Stats subheader ───────────────────────────────────────────────────
        const last  = usedData[usedData.length - 1] ?? 0;
        const prev  = (usedData.length > 1 ? usedData[usedData.length - 2] : usedData[0]) ?? 0;
        const delta = last - prev;
        const pctCh = prev ? ((delta / prev) * 100).toFixed(2) : '0.00';
        const up    = delta >= 0;
        const statsEl = document.getElementById('timeline-stat-header');
        if (statsEl) {
            statsEl.innerHTML = `
                <span class="tsh-value">${last.toFixed(3)} TB</span>
                <span class="tsh-delta ${up ? 'tsh-up' : 'tsh-down'}">
                    ${up ? '▲' : '▼'} ${Math.abs(delta * 1000).toFixed(1)} GB &nbsp;(${up ? '+' : ''}${pctCh}%)
                </span>`;
        }

        // ── Persistent reference line at latest value ─────────────────────────
        const refPlugin = {
            id: 'refLine',
            afterDatasetsDraw(chart) {
                const { ctx: c, chartArea: { left, right }, scales } = chart;
                const yPx = scales.y.getPixelForValue(last);
                if (isNaN(yPx)) return;
                c.save();
                c.setLineDash([5, 5]);
                c.lineWidth = 1;
                c.strokeStyle = 'rgba(251,191,36,0.55)';
                c.beginPath();
                c.moveTo(left, yPx);
                c.lineTo(right, yPx);
                c.stroke();
                // Pill label on right axis
                const label  = `${last.toFixed(3)} TB`;
                c.setLineDash([]);
                c.font = 'bold 11px Inter, sans-serif';
                const lw = c.measureText(label).width + 14;
                c.fillStyle = '#f59e0b';
                const rx = right + 4, ry = yPx - 10, rh = 20, rr = 4;
                c.beginPath();
                c.roundRect?.(rx, ry, lw, rh, rr) || c.rect(rx, ry, lw, rh);
                c.fill();
                c.fillStyle = '#000';
                c.textAlign = 'left';
                c.textBaseline = 'middle';
                c.fillText(label, rx + 7, yPx);
                c.restore();
            }
        };

        // ── Crosshair plugin ──────────────────────────────────────────────────
        const crosshairPlugin = {
            id: 'crosshair',
            afterDraw(chart) {
                if (!chart._hoverX) return;
                const { ctx: c, chartArea: { top, bottom, left, right }, scales } = chart;
                const x = chart._hoverX;
                const y = chart._hoverY;

                c.save();
                c.setLineDash([4, 4]);
                c.lineWidth = 1;
                c.strokeStyle = 'rgba(255,255,255,0.3)';

                // Vertical line
                c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke();

                // Horizontal line + y-axis pill
                if (y !== null) {
                    c.beginPath(); c.moveTo(left, y); c.lineTo(right, y); c.stroke();
                    const yVal = scales.y.getValueForPixel(y);
                    if (yVal !== undefined) {
                        const label = `${yVal.toFixed(3)} TB`;
                        c.setLineDash([]);
                        c.font = 'bold 11px Inter, sans-serif';
                        const lw = c.measureText(label).width + 14;
                        c.fillStyle = 'rgba(30,30,40,0.95)';
                        c.strokeStyle = 'rgba(251,191,36,0.8)';
                        c.lineWidth = 1;
                        const rx = right + 4, ry = y - 10, rh = 20, rr = 4;
                        c.beginPath();
                        c.roundRect?.(rx, ry, lw, rh, rr) || c.rect(rx, ry, lw, rh);
                        c.fill(); c.stroke();
                        c.fillStyle = '#fbbf24';
                        c.textAlign = 'left'; c.textBaseline = 'middle';
                        c.fillText(label, rx + 7, y);
                    }
                }

                // X-axis date pill at bottom
                const xIdx = scales.x.getValueForPixel(x);
                if (xIdx !== undefined) {
                    const dateLabel = labels[Math.round(xIdx)] ?? '';
                    c.setLineDash([]);
                    c.font = 'bold 10px Inter, sans-serif';
                    const lw = c.measureText(dateLabel).width + 14;
                    c.fillStyle = 'rgba(30,30,40,0.95)';
                    c.strokeStyle = 'rgba(251,191,36,0.7)';
                    c.lineWidth = 1;
                    const bx = x - lw / 2, by = bottom + 4, bh = 18, br = 4;
                    c.beginPath();
                    c.roundRect?.(bx, by, lw, bh, br) || c.rect(bx, by, lw, bh);
                    c.fill(); c.stroke();
                    c.fillStyle = '#fbbf24';
                    c.textAlign = 'center'; c.textBaseline = 'middle';
                    c.fillText(dateLabel, x, by + bh / 2);
                }
                c.restore();
            },
            afterEvent(chart, { event }) {
                const { chartArea: { left, right, top, bottom } } = chart;
                if (event.type === 'mousemove' && event.x >= left && event.x <= right) {
                    chart._hoverX = event.x;
                    chart._hoverY = (event.y >= top && event.y <= bottom) ? event.y : null;
                } else {
                    chart._hoverX = null;
                    chart._hoverY = null;
                }
                chart.draw();
            }
        };

        if (this.timelineChart) this.timelineChart.destroy();

        this.timelineChart = new Chart(ctx, {
            type: 'line',
            plugins: [refPlugin, crosshairPlugin],
            data: {
                labels,
                datasets: [
                    {
                        label: 'Used Capacity',
                        data: usedData,
                        borderColor: '#fbbf24',
                        backgroundColor: gradientFill,
                        borderWidth: 1.5,
                        fill: true,
                        tension: 0,
                        pointRadius: 0,
                        pointHitRadius: 12,
                        order: 1
                    },
                    {
                        label: 'Scan Result',
                        data: scanData,
                        borderColor: 'rgba(251,191,36,0.35)',
                        backgroundColor: 'transparent',
                        borderWidth: 1,
                        borderDash: [4, 3],
                        fill: false,
                        tension: 0,
                        pointRadius: 0,
                        pointHitRadius: 8,
                        order: 2
                    },
                    {
                        label: 'Total Capacity',
                        data: totalData,
                        borderColor: 'rgba(148,163,184,0.60)',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        borderDash: [6, 4],
                        fill: false,
                        tension: 0,
                        pointRadius: 0,
                        order: 3
                    }                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'top',
                        align: 'end',
        labels: { boxWidth: 18, padding: 14, color: ct().tickDim }
                    },
                    tooltip: {
                        backgroundColor: ct().tipBg,
                        titleColor: ct().tipTitle,
                        bodyColor: ct().tipBody,
                        borderColor: ct().tipBdr,
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                            title: items => items[0]?.label ?? '',
                            label: item => {
                                const valStr = formatBytesDynamically(item.raw);
                                return ` ${item.dataset.label}: ${valStr}`;
                            }
                        }
                    }
                },
                layout: { padding: { right: 30 } },
                scales: {
                    x: {
                        grid: { color: ct().gridXs, drawBorder: false },
                        ticks: { maxTicksLimit: 10, color: ct().tick, font: { size: 11 } }
                    },
                    y: {
                        position: 'right',
                        beginAtZero: false,
                        grid: { color: ct().gridSm, drawBorder: false },
                        afterFit(scale) { scale.width = 65; },
                        ticks: {
                            color: ct().tick,
                            font: { size: 11 },
                            callback: v => formatBytesDynamically(v)
                        }
                    }

                }
            }
        });

        // Rebuild gradient whenever canvas height changes
        const canvas = document.getElementById('timelineChart');
        this._watchResize(canvas, this.timelineChart, (chart, c, _w, h) => {
            const newGrad = c.createLinearGradient(0, 0, 0, h);
            const _isLight = document.documentElement.dataset.theme === 'light';
            newGrad.addColorStop(0,    _isLight ? 'rgba(251,191,36,0.55)' : 'rgba(251,191,36,0.26)');
            newGrad.addColorStop(0.65, _isLight ? 'rgba(251,191,36,0.15)' : 'rgba(251,191,36,0.06)');
            newGrad.addColorStop(1,    _isLight ? 'rgba(251,191,36,0.03)' : 'rgba(251,191,36,0.02)');
            if (chart.data.datasets[0]) {
                chart.data.datasets[0].backgroundColor = newGrad;
                chart.update('none');
            }
        });
    }


    renderTeamChart(teamData, totalUsed = 0, dataStore = null) {
        const ctx = document.getElementById('teamChart').getContext('2d');
        // Cache for theme re-render
        this._teamData  = teamData;
        this._teamTotal = totalUsed;

        const sumTeams    = teamData.reduce((s, t) => s + t.used, 0);
        const unknownBytes = Math.max(0, totalUsed - sumTeams);
        const allTeams    = [...teamData];
        const bgColors    = [
            this.colors.sky, this.colors.emerald, this.colors.amber,
            this.colors.rose, '#8b5cf6', this.colors.slate, '#06b6d4', '#a78bfa'
        ];

        if (unknownBytes > 0) {
            allTeams.push({ name: 'Unknown', used: unknownBytes });
            bgColors.push('#334155');
        }

        const labels = allTeams.map(t => t.name);
        const data   = allTeams.map(t => t.used / 1e12);

        // Center text plugin
        const totalTB = (totalUsed / 1e12).toFixed(2);
        const totalGB = (totalUsed / 1e9).toFixed(0);
        const centerTextPlugin = {
            id: 'centerText',
            afterDraw(chart) {
                if (chart.config.type !== 'doughnut') return;
                const { ctx: c, chartArea: { top, bottom, left, right } } = chart;
                const cx = (left + right) / 2;
                const cy = (top + bottom) / 2;
                const isLight = document.documentElement.dataset.theme === 'light';
                c.save();
                c.font = 'bold 22px Inter, sans-serif';
                c.fillStyle = isLight ? '#1E2235' : '#ffffff';
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillText(`${totalTB} TB`, cx, cy - 12);
                c.font = '500 12px Inter, sans-serif';
                c.fillStyle = isLight ? '#5B6377' : '#94a3b8';
                c.fillText(`${totalGB} GB used`, cx, cy + 12);
                c.restore();
            }
        };

        if (this.teamChart) this.teamChart.destroy();

        // Track which team is currently selected (for toggle)
        this._selectedTeamIdx = null;

        this.teamChart = new Chart(ctx, {
            type: 'doughnut',
            plugins: [centerTextPlugin],
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: bgColors.slice(0, allTeams.length),
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '72%',
                plugins: {
                    legend: { position: 'right' },
                    tooltip: {
                        backgroundColor: 'rgba(15, 17, 21, 0.9)',
                        titleColor: '#fff',
                        bodyColor: '#e2e8f0',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        callbacks: {
                            label: c => ` ${c.label}: ${smartFmt(c.raw * 1e12)}`
                        }
                    }
                },
                onClick: (evt, elements) => {
                    if (!dataStore || !elements.length) return;
                    const idx = elements[0].index;
                    const team = allTeams[idx];

                    // Same slice clicked again -> reset
                    if (this._selectedTeamIdx === idx) {
                        this._clearTeamFilter(dataStore);
                        return;
                    }
                    this._selectedTeamIdx = idx;

                    if (!team || team.team_id === undefined) {
                        // No team_id = auto-generated "Other" catchall -> show other_usage
                        const otherUsers = dataStore.getOtherUsers();
                        if (otherUsers.length) {
                            this.renderUsersChart(otherUsers);
                        } else {
                            this._showNoDataUsersChart();
                        }
                        this._showTeamFilterBadge(team?.name ?? 'Other', () => this._clearTeamFilter(dataStore));
                        return;
                    }

                    // Named team -> show its members (empty state if no users assigned)
                    const teamUsers = dataStore.getUsersByTeamId(team.team_id);
                    if (teamUsers.length) {
                        this.renderUsersChart(teamUsers);
                    } else {
                        this._showNoDataUsersChart();
                    }
                    this._showTeamFilterBadge(team.name, () => this._clearTeamFilter(dataStore));
                }
            }
        });

        const teamCanvas = document.getElementById('teamChart');
        this._watchResize(teamCanvas, this.teamChart);
    }

    /** Show a dismissible "Filtered: TeamName" badge in the users chart panel-header */
    _showTeamFilterBadge(teamName, onClear) {
        let badge = document.getElementById('team-filter-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.id = 'team-filter-badge';
            badge.style.cssText = [
                'display:inline-flex', 'align-items:center', 'gap:5px',
                'padding:2px 9px', 'border-radius:20px', 'font-size:11px',
                'font-weight:600', 'background:rgba(14,165,233,0.15)',
                'color:#38bdf8', 'border:1px solid rgba(14,165,233,0.3)',
                'cursor:pointer', 'user-select:none'
            ].join(';');
            // Insert into panel-header of usersChart (OUTSIDE canvas-wrapper — no layout impact)
            const usersCanvas = document.getElementById('usersChart');
            const headerRow = usersCanvas?.closest('.chart-container')?.querySelector('.flex-row-g6');
            if (headerRow) headerRow.prepend(badge);
        }
        badge.innerHTML = `${teamName} <span style="opacity:.6;font-size:13px;line-height:1">&times;</span>`;
        badge.style.display = 'inline-flex';
        badge.onclick = onClear;
    }

    /** Clear team filter — restore all-users chart and hide badge */
    _clearTeamFilter(dataStore) {
        this._selectedTeamIdx = null;
        this.renderUsersChart(dataStore.getTopUsers(10));
        const badge = document.getElementById('team-filter-badge');
        if (badge) badge.style.display = 'none';
    }

    /** Show a premium empty-state overlay over the users chart canvas */
    _showNoDataUsersChart() {
        if (this.usersChart) { this.usersChart.destroy(); this.usersChart = null; }

        // Clear any leftover pixels on the raw canvas
        const canvas = document.getElementById('usersChart');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        // Reuse or create the overlay inside canvas-wrapper (positioned absolute)
        const wrapper = canvas?.parentElement;
        if (!wrapper) return;
        wrapper.style.position = 'relative'; // ensure stacking context

        let overlay = document.getElementById('users-no-data-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'users-no-data-overlay';
            overlay.style.cssText = [
                'position:absolute', 'inset:0', 'display:flex',
                'flex-direction:column', 'align-items:center', 'justify-content:center',
                'gap:10px', 'pointer-events:none'
            ].join(';');
            wrapper.appendChild(overlay);
        }

        overlay.innerHTML = `
            <div style="
                width:44px;height:44px;border-radius:14px;
                background:rgba(100,116,139,0.12);border:1px solid rgba(100,116,139,0.25);
                display:flex;align-items:center;justify-content:center;
                color:#64748b;margin-bottom:2px">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="1.8"
                     stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
            </div>
            <span style="font:600 13px/1 Inter,sans-serif;color:var(--text-primary,#e2e8f0)">
                No consumer data
            </span>
            <span style="font:400 11.5px/1.5 Inter,sans-serif;color:var(--text-secondary,#64748b);max-width:180px;text-align:center">
                Usage in this segment is untracked<br>or belongs to the system
            </span>`;

        overlay.style.display = 'flex';
    }

    /** Hide the no-data overlay (called whenever a real chart is rendered) */
    _hideNoDataOverlay() {
        const overlay = document.getElementById('users-no-data-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    renderUsersChart(userData, logScale = false) {
        this._hideNoDataOverlay(); // clear any empty-state overlay first
        const ctx = document.getElementById('usersChart').getContext('2d');
        const labels  = userData.map(u => u.name);
        const bytes   = userData.map(u => u.used);
        const { divisor, unit } = pickUnit(bytes);
        const data    = bytes.map(b => +(b / divisor).toFixed(3));

        if (this.usersChart) this.usersChart.destroy();

        const xScaleCfg = logScale
            ? {
                type: 'logarithmic',
                grid: { color: 'rgba(255,255,255,0.05)' },
                ticks: {
                    autoSkip: true,
                    maxTicksLimit: 6,
                    maxRotation: 0,
                    callback: v => {
                        const log = Math.log10(v);
                        if (Math.abs(log - Math.round(log)) < 1e-9) return smartFmtTick(v * divisor);
                        const nice = [1,2,5,10,15,20,25,30,40,50,60,70,80,90,100];
                        return nice.includes(Math.round(v)) ? smartFmtTick(Math.round(v) * divisor) : null;
                    }
                }
              }
            : { type: 'linear', grid: { color: ct().grid }, ticks: { autoSkip: true, maxRotation: 0, maxTicksLimit: 6, callback: v => smartFmtTick(v * divisor) } };

        // Cache for theme re-render
        this._usersData = userData;

        this.usersChart = new Chart(ctx, {
            type: 'bar',
            data: { labels, datasets: [{ label: `Consumed (${unit})`, data, backgroundColor: this.colors.sky, borderRadius: 4, maxBarThickness: 32 }] },
            options: {
                responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: ct().tipBg, titleColor: ct().tipBody, bodyColor: ct().tipBody,
                        borderColor: ct().tipBdr, borderWidth: 1,
                        callbacks: { label: c => ` ${smartFmt(bytes[c.dataIndex])}` }
                    }
                },
                scales: {
                    x: xScaleCfg,
                    y: { grid: { display: false } }
                }
            }
        });

        // Wire toggle button
        const btn = document.getElementById('users-scale-btn');
        if (btn) {
            btn.textContent = logScale ? 'Log' : 'Lin';
            btn.classList.toggle('active', logScale);
            btn.onclick = () => {
                this._usersLogScale = !this._usersLogScale;
                this.renderUsersChart(userData, this._usersLogScale);
            };
        }

        const usersCanvas = document.getElementById('usersChart');
        this._watchResize(usersCanvas, this.usersChart);
    }

    // ── History Tab Charts ────────────────────────────────────────────────────

    renderHistoryTotalChart(timelineData) {
        const el = document.getElementById('historyTotalChart');
        if (!el) return;
        const ctx = el.getContext('2d');

        const _light2 = document.documentElement.dataset.theme === 'light';
        const grad = ctx.createLinearGradient(0, 0, 0, 220);
        grad.addColorStop(0,   _light2 ? 'rgba(251,191,36,0.55)' : 'rgba(251,191,36,0.28)');
        grad.addColorStop(0.7, _light2 ? 'rgba(251,191,36,0.12)' : 'rgba(251,191,36,0.04)');
        grad.addColorStop(1,   'rgba(251,191,36,0)');

        const labels   = timelineData.map(d => new Date(d.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }));
        const usedData = timelineData.map(d => +(d.used / 1e12).toFixed(4));

        // Delta stat
        const first = usedData[0] ?? 0;
        const last  = usedData[usedData.length - 1] ?? 0;
        const delta = last - first;
        const pctCh = first ? ((delta / first) * 100).toFixed(1) : '0.0';
        const el2   = document.getElementById('history-total-stat');
        if (el2) el2.innerHTML = '';

        if (this._histTotalChart) this._histTotalChart.destroy();
        this._histTotalChart = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets: [{
                data: usedData, borderColor: '#fbbf24', backgroundColor: grad,
                borderWidth: 1.5, fill: true, tension: 0.3, pointRadius: 0, pointHitRadius: 12
            }]},
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: ct().tipBg, titleColor: ct().tipTitle,
                        bodyColor: ct().tipBody, borderColor: ct().tipBdr, borderWidth: 1, padding: 10,
                        callbacks: { label: i => ` ${smartFmt(i.raw * 1e12)}` }
                    }
                },
                scales: {
                    x: { grid: { color: ct().gridXs }, ticks: { maxTicksLimit: 6, color: ct().tick, font: { size: 10 } } },
                    y: { position: 'right', grid: { color: ct().gridSm }, ticks: { autoSkip: true, maxRotation: 0, color: ct().tick, font: { size: 10 }, callback: v => smartFmtTick(v * 1e12) } }
                }
            }
        });

        // Rebuild gradient whenever canvas height changes
        this._watchResize(el, this._histTotalChart, (chart, c, _w, h) => {
            const _isLight = document.documentElement.dataset.theme === 'light';
            const newGrad = c.createLinearGradient(0, 0, 0, h);
            newGrad.addColorStop(0,   _isLight ? 'rgba(251,191,36,0.55)' : 'rgba(251,191,36,0.28)');
            newGrad.addColorStop(0.7, _isLight ? 'rgba(251,191,36,0.12)' : 'rgba(251,191,36,0.04)');
            newGrad.addColorStop(1,   'rgba(251,191,36,0)');
            if (chart.data.datasets[0]) {
                chart.data.datasets[0].backgroundColor = newGrad;
                chart.update('none');
            }
        });
    }
    renderTopGrowersChart(growersData, logScale = false) {
        const el = document.getElementById('historyGrowersChart');
        if (!el) return;
        const ctx = el.getContext('2d');

        const labels     = growersData.map(u => u.name);
        const growBytes  = growersData.map(u => u.growth || 0);
        const { divisor, unit } = pickUnit(growBytes);
        const deltas = growBytes.map(b => +(b / divisor).toFixed(3));
        const colors = deltas.map(d => d >= 0 ? 'rgba(52,211,153,0.7)' : 'rgba(251,113,133,0.7)');

        const el2 = document.getElementById('history-growers-stat');
        if (el2 && growersData[0]) {
            const top = growersData[0];
            el2.textContent = `${top.name}: +${smartFmt(top.growth || 0, 1)}`;
        }

        // For log scale: use absolute values (negatives can't be logged)
        const hasNegative = deltas.some(d => d < 0);
        const useLog = logScale && !hasNegative;

        const xScaleCfg = useLog
            ? {
                type: 'logarithmic',
                grid: { color: 'rgba(255,255,255,0.04)' },
                ticks: {
                    color: '#475569', font: { size: 10 },
                    autoSkip: true,
                    maxTicksLimit: 6,
                    maxRotation: 0,
                    callback: v => {
                        const log = Math.log10(v);
                        const str = smartFmtTick(v * divisor);
                        if (Math.abs(log - Math.round(log)) < 1e-9) return `+${str}`;
                        const nice = [1,2,5,10,15,20,25,30,40,50,60,70,80,90,100,150,200,300,400,500];
                        return nice.includes(Math.round(v)) ? `+${str}` : null;
                    }
                }
              }
            : { type: 'linear', grid: { color: ct().gridSm }, ticks: { autoSkip: true, maxRotation: 0, maxTicksLimit: 6, color: ct().tick, font: { size: 10 }, callback: v => `${v>0?'+':''}${smartFmtTick(v * divisor)}` } };

        if (this._histGrowersChart) this._histGrowersChart.destroy();
        this._histGrowersChart = new Chart(ctx, {
            type: 'bar',
            data: { labels, datasets: [{ data: deltas, backgroundColor: colors, borderRadius: 4 }] },
            options: {
                responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: ct().tipBg, titleColor: ct().tipBody,
                        bodyColor: ct().tipBody, borderWidth: 0, padding: 10,
                        callbacks: { label: i => ` ${i.raw >= 0 ? '+' : ''}${smartFmt(i.raw * divisor)}` }
                    }
                },
                scales: {
                    x: xScaleCfg,
                    y: { grid: { display: false }, ticks: { color: ct().tickDim, font: { size: 10 } } }
                }
            }
        });

        // Wire toggle button
        const btn = document.getElementById('growers-scale-btn');
        if (btn) {
            const effective = useLog;
            btn.textContent = effective ? 'Log' : 'Lin';
            btn.classList.toggle('active', effective);
            btn.title = hasNegative && logScale ? 'Log unavailable (negative values)' : 'Toggle log/linear scale';
            btn.onclick = () => {
                this._growersLogScale = !this._growersLogScale;
                this.renderTopGrowersChart(growersData, this._growersLogScale);
            };
        }

        this._watchResize(el, this._histGrowersChart);
    }
    renderUserTrendChart(userTimelineMap, selectedUsers, startMs, endMs, logScale = false) {
        const el = document.getElementById('historyTotalChart');
        if (!el) return;
        const ctx = el.getContext('2d');

        const PALETTE = ['#38bdf8','#34d399','#fbbf24','#f87171','#a78bfa','#fb923c','#e879f9','#4ade80','#60a5fa','#facc15','#2dd4bf','#f472b6'];

        // Collect all timestamps in range across selected users
        const tsSet = new Set();
        selectedUsers.forEach(name => {
            (userTimelineMap.get(name) || []).forEach(p => { if (p.timestamp >= startMs && p.timestamp <= endMs) tsSet.add(p.timestamp); });
        });
        const sortedTs = [...tsSet].sort((a, b) => a - b);
        const labels   = sortedTs.map(ts => new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }));

        const datasets = selectedUsers.map((name, i) => {
            const points = new Map((userTimelineMap.get(name) || []).map(p => [p.timestamp, p.used]));
            return {
                label: name,
                data: sortedTs.map(ts => points.has(ts) ? +(points.get(ts) / 1e9).toFixed(2) : null),
                borderColor: PALETTE[i % PALETTE.length],
                backgroundColor: 'transparent',
                borderWidth: 1.5,
                tension: 0.3,
                pointRadius: 0,
                pointHitRadius: 10,
                spanGaps: true
            };
        });

        const countEl = document.getElementById('history-user-count');
        if (countEl) countEl.textContent = `${selectedUsers.length} user${selectedUsers.length !== 1 ? 's' : ''}`;

        if (this._histTotalChart) { this._histTotalChart.destroy(); this._histTotalChart = null; }
        this._histTotalChart = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'top', align: 'start',
                        labels: { boxWidth: 10, padding: 10, color: '#94a3b8', font: { size: 10 } }
                    },
                    tooltip: {
                        backgroundColor: ct().tipBg, titleColor: ct().tipBody,
                        bodyColor: ct().tipBody, borderColor: ct().tipBdr, borderWidth: 1, padding: 10,
                        callbacks: { label: i => ` ${i.dataset.label}: ${i.raw?.toFixed(2) ?? '—'} GB` }
                    }
                },
                scales: {
                    x: { grid: { color: ct().gridXs }, ticks: { maxTicksLimit: 8, color: ct().tick, font: { size: 10 } } },
                    y: {
                        type: logScale ? 'logarithmic' : 'linear',
                        position: 'right',
                        grid: { color: ct().gridSm },
                        ticks: { color: ct().tick, font: { size: 10 }, callback: v => `${v}GB` },
                        ...(logScale ? { min: 0.01 } : {})
                    }
                }
            }
        });

        this._watchResize(el, this._histTotalChart);
    }
}
