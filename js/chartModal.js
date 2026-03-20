/**
 * chartModal.js — Full-screen chart expand modal
 * Features: expand/collapse, download PNG, keyboard (Esc), smooth animation
 */

import { AppState } from './main.js';

// ── Create modal DOM ─────────────────────────────────────────────────────────
function buildModal() {
    const el = document.createElement('div');
    el.id = 'chart-modal';
    el.className = 'chart-modal-overlay';
    el.innerHTML = `
        <div class="chart-modal-box" role="dialog" aria-modal="true">
            <div class="chart-modal-header">
                <span class="chart-modal-title" id="chart-modal-title"></span>
                <div class="chart-modal-actions">
                    <button class="chart-modal-btn" id="btn-modal-download" title="Download as PNG">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        PNG
                    </button>
                    <button class="chart-modal-btn chart-modal-close" id="btn-modal-close" title="Close (Esc)">✕</button>
                </div>
            </div>
            <div class="chart-modal-body">
                <canvas id="chart-modal-canvas"></canvas>
            </div>
            <div class="chart-modal-hint">Press <kbd>Esc</kbd> to close · Hover for details</div>
        </div>`;
    document.body.appendChild(el);
    return el;
}

// ── Render chart in modal canvas ─────────────────────────────────────────────
function renderModalChart(chartType) {
    const chartMgr = AppState.chartManagerInstance;
    if (!chartMgr) return;

    const canvas  = document.getElementById('chart-modal-canvas');
    const titleEl = document.getElementById('chart-modal-title');
    const ctx     = canvas.getContext('2d');

    // Destroy previous modal chart instance
    if (window._modalChart) {
        window._modalChart.destroy();
        window._modalChart = null;
    }

    if (chartType === 'trend') {
        // Copy config from the live trend chart
        const src = chartMgr._histTotalChart;
        if (!src) return;
        titleEl.textContent = '📈 Selected Users Usage — Full View';
        window._modalChart = new Chart(ctx, {
            type: src.config.type,
            data: JSON.parse(JSON.stringify(src.config.data)),
            options: {
                ...JSON.parse(JSON.stringify(src.config.options)),
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    ...src.config.options.plugins,
                    legend: {
                        ...src.config.options.plugins?.legend,
                        labels: { ...src.config.options.plugins?.legend?.labels, font: { size: 12 } }
                    }
                }
            }
        });
    } else if (chartType === 'growers') {
        const src = chartMgr._histGrowersChart;
        if (!src) return;
        titleEl.textContent = '🔥 Fastest Growing Users — Full View';
        window._modalChart = new Chart(ctx, {
            type: src.config.type,
            data: JSON.parse(JSON.stringify(src.config.data)),
            options: {
                ...JSON.parse(JSON.stringify(src.config.options)),
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    ...src.config.options.plugins,
                    legend: { display: false }
                }
            }
        });
    }
}

// ── Open / Close ─────────────────────────────────────────────────────────────
let _modal = null;

function openModal(chartType) {
    if (!_modal) _modal = buildModal();

    _modal.classList.add('visible');
    document.body.style.overflow = 'hidden';

    // Slight delay so canvas has size after CSS transition
    setTimeout(() => renderModalChart(chartType), 80);

    // Download button
    document.getElementById('btn-modal-download').onclick = () => {
        const canvas = document.getElementById('chart-modal-canvas');
        const link   = document.createElement('a');
        link.download = `chart-${chartType}-${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    };
}

function closeModal() {
    if (!_modal) return;
    _modal.classList.remove('visible');
    document.body.style.overflow = '';
    if (window._modalChart) {
        window._modalChart.destroy();
        window._modalChart = null;
    }
}

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Delegate expand button clicks
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.chart-expand-btn');
        if (btn) openModal(btn.dataset.chart);

        if (e.target.id === 'btn-modal-close' || e.target.id === 'chart-modal') closeModal();
    });

    // Backdrop click to close
    document.addEventListener('click', (e) => {
        if (e.target.id === 'chart-modal') closeModal();
    });

    // ESC to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
});
