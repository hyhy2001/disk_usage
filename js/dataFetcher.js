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

// ── API helper — all data flows through api.php ───────────────────────────────
async function callApi(params = {}) {
    const formData = new FormData();
    for (const [key, val] of Object.entries(params)) {
        formData.append(key, val);
    }
    const res = await fetch('api.php', { method: 'POST', body: formData });
    if (!res.ok) throw new Error(`HTTP ${res.status} from api.php`);
    return res.json();
}

class DataFetcher {
    constructor() {
        this.dataStore = new DataStore();
        this._activeDisk = null;

        AppState.chartManagerInstance = new ChartManager();

        if (UINodes.btnFetch) {
            UINodes.btnFetch.addEventListener('click', () => this.startServerSync());
        }

        startClock();

        this._initDiskSelector().then(() => {
            setTimeout(() => this.startServerSync(), 300);
        });
    }

    // ── Load disk list from api.php (no drive param = list disks) ─────────────
    async _initDiskSelector() {
        try {
            const json = await callApi({});
            if (json.status !== 'success' || !Array.isArray(json.disks)) {
                console.warn('list disks returned unexpected response:', json);
                return;
            }

            this.disksConfig = json.disks;

            const select = document.getElementById('disk-select');
            if (!select) return;

            select.innerHTML = json.disks.map(d => `
                <option value="${d.id}">${d.name}</option>
            `).join('');

            if (json.disks.length > 0) {
                this._activeDisk = json.disks[0].id;
                select.value = json.disks[0].id;
                this._updateDiskPath(json.disks[0]);
            }

            select.addEventListener('change', () => {
                this._activeDisk = select.value;
                const disk = this.disksConfig?.find(d => d.id === select.value);
                this._updateDiskPath(disk);
                this.startServerSync();
            });
        } catch (e) {
            console.warn('Could not load disk list:', e);
        }
    }

    _updateDiskPath(disk) {
        const pathEl = document.getElementById('header-disk-path');
        if (pathEl && disk) {
            pathEl.textContent = disk.dir || disk.name || '';
            pathEl.title = disk.name || disk.dir || '';
        }
    }

    // ── Fetch disk usage data ─────────────────────────────────────────────────
    async startServerSync() {
        if (AppState.isProcessing) return;
        if (!this._activeDisk) {
            UINodes.statusText.textContent = 'No valid disk to scan.';
            return;
        }

        try {
            this.setProcessingState(true);
            UINodes.statusText.textContent = 'Connecting to API...';

            const jsonResponse = await callApi({ drive: this._activeDisk });

            if (jsonResponse.status !== 'success' || !jsonResponse.data || jsonResponse.data.length === 0) {
                UINodes.statusText.textContent = 'No JSON reports found or API returned an error.';
                this.setProcessingState(false);
                return;
            }

            UINodes.statusText.textContent = 'Loading payload...';
            AppState.filesTotal = jsonResponse.total_files;
            UINodes.filesProcessed.textContent = `0/${AppState.filesTotal} files`;

            this.dataStore = new DataStore();

            UINodes.statusText.textContent = 'Aggregating metrics...';
            this.dataStore.processChunk(jsonResponse.data);

            AppState.filesProcessed = AppState.filesTotal;
            UINodes.progressBar.style.width = '100%';
            UINodes.filesProcessed.textContent = `${AppState.filesTotal}/${AppState.filesTotal} files`;

            const now = new Date();
            const dStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const tStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const syncEl = document.getElementById('last-sync-time');
            if (syncEl) syncEl.textContent = `${dStr} ${tStr}`;

            this.handleComplete();
            this._fetchPermissions();

        } catch (error) {
            console.error('Server API Sync Failed:', error);
            this.setProcessingState(false);
            UINodes.statusText.textContent = 'Error: ' + error.message;
            UINodes.statusDot.classList.remove('scanning');
            UINodes.statusDot.style.backgroundColor = 'var(--rose-500)';
        }
    }

    // ── Fetch permission issues ───────────────────────────────────────────────
    async _fetchPermissions() {
        try {
            const json = await callApi({ drive: this._activeDisk, p: '1' });
            if (json?.status === 'success') {
                this.dataStore.permissionIssues = json.data ?? null;
                document.dispatchEvent(new CustomEvent('permissionsLoaded', { detail: json.data }));
            }
        } catch (e) {
            console.warn('Could not load permission issues:', e);
        }
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
