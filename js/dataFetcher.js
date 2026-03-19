import { UINodes, AppState, animateValue, bytesToTB } from './main.js';
import { DataStore } from './dataStore.js';
import { ChartManager } from './chartManager.js';
import { initRouter } from './router.js';
import { renderDetailTables } from './detailRenderer.js';

// ── Sidebar live clock ────────────────────────────────────────────────────────
function startClock() {
    const el = document.getElementById('sidebar-clock');
    if (!el) return;
    const tick = () => {
        const now = new Date();
        el.textContent = now.toLocaleString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        });
    };
    tick();
    setInterval(tick, 1000);
}

class DataFetcher {
    constructor() {
        this.dataStore = new DataStore();
        this._activeDisk = null;
        this._cache = window.__DISK_DATA__ ?? null; // Data embedded by PHP at page load

        AppState.chartManagerInstance = new ChartManager();

        if (UINodes.btnFetch) {
            // "Sync Now" reloads the page — PHP will re-read fresh data
            UINodes.btnFetch.addEventListener('click', () => window.location.reload());
        }

        startClock();
        this._initDiskSelector();
    }

    // ── Populate disk selector from inline data ───────────────────────────────
    _initDiskSelector() {
        const json = this._cache;

        if (!json || json.status !== 'success' || !Array.isArray(json.disks) || json.disks.length === 0) {
            UINodes.statusText.textContent = 'No disk data available.';
            return;
        }

        const select = document.getElementById('disk-select');
        if (select) {
            select.innerHTML = json.disks.map(d => `
                <option value="${d.id}">${d.name}</option>
            `).join('');
        }

        this._activeDisk = json.disks[0].id;
        if (select) select.value = json.disks[0].id;
        this._updateDiskPath(json.disks[0]);

        if (select) {
            select.addEventListener('change', () => {
                this._activeDisk = select.value;
                const disk = json.disks.find(d => d.id === select.value);
                this._updateDiskPath(disk);
                this._renderDisk(disk);
            });
        }

        // Auto-render first disk
        this._renderDisk(json.disks[0]);
    }

    _updateDiskPath(disk) {
        const pathEl = document.getElementById('header-disk-path');
        if (pathEl && disk) {
            pathEl.textContent = disk.dir || disk.name || '';
            pathEl.title = disk.name || disk.dir || '';
        }
    }

    // ── Render a disk's data (all from inline cache) ──────────────────────────
    _renderDisk(disk) {
        if (!disk?.data?.length) {
            UINodes.statusText.textContent = 'No JSON reports found for this disk.';
            this.setProcessingState(false);
            return;
        }

        this.setProcessingState(true);
        UINodes.statusText.textContent = 'Loading payload...';
        AppState.filesTotal = disk.files;
        UINodes.filesProcessed.textContent = `0/${AppState.filesTotal} files`;

        this.dataStore = new DataStore();
        UINodes.statusText.textContent = 'Aggregating metrics...';
        this.dataStore.processChunk(disk.data);

        AppState.filesProcessed = AppState.filesTotal;
        UINodes.progressBar.style.width = '100%';
        UINodes.filesProcessed.textContent = `${AppState.filesTotal}/${AppState.filesTotal} files`;

        const now = new Date();
        const dStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const tStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const syncEl = document.getElementById('last-sync-time');
        if (syncEl) syncEl.textContent = `${dStr} ${tStr}`;

        if (disk.perms !== undefined) {
            this.dataStore.permissionIssues = disk.perms ?? null;
            document.dispatchEvent(new CustomEvent('permissionsLoaded', { detail: disk.perms }));
        }

        this.handleComplete();
    }

    handleComplete() {
        this.setProcessingState(false);
        UINodes.statusText.textContent = 'System Optimized';

        this.dataStore.finalizeProcessing();
        this.updateMetricCards();
        AppState.chartManagerInstance.render(this.dataStore);
        renderDetailTables(this.dataStore);
    }

    updateMetricCards() {
        const stats = this.dataStore.latestStats;

        const totalTB     = bytesToTB(stats.total);
        const usedTB      = bytesToTB(stats.used);
        const availableTB = bytesToTB(stats.available);
        const scannedBytes = (this.dataStore.latestSnapshot?.teams || []).reduce((s, t) => s + (t.used || 0), 0);
        const scannedTB    = bytesToTB(scannedBytes);

        const prevTotal   = parseFloat(UINodes.valTotal.textContent)    || 0;
        const prevUsed    = parseFloat(UINodes.valUsed.textContent)     || 0;
        const prevFree    = parseFloat(UINodes.valFree.textContent)     || 0;
        const prevScanned = parseFloat(UINodes.valScanned?.textContent) || 0;

        animateValue(UINodes.valTotal,   prevTotal,   totalTB,     1200);
        animateValue(UINodes.valUsed,    prevUsed,    usedTB,      1200);
        animateValue(UINodes.valFree,    prevFree,    availableTB, 1200);
        if (UINodes.valScanned) animateValue(UINodes.valScanned, prevScanned, scannedTB, 1200);

        // ── Scan Summary Bar ──────────────────────────────────────────────────
        const gapBytes = Math.max(0, stats.used - scannedBytes);
        const gapPct   = stats.used ? ((gapBytes / stats.used) * 100).toFixed(1) : '0.0';
        const fmtBytes = b => {
            if (b >= 1e12) return (b / 1e12).toFixed(1) + ' TB';
            if (b >= 1e9)  return (b / 1e9).toFixed(1)  + ' GB';
            if (b >= 1e6)  return (b / 1e6).toFixed(1)  + ' MB';
            return (b / 1e3).toFixed(0) + ' KB';
        };
        const getEl = id => document.getElementById(id);
        const ssbScan = getEl('ssb-scan-val');
        const ssbFill = getEl('ssb-gap-fill');
        const ssbPct  = getEl('ssb-gap-pct');
        const ssbGVal = getEl('ssb-gap-val');
        if (ssbScan) ssbScan.textContent = fmtBytes(scannedBytes);
        if (ssbFill) ssbFill.style.width = `${gapPct}%`;
        if (ssbPct)  ssbPct.textContent  = `${gapPct}%`;
        if (ssbGVal) ssbGVal.textContent  = fmtBytes(gapBytes);

        if (stats.date) {
            const d = new Date(stats.date * 1000);
            UINodes.timeRange.textContent = `Latest snapshot from ${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
        }
    }

    setProcessingState(isProcessing) {
        AppState.isProcessing = isProcessing;
        UINodes.btnFetch.disabled = isProcessing;

        if (isProcessing) {
            UINodes.statusDot.classList.add('scanning');
            UINodes.statusDot.style.backgroundColor = '';
            UINodes.progressBar.style.width = '0%';
        } else {
            UINodes.statusDot.classList.remove('scanning');
            setTimeout(() => { UINodes.progressBar.style.width = '100%'; }, 300);
        }
    }
}

// Bootstrap
document.addEventListener('DOMContentLoaded', () => {
    initRouter();
    window.appFetcher = new DataFetcher();
});
