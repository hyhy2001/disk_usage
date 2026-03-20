export class ChartManager {
    constructor() {
        this.timelineChart = null;
        this.teamChart = null;
        this.usersChart = null;
        this._histTotalChart = null;
        this._histGrowersChart = null;
        // Scale states for the two horizontal bar charts
        this._usersLogScale = false;
        this._growersLogScale = false;
        
        // Brand Colors
        this.colors = {
            emerald: '#10b981',
            rose: '#f43f5e',
            sky: '#0ea5e9',
            amber: '#f59e0b',
            slate: '#94a3b8'
        };

        Chart.defaults.color = this.colors.slate;
        Chart.defaults.font.family = "'Inter', sans-serif";
    }

    render(dataStore) {
        this._fullTimeline = dataStore.getTimelineData();   // store full dataset
        this.renderTimeline(this._fullTimeline);
        this.renderPeriodTable(this._fullTimeline);
        this.renderTeamChart(
            dataStore.getTeamDistribution(),
            dataStore.latestStats.used
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

        const formatBytesRound = (b) => {
            if (b === 0) return '0 B';
            const num = Math.abs(b);
            if (num >= 1e12) return (b / 1e12).toFixed(2) + ' TB';
            if (num >= 1e9)  return (b / 1e9).toFixed(2) + ' GB';
            if (num >= 1e6)  return (b / 1e6).toFixed(2) + ' MB';
            return (b / 1e3).toFixed(2) + ' KB';
        };

        const lastPoint = timelineData[timelineData.length - 1];
        const lastTs = lastPoint.timestamp;
        
        const periods = [
            { label: '1 Day', ms: 86400000, days: 1 },
            { label: '7 Days', ms: 7 * 86400000, days: 7 },
            { label: '30 Days', ms: 30 * 86400000, days: 30 },
            { label: '3 Months', ms: 90 * 86400000, days: 90 },
            { label: '6 Months', ms: 180 * 86400000, days: 180 },
            { label: '1 Year', ms: 365 * 86400000, days: 365 },
            { label: 'Max (All Time)', ms: Infinity, days: 1 } // Days will be calculated
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
             if (p.ms === Infinity) {
                 actualDays = Math.max(1, (lastTs - refPoint.timestamp) / 86400000);
             }
             const avgDaily = diffBytes / actualDays;
             
             return {
                 diff: diffBytes,
                 pct: pct,
                 avg: avgDaily,
                 isUp: diffBytes >= 0,
                 empty: diffBytes === 0
             };
        });

        const colorClass = (isUp, isEmpty) => isEmpty ? '' : (isUp ? 'text-rose' : 'text-emerald');
        const arrow = (isUp, isEmpty) => isEmpty ? '' : (isUp ? '▲ ' : '▼ ');
        const sign = (isUp, isEmpty) => isEmpty ? '' : (isUp ? '+' : '');

        let html = `<tr><td><strong>Growth (Capacity)</strong></td>`;
        calc.forEach(c => {
            html += `<td class="${colorClass(c.isUp, c.empty)}">${arrow(c.isUp, c.empty)}${formatBytesRound(c.diff)}</td>`;
        });
        html += `</tr><tr><td><strong>% Change</strong></td>`;
        calc.forEach(c => {
            html += `<td class="${colorClass(c.isUp, c.empty)}">${sign(c.isUp, c.empty)}${c.pct}%</td>`;
        });
        html += `</tr><tr><td><strong>Avg Daily Change</strong></td>`;
        calc.forEach(c => {
            html += `<td class="${colorClass(c.isUp, c.empty)}">${arrow(c.isUp, c.empty)}${formatBytesRound(c.avg)}/d</td>`;
        });
        html += `</tr>`;
        
        tbody.innerHTML = html;
    }

    renderTimeline(timelineData) {
        const ctx = document.getElementById('timelineChart').getContext('2d');

        // Gradient fill under the Used line
        const gradientFill = ctx.createLinearGradient(0, 0, 0, 400);
        gradientFill.addColorStop(0,   'rgba(251, 191, 36, 0.26)');
        gradientFill.addColorStop(0.65, 'rgba(251, 191, 36, 0.06)');
        gradientFill.addColorStop(1,   'rgba(251, 191, 36, 0.02)');


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
                        labels: { boxWidth: 18, padding: 14, color: '#64748b' }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(10,14,20,0.94)',
                        titleColor: '#fbbf24',
                        bodyColor: '#cbd5e1',
                        borderColor: 'rgba(251,191,36,0.3)',
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
                        grid: { color: 'rgba(255,255,255,0.03)', drawBorder: false },
                        ticks: { maxTicksLimit: 10, color: '#475569', font: { size: 11 } }
                    },
                    y: {
                        position: 'right',
                        beginAtZero: false,
                        grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
                        afterFit(scale) { scale.width = 65; },
                        ticks: {
                            color: '#475569',
                            font: { size: 11 },
                            callback: v => formatBytesDynamically(v)
                        }
                    }

                }
            }
        });

    }


    renderTeamChart(teamData, totalUsed = 0) {
        const ctx = document.getElementById('teamChart').getContext('2d');

        // Compute Unknown = df-h total used minus sum of all detailed-scan teams
        const sumTeams = teamData.reduce((s, t) => s + t.used, 0);
        const unknownBytes = Math.max(0, totalUsed - sumTeams);

        const allTeams = [...teamData];
        const bgColors = [
            this.colors.sky, this.colors.emerald, this.colors.amber,
            this.colors.rose, '#8b5cf6', this.colors.slate, '#06b6d4', '#a78bfa'
        ];

        if (unknownBytes > 0) {
            allTeams.push({ name: '🔒 Unknown', used: unknownBytes });
            bgColors.push('#334155');
        }

        const labels = allTeams.map(t => t.name);
        const data   = allTeams.map(t => t.used / 1e12);

        // Center text plugin
        const totalTB  = (totalUsed / 1e12).toFixed(2);
        const totalGB  = (totalUsed / 1e9).toFixed(0);
        const centerTextPlugin = {
            id: 'centerText',
            afterDraw(chart) {
                if (chart.config.type !== 'doughnut') return;
                const { ctx: c, chartArea: { top, bottom, left, right } } = chart;
                const cx = (left + right) / 2;
                const cy = (top + bottom) / 2;
                c.save();
                // Main value
                c.font = 'bold 22px Inter, sans-serif';
                c.fillStyle = '#ffffff';
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillText(`${totalTB} TB`, cx, cy - 12);
                // Sub-label
                c.font = '500 12px Inter, sans-serif';
                c.fillStyle = '#94a3b8';
                c.fillText(`${totalGB} GB used`, cx, cy + 12);
                c.restore();
            }
        };

        if (this.teamChart) this.teamChart.destroy();

        this.teamChart = new Chart(ctx, {
            type: 'doughnut',
            plugins: [centerTextPlugin],
            data: {
                labels: labels,
                datasets: [{
                    data: data,
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
                            label: ctx => {
                                const GB = (ctx.raw * 1024).toFixed(1);
                                return ` ${ctx.label}: ${ctx.raw.toFixed(2)} TB (${GB} GB)`;
                            }
                        }
                    }
                }
            }
        });
    }


    renderUsersChart(userData, logScale = false) {
        const ctx = document.getElementById('usersChart').getContext('2d');
        const labels = userData.map(u => u.name);
        const data   = userData.map(u => u.used / 1e9);

        if (this.usersChart) this.usersChart.destroy();

        const xScaleCfg = logScale
            ? { type: 'logarithmic', grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: v => `${v} GB` } }
            : { type: 'linear',      grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: v => `${v} GB` } };

        this.usersChart = new Chart(ctx, {
            type: 'bar',
            data: { labels, datasets: [{ label: 'Consumed (GB)', data, backgroundColor: this.colors.sky, borderRadius: 4 }] },
            options: {
                responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15,17,21,0.9)', titleColor: '#fff', bodyColor: '#e2e8f0',
                        borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
                        callbacks: { label: ctx => ` ${ctx.raw.toFixed(1)} GB` }
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
    }

    // ── History Tab Charts ────────────────────────────────────────────────────

    renderHistoryTotalChart(timelineData) {
        const el = document.getElementById('historyTotalChart');
        if (!el) return;
        const ctx = el.getContext('2d');

        const grad = ctx.createLinearGradient(0, 0, 0, 220);
        grad.addColorStop(0,   'rgba(251,191,36,0.28)');
        grad.addColorStop(0.7, 'rgba(251,191,36,0.04)');
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
                        backgroundColor: 'rgba(10,14,20,0.94)', titleColor: '#fbbf24',
                        bodyColor: '#cbd5e1', borderColor: 'rgba(251,191,36,0.3)', borderWidth: 1, padding: 10,
                        callbacks: { label: i => ` ${i.raw.toFixed(3)} TB` }
                    }
                },
                scales: {
                    x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { maxTicksLimit: 6, color: '#475569', font: { size: 10 } } },
                    y: { position: 'right', grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#475569', font: { size: 10 }, callback: v => `${v.toFixed(2)}T` } }
                }
            }
        });
    }

    renderTopGrowersChart(growersData, logScale = false) {
        const el = document.getElementById('historyGrowersChart');
        if (!el) return;
        const ctx = el.getContext('2d');

        const labels = growersData.map(u => u.name);
        const deltas = growersData.map(u => +((u.growth || 0) / 1e9).toFixed(2));
        const colors = deltas.map(d => d >= 0 ? 'rgba(52,211,153,0.7)' : 'rgba(251,113,133,0.7)');

        const el2 = document.getElementById('history-growers-stat');
        if (el2 && growersData[0]) {
            const top = growersData[0];
            el2.textContent = `${top.name}: +${((top.growth||0)/1e9).toFixed(1)} GB`;
        }

        // For log scale: use absolute values (negatives can't be logged)
        const hasNegative = deltas.some(d => d < 0);
        const useLog = logScale && !hasNegative;

        const xScaleCfg = useLog
            ? { type: 'logarithmic', grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#475569', font: { size: 10 }, callback: v => `${v>0?'+':''}${v}G` } }
            : { type: 'linear',      grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#475569', font: { size: 10 }, callback: v => `${v>0?'+':''}${v}G` } };

        if (this._histGrowersChart) this._histGrowersChart.destroy();
        this._histGrowersChart = new Chart(ctx, {
            type: 'bar',
            data: { labels, datasets: [{ data: deltas, backgroundColor: colors, borderRadius: 4 }] },
            options: {
                responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(10,14,20,0.94)', titleColor: '#fff',
                        bodyColor: '#cbd5e1', borderWidth: 0, padding: 10,
                        callbacks: { label: i => ` ${i.raw >= 0 ? '+' : ''}${i.raw.toFixed(2)} GB` }
                    }
                },
                scales: {
                    x: xScaleCfg,
                    y: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } }
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
                        backgroundColor: 'rgba(10,14,20,0.94)', titleColor: '#fff',
                        bodyColor: '#cbd5e1', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, padding: 10,
                        callbacks: { label: i => ` ${i.dataset.label}: ${i.raw?.toFixed(2) ?? '—'} GB` }
                    }
                },
                scales: {
                    x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { maxTicksLimit: 8, color: '#475569', font: { size: 10 } } },
                    y: {
                        type: logScale ? 'logarithmic' : 'linear',
                        position: 'right',
                        grid: { color: 'rgba(255,255,255,0.04)' },
                        ticks: { color: '#475569', font: { size: 10 }, callback: v => `${v}GB` },
                        ...(logScale ? { min: 0.01 } : {})
                    }
                }
            }
        });
    }
}
