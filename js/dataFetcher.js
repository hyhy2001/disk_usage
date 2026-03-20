import { UINodes, AppState, animateValue, bytesToTB } from './main.js';
import { DataStore } from './dataStore.js';
import { ChartManager } from './chartManager.js';
import { initRouter } from './router.js';
import { renderDetailTables, initScaleToggle } from './detailRenderer.js';

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
        
        // Initialize charts
        AppState.chartManagerInstance = new ChartManager();

        // Bind events
        if (UINodes.btnFetch) {
            UINodes.btnFetch.addEventListener('click', () => this.startServerSync());
        }

        // Start live clock
        startClock();

        // Load disk list then auto-fetch
        this._initDiskSelector().then(() => {
            setTimeout(() => this.startServerSync(), 300);
        });
    }

    async _initDiskSelector() {
        try {
            // Fetch disks.json directly as static file — no PHP needed
            const res = await fetch('disks.json');
            const disks = await res.json();
            this.disksConfig = disks;

            const list = document.getElementById('disk-list');
            if (!list) return;

            list.innerHTML = disks.map(d => `
                <div class="disk-list-item" data-id="${d.id}">${d.name}</div>
            `).join('');

            const items = list.querySelectorAll('.disk-list-item');

            const activate = (id) => {
                items.forEach(el => el.classList.toggle('active', el.dataset.id === id));
                this._activeDisk = id;
                const disk = disks.find(d => d.id === id);
                this._updateDiskPath(disk);
            };

            items.forEach(el => {
                el.addEventListener('click', () => {
                    if (el.dataset.id === this._activeDisk) return;
                    activate(el.dataset.id);
                    this.startServerSync();
                });
            });

            if (disks.length > 0) activate(disks[0].id);

            // Disk search filter
            const searchInput = document.getElementById('disk-search');
            if (searchInput) {
                searchInput.addEventListener('input', () => {
                    const q = searchInput.value.toLowerCase().trim();
                    list.querySelectorAll('.disk-list-item').forEach(el => {
                        const match = el.textContent.toLowerCase().includes(q);
                        el.style.display = match ? '' : 'none';
                    });
                });
            }


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


    async startServerSync() {
        if (AppState.isProcessing) return;
        if (!this._activeDisk) {
            UINodes.statusText.textContent = "No valid disk to scan.";
            return;
        }
        
        try {
            this.setProcessingState(true);

            UINodes.statusText.textContent = "Connecting to API...";
            // Get disk path from disksConfig
            const diskConf = this.disksConfig?.find(d => d.id === this._activeDisk);
            const diskPath = diskConf?.path || this._activeDisk;
            const response = await fetch(`api.php?dir=${encodeURIComponent(diskPath)}&type=reports`);
            if (!response.ok) throw new Error(`HTTP error ${response.status} from api.php.`);
            const jsonResponse = await response.json();
            
            if ((jsonResponse.status && jsonResponse.status !== 'success') || !jsonResponse.data || jsonResponse.data.length === 0) {
                alert("No JSON reports found or API returned an error.");
                this.setProcessingState(false);
                return;
            }

            UINodes.statusText.textContent = "Loading payload...";
            AppState.filesTotal = jsonResponse.total_files;
            UINodes.filesProcessed.textContent = `0/${AppState.filesTotal} files`;
            
            this.dataStore = new DataStore();
            
            UINodes.statusText.textContent = "Aggregating metrics...";
            
            this.dataStore.processChunk(jsonResponse.data);
            
            AppState.filesProcessed = AppState.filesTotal;
            UINodes.progressBar.style.width = `100%`;
            UINodes.filesProcessed.textContent = `${AppState.filesTotal}/${AppState.filesTotal} files`;

            const now = new Date();
            const dStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const tStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const syncEl = document.getElementById('last-sync-time');
            if (syncEl) syncEl.textContent = `${dStr} ${tStr}`;

            this.handleComplete();

            // Also fetch latest permission issues for this disk
            this._fetchPermissions();
            
        } catch (error) {
            console.error("Server API Sync Failed:", error);
            this.setProcessingState(false);
            UINodes.statusText.textContent = "Error: " + error.message;
            UINodes.statusDot.classList.remove('scanning');
            UINodes.statusDot.style.backgroundColor = 'var(--rose-500)';
        }
    }

    async _fetchPermissions() {
        try {
            const diskConf = this.disksConfig?.find(d => d.id === this._activeDisk);
            const diskPath = diskConf?.path || this._activeDisk;
            const res = await fetch(`permission_api.php?dir=${encodeURIComponent(diskPath)}`);
            const json = await res.json();

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
        UINodes.statusText.textContent = "System Optimized";
        
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
        const usagePct     = stats.total ? ((stats.used / stats.total) * 100) : 0;

        const setText = (el, val) => { if (el) el.textContent = val; };
        const animateEl = (el, prev, next) => { if (el) animateValue(el, prev, next, 1200); };

        animateEl(UINodes.valTotal,   parseFloat(UINodes.valTotal?.textContent)   || 0, totalTB);
        animateEl(UINodes.valUsed,    parseFloat(UINodes.valUsed?.textContent)    || 0, usedTB);
        animateEl(UINodes.valFree,    parseFloat(UINodes.valFree?.textContent)    || 0, availableTB);
        animateEl(UINodes.valScanned, parseFloat(UINodes.valScanned?.textContent) || 0, scannedTB);

        // Usage % (formatted separately — not TB)
        if (UINodes.valPct) {
            UINodes.valPct.textContent = usagePct.toFixed(1) + '%';
            UINodes.valPct.style.color = usagePct > 80 ? '#f43f5e' : '';
        }

        // Update disk path from the actual report directory
        const dirPath = this.dataStore.latestSnapshot?.directory;
        const activeDisk = this.disksConfig?.find(d => d.id === this._activeDisk);
        const diskPathEl = document.getElementById('header-disk-path');
        if (diskPathEl) {
            diskPathEl.textContent = dirPath || activeDisk?.name || '';
        }

        // Update page title based on active page
        const titleEl = document.getElementById('shared-page-title');
        if (titleEl && activeDisk) titleEl.textContent = activeDisk.name || 'Disk Usage';

        // ── Scan Summary Bar ──────────────────────────────────────────
        const gapBytes = Math.max(0, stats.used - scannedBytes);
        const gapPct   = stats.used ? ((gapBytes / stats.used) * 100).toFixed(1) : '0.0';
        const fmtBytes = b => {
            if (b >= 1e12) return (b/1e12).toFixed(1) + ' TB';
            if (b >= 1e9)  return (b/1e9).toFixed(1)  + ' GB';
            if (b >= 1e6)  return (b/1e6).toFixed(1)  + ' MB';
            return (b/1e3).toFixed(0) + ' KB';
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
            setTimeout(() => {
                UINodes.progressBar.style.width = '100%';
            }, 300);
        }
    }
}

// Bootstrap
document.addEventListener('DOMContentLoaded', () => {
    initRouter();
    initScaleToggle();
    window.appFetcher = new DataFetcher();
});

