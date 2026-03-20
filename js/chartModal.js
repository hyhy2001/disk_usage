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

    if (window._modalChart) {
        window._modalChart.destroy();
        window._modalChart = null;
    }

    const chartMap = {
        trend:    { src: () => chartMgr._histTotalChart,    label: '📈 Selected Users Usage — Full View' },
        growers:  { src: () => chartMgr._histGrowersChart,  label: '🔥 Fastest Growing Users — Full View' },
        timeline: { src: () => chartMgr.timelineChart,      label: '📊 Capacity Over Time — Full View' },
        team:     { src: () => chartMgr.teamChart,          label: '🍩 Usage by Teams — Full View' },
        users:    { src: () => chartMgr.usersChart,         label: '👤 Top Consuming Users — Full View' },
    };

    const entry = chartMap[chartType];
    if (!entry) return;
    const src = entry.src();
    if (!src) return;

    titleEl.textContent = entry.label;

    // Deep clone ONLY the data (plain JSON). Re-use options AS-IS to preserve
    // all callback functions (formatters, tooltips, etc.)
    const clonedData = JSON.parse(JSON.stringify(src.config.data));

    // For timeline: rebuild gradient on modal canvas & re-attach to dataset
    if (chartType === 'timeline') {
        const h = canvas.parentElement?.offsetHeight || 560;
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0,   'rgba(251, 191, 36, 0.28)');
        grad.addColorStop(0.6, 'rgba(251, 191, 36, 0.07)');
        grad.addColorStop(1,   'rgba(251, 191, 36, 0.02)');
        if (clonedData.datasets[0]) clonedData.datasets[0].backgroundColor = grad;
    }

    window._modalChart = new Chart(ctx, {
        type: src.config.type,
        plugins: src.config.plugins || [],   // inline plugins (centerText, refLine, etc.)
        data: clonedData,
        // Re-use the original options object — keeps all callbacks intact
        options: {
            ...src.config.options,
            responsive: true,
            maintainAspectRatio: false,
        }
    });
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
