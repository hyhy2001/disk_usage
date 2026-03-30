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
    success: '✓',
    error:   '✕',
    warning: '⚠',
    info:    'ℹ',
};

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
        <span class="toast-icon">${TOAST_ICONS[type] ?? '✓'}</span>
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

// ── TASK-07: Settings Dropdown ────────────────────────────────────────────────
export function initSettingsDropdown() {
    const btn = document.getElementById('btn-settings-toggle');
    const dropdown = document.getElementById('settings-dropdown');
    
    if (!btn || !dropdown) return;
    
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dropdown.style.display === 'none') {
            dropdown.style.display = 'flex';
            dropdown.style.animation = 'dropdownPop 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
        } else {
            dropdown.style.display = 'none';
        }
    });
    
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });
}

// Call on load
document.addEventListener('DOMContentLoaded', initSettingsDropdown);
