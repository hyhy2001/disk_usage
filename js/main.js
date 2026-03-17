// Config for the UI Nodes and logic

// Elements
export const UINodes = {
    statusDot: document.querySelector('.status-dot'),
    statusText: document.getElementById('system-status'),
    progressBar: document.getElementById('scan-progress-bar'),
    filesProcessed: document.getElementById('files-processed'),
    btnFetch: document.getElementById('btn-fetch'),
    
    valTotal: document.getElementById('val-total'),
    valUsed: document.getElementById('val-used'),
    valFree: document.getElementById('val-free'),
    timeRange: document.getElementById('data-timerange')
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
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        
        // Format to 2 decimal points TB (assume input is TB)
        const currentVal = (progress * (end - start) + start);
        obj.innerHTML = currentVal.toFixed(2);
        
        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            obj.innerHTML = end.toFixed(2);
        }
    };
    window.requestAnimationFrame(step);
}

// Function to convert bytes to TB
export function bytesToTB(bytes) {
    return bytes / (1024 * 1024 * 1024 * 1024);
}
