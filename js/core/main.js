// Config for the UI Nodes and logic

// Elements
export const UINodes = {
    statusDot: document.querySelector('.status-dot'),
    statusText: document.getElementById('system-status'),
    progressBar: document.getElementById('scan-progress-bar'),
    filesProcessed: document.getElementById('files-processed'),
    btnFetch: document.getElementById('btn-fetch'),

    // Shared header stat bar
    valTotal:   document.querySelector('#shared-stat-total   .stat-number'),
    valUsed:    document.querySelector('#shared-stat-used    .stat-number'),
    valFree:    document.querySelector('#shared-stat-free    .stat-number'),
    valScanned: document.querySelector('#shared-stat-scanned .stat-number'),
    valPct:     document.querySelector('#shared-stat-pct     .stat-number'),
    timeRange:  document.getElementById('data-timerange')
};

// Global Store
export const AppState = {
    isProcessing: false,
    filesTotal: 0,
    filesProcessed: 0,
    chartManagerInstance: null,
};

// Start application
export function initApp() {
    UINodes.statusText.textContent = "System Ready to Fetch";
}

// Simple CountUp animation for the numbers
export function animateValue(obj, start, end, duration) {
    if (!obj) return;
    // Respect user's motion preference (accessibility)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        obj.textContent = end.toFixed(2);
        return;
    }
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        
        // Format to 2 decimal points TB (assume input is TB)
        const currentVal = (progress * (end - start) + start);
        obj.textContent = currentVal.toFixed(2);
        
        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            obj.textContent = end.toFixed(2);
        }
    };
    window.requestAnimationFrame(step);
}

// Convert bytes to TB (decimal: 1 TB = 1,000,000,000,000 bytes)
export function bytesToTB(bytes) {
    return bytes / 1e12;
}

// ── TASK-06: Toast Notification System ────────────────────────────────────────

const TOAST_ICONS = {
    success: `
<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"></circle>
    <path d="M8 12.5l2.5 2.5L16 9.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path>
</svg>`,
    error: `
<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"></circle>
    <path d="M9 9l6 6M15 9l-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path>
</svg>`,
    warning: `
<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 4l9 16H3L12 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>
    <path d="M12 9v5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path>
    <circle cx="12" cy="17" r="1.2" fill="currentColor"></circle>
</svg>`,
    info: `
<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"></circle>
    <path d="M12 10v6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path>
    <circle cx="12" cy="7.5" r="1.1" fill="currentColor"></circle>
</svg>`,
};

const LOADING_SPINNER_SVG = `
<svg class="toast-spinner-svg" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2" opacity="0.25"></circle>
    <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path>
</svg>`;

/**
 * Show a toast notification.
 * @param {string} title   - Main message (required)
 * @param {string} [desc]  - Sub-text (optional)
 * @param {'success'|'error'|'warning'|'info'} [type] - Visual variant
 * @param {number} [duration] - Auto-dismiss ms (default 3200)
 */
export function showToast(title, desc = '', type = 'success', duration = 3200) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast${type !== 'success' ? ` toast-${type}` : ''}`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
        <span class="toast-icon">${TOAST_ICONS[type] ?? TOAST_ICONS.success}</span>
        <div class="toast-body">
            <span class="toast-title">${title}</span>
            ${desc ? `<span class="toast-desc">${desc}</span>` : ''}
        </div>`;

    const dismiss = () => {
        toast.classList.add('toast-exiting');
        setTimeout(() => toast.remove(), 280);
    };

    toast.addEventListener('click', dismiss);
    container.appendChild(toast);

    // Auto-dismiss
    setTimeout(dismiss, duration);
}

/**
 * Show a persistent progress toast
 */
export function showProgressToast(id, title) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    let toast = document.getElementById(id);
    if (!toast) {
        toast = document.createElement('div');
        toast.id = id;
        toast.className = 'toast toast-info';
        toast.style.display = 'flex';
        toast.style.flexDirection = 'column';
        toast.style.alignItems = 'stretch';
        toast.style.cursor = 'default';
        toast.style.minWidth = '280px';
        toast.innerHTML = `
            <div style="display:flex; align-items:center; gap: 8px; margin-bottom: 8px;">
                <span class="toast-icon toast-icon-spinner">${LOADING_SPINNER_SVG}</span>
                <span class="toast-title" style="flex:1;">${title}</span>
                <span class="toast-desc" id="${id}-desc" style="font-variant-numeric:tabular-nums; font-size: 0.75rem; color: var(--text-secondary);">0%</span>
            </div>
            <div style="height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                <div id="${id}-bar" style="height: 100%; width: 0%; background: linear-gradient(90deg, #10b981, #0ea5e9); transition: width 0.2s;"></div>
            </div>
        `;
        container.appendChild(toast);
    }
}

/**
 * Update a persistent progress toast
 */
export function updateProgressToast(id, pct, descLabel) {
    const desc = document.getElementById(`${id}-desc`);
    const bar = document.getElementById(`${id}-bar`);
    if (desc) desc.textContent = descLabel !== undefined ? descLabel : `${Math.round(pct)}%`;
    if (bar) bar.style.width = `${Math.round(pct)}%`;
}

/**
 * Close a persistent progress toast
 */
export function closeProgressToast(id) {
    const toast = document.getElementById(id);
    if (toast) {
        toast.classList.add('toast-exiting');
        setTimeout(() => toast.remove(), 280);
    }
}
