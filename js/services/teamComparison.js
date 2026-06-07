// teamComparison.js — Team Comparison bar chart + view-mode helper.
// Extracted verbatim from dataFetcher (pure, zero `this.` — no instance state).

import { compareDiskCards, extractFromApiDisk } from '../utils/sort.js';
import { fmt } from '../utils/formatters.js';

export function getTeamChartApiMode() {
    const storedMode = localStorage.getItem('teamChartViewMode') || 'absolute-linear';
    if (storedMode === 'absolute-log') return 'logarithmic';
    if (storedMode === 'percent') return 'percent';
    return 'linear';
}

export function renderTeamComparisonChart(data, mode) {
    const canvasWrapper = document.getElementById('team-comparison-canvas-wrapper');

    if (window._teamCompChart) {
        window._teamCompChart.destroy();
    }

    // Dynamically set width based on number of disks
    if (canvasWrapper) {
        const minW = Math.max(100, data.length * 60);
        canvasWrapper.style.width = `max(100%, ${minW}px)`;
    }

    const ctx = document.getElementById('teamComparisonChart');
    if (!ctx) return;

    const labels = [];
    const usedData = [];
    const freeData = [];
    const absoluteData = []; // for tooltips
    const css = getComputedStyle(document.documentElement);
    const textSecondary = (css.getPropertyValue('--text-secondary') || '').trim() || '#94a3b8';
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    const gridColor = theme === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.08)';

    const currentSort = localStorage.getItem('teamDiskSort') || 'alpha-asc';

    const sortedData = [...data].sort((a, b) =>
        compareDiskCards(a, b, currentSort, extractFromApiDisk));

    sortedData.forEach(d => {
        const sys = d.general_system || {};
        const total = sys.total || 0;
        const used = sys.used || 0;
        const free = Math.max(0, total - used);
        const diskName = d._disk_name || 'Disk';

        labels.push(diskName);
        absoluteData.push({ total, used, free });

        if (mode === 'percent' && total > 0) {
            usedData.push({ x: diskName, y: (used / total) * 100 });
            freeData.push({ x: diskName, y: (free / total) * 100 });
        } else {
            // Logarithmic scale cannot handle 0 values, use a tiny positive floor
            const valUsed = mode === 'logarithmic' ? Math.max(0.1, used) : used;
            const valFree = mode === 'logarithmic' ? Math.max(0.1, free) : free;
            usedData.push({ x: diskName, y: valUsed });
            freeData.push({ x: diskName, y: valFree });
        }
    });

    window._teamCompChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Used',
                    data: usedData,
                    backgroundColor: '#f43f5e',
                    stack: 'Stack 0',
                    barPercentage: 0.7,
                },
                {
                    label: 'Free',
                    data: freeData,
                    backgroundColor: '#10b981',
                    stack: 'Stack 0',
                    barPercentage: 0.7,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const dsLabel = context.dataset.label;
                            const idx = context.dataIndex;
                            const abs = absoluteData[idx];
                            const rawVal = abs[dsLabel.toLowerCase()];
                            const formatted = fmt(rawVal);
                            if (mode === 'percent') {
                                return `${dsLabel}: ${context.parsed.y.toFixed(1)}% (${formatted})`;
                            }
                            return `${dsLabel}: ${formatted}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    grid: { display: false, color: gridColor },
                    ticks: {
                        color: textSecondary,
                        autoSkip: false,
                        maxRotation: 45,
                        minRotation: 45
                    }
                },
                y: {
                    type: mode === 'logarithmic' ? 'logarithmic' : 'linear',
                    stacked: mode !== 'logarithmic',
                    grid: { color: gridColor },
                    ticks: {
                        color: textSecondary,
                        callback: function (value) {
                            if (mode === 'percent') return value + '%';
                            return fmt(value);
                        }
                    },
                    max: mode === 'percent' ? 100 : undefined
                }
            }
        }
    });

    // --- Populate Team Insights Grid ---
    const insightsGrid = document.getElementById('team-comparison-insights');
    if (insightsGrid) {
        let count30 = 0, count50 = 0, count70 = 0, count90 = 0;

        data.forEach(d => {
            const sys = d.general_system || {};
            const t = sys.total || 0;
            const u = sys.used || 0;
            const ratio = t > 0 ? (u / t) : 0;

            if (ratio >= 0.3 && ratio < 0.5) count30++;
            else if (ratio >= 0.5 && ratio < 0.7) count50++;
            else if (ratio >= 0.7 && ratio < 0.9) count70++;
            else if (ratio >= 0.9) count90++;
        });

        insightsGrid.innerHTML = `
                <div class="stat-card" style="background: var(--bg-surface); padding: 16px; border-radius: 12px; border: var(--glass-border);">
                    <div style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 8px;">Stable: 30-50%</div>
                    <div style="font-size: 1.5rem; font-weight: 600; color: var(--emerald-500, #10b981);">${count30}</div>
                </div>
                <div class="stat-card" style="background: var(--bg-surface); padding: 16px; border-radius: 12px; border: var(--glass-border);">
                    <div style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 8px;">Attention: 50-70%</div>
                    <div style="font-size: 1.5rem; font-weight: 600; color: var(--sky-500, #3b82f6);">${count50}</div>
                </div>
                <div class="stat-card" style="background: var(--bg-surface); padding: 16px; border-radius: 12px; border: var(--glass-border);">
                    <div style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 8px;">Warning: 70-90%</div>
                    <div style="font-size: 1.5rem; font-weight: 600; color: var(--amber-500, #f59e0b);">${count70}</div>
                </div>
                <div class="stat-card" style="background: var(--bg-surface); padding: 16px; border-radius: 12px; border: var(--glass-border);">
                    <div style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 8px;">Critical: > 90%</div>
                    <div style="font-size: 1.5rem; font-weight: 600; color: var(--rose-500, #f43f5e);">${count90}</div>
                </div>
            `;
    }
}
