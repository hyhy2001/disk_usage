import { UINodes, AppState, animateValue, bytesToTB, showToast } from './main.js';
import { DataStore } from './dataStore.js';
import { ChartManager } from './chartManager.js';
import { initRouter } from './router.js';
import { renderDetailTables, initScaleToggle, resetDashboardToEmpty } from './detailRenderer.js';
import { initUserDetailTab, resetUserDetailTab } from './userDetailRenderer.js';
import { fmt } from './formatters.js';
import { saveFilters, loadFilters } from './filterStorage.js';

// ── Sidebar live clock ────────────────────────────────────────────────────────
// Cache formatter to avoid re-creating Intl.DateTimeFormat every second (PF-02)
const _clockFmt = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
});

function startClock() {
    const el = document.getElementById('sidebar-clock');
    if (!el) return;
    const tick = () => { el.textContent = _clockFmt.format(new Date()); };
    tick();
    setInterval(tick, 1000);
}

class DataFetcher {
    constructor() {
        this.dataStore = new DataStore();
        this._activeDisk = null;
        this._permissionsLoaded = false;

        // Initialize charts
        AppState.chartManagerInstance = new ChartManager();

        // Bind events
        if (UINodes.btnFetch) {
            UINodes.btnFetch.addEventListener('click', () => this.startServerSync());
        }

        // Lazy-load permissions on tab click
        const permTab = document.querySelector('.detail-tab-btn[data-tab="permissions"]');
        if (permTab) {
            permTab.addEventListener('click', () => {
                if (!this._permissionsLoaded && this._activeDisk) {
                    this._fetchPermissions();
                }
            });
        }

        // Lazy-load Detail User tab on click
        const userDetailTab = document.querySelector('.detail-tab-btn[data-tab="user-detail"]');
        if (userDetailTab) {
            userDetailTab.addEventListener('click', () => {
                if (this._activeDisk) {
                    const diskConf = this.disksConfig?.find(d => d.id === this._activeDisk);
                    const diskPath = diskConf?.path || this._activeDisk;
                    const otherUsers = (this.dataStore?.latestSnapshot?.other || [])
                        .map(o => ({ name: o.name, used: o.used }));
                    initUserDetailTab(diskPath, otherUsers);
                }
            });
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
            // TASK-04: Show skeleton while fetching disk list
            const list = document.getElementById('disk-list');
            if (list) {
                const skeletonHTML = Array(3).fill(0)
                    .map(() => '<div class="skeleton skeleton-disk-item"></div>').join('');
                list.innerHTML = skeletonHTML;
            }
            // Fetch disks.json directly as static file — no PHP needed
            const res = await fetch('disks.json');
            const disks = await res.json();
            this.disksConfig = disks;

            if (!list) return;

            // Helper: build disk items HTML
            const buildItems = (container, disks, activate) => {
                // TASK-04: Show skeleton while building for a brief moment
                container.innerHTML = disks.map(d =>
                    `<div class="disk-list-item" data-id="${d.id}" tabindex="0" role="option" aria-selected="false" aria-label="${d.name}${d.path ? ' — ' + d.path : ''}">${d.name}</div>`
                ).join('');
                container.querySelectorAll('.disk-list-item').forEach(el => {
                    el.addEventListener('click', () => {
                        if (el.dataset.id === this._activeDisk) return;
                        activate(el.dataset.id);
                        this.startServerSync();
                        // Close mobile sidebar when disk is selected (PF-03)
                        document.dispatchEvent(new CustomEvent('diskSelected'));
                    });
                    // Keyboard navigation: Enter/Space to select
                    el.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            if (el.dataset.id !== this._activeDisk) {
                                activate(el.dataset.id);
                                this.startServerSync();
                                document.dispatchEvent(new CustomEvent('diskSelected'));
                            }
                        }
                    });
                });
            };

            // Activate function — updates both lists
            const activate = (id) => {
                // Main list
                list.querySelectorAll('.disk-list-item')
                    .forEach(el => el.classList.toggle('active', el.dataset.id === id));
                // Flyout list
                const flyoutList = document.getElementById('disk-list-flyout');
                if (flyoutList) {
                    flyoutList.querySelectorAll('.disk-list-item')
                        .forEach(el => el.classList.toggle('active', el.dataset.id === id));
                }
                this._activeDisk = id;
                const disk = disks.find(d => d.id === id);
                this._updateDiskPath(disk);
                saveFilters({ activeDisk: id });

                // Reset permission state on disk change
                this._permissionsLoaded = false;
                const permBody = document.getElementById('permissions-body');
                if (permBody) {
                    permBody.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-state-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                </svg>
                            </div>
                            <h3>Permission Analysis</h3>
                            <p>Click the <strong>Permission Issues</strong> tab to scan this disk for access problems.</p>
                        </div>`;
                }

                // Reset Detail User tab on disk change
                resetUserDetailTab();
            };

            // Populate main list
            buildItems(list, disks, activate);

            // Populate flyout list (same data)
            const flyoutList = document.getElementById('disk-list-flyout');
            if (flyoutList) buildItems(flyoutList, disks, activate);

            // Restore previously selected disk, fallback to first
            const savedDisk = loadFilters().activeDisk;
            const diskToActivate = savedDisk && disks.find(d => d.id === savedDisk)
                ? savedDisk
                : disks[0]?.id;
            if (diskToActivate) activate(diskToActivate);

            // Main list search
            const searchInput = document.getElementById('disk-search');
            if (searchInput) {
                searchInput.addEventListener('input', () => {
                    const q = searchInput.value.toLowerCase().trim();
                    list.querySelectorAll('.disk-list-item').forEach(el => {
                        el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
                    });
                });
            }

            // Flyout search
            const flyoutSearch = document.getElementById('disk-search-flyout');
            if (flyoutSearch && flyoutList) {
                flyoutSearch.addEventListener('input', () => {
                    const q = flyoutSearch.value.toLowerCase().trim();
                    flyoutList.querySelectorAll('.disk-list-item').forEach(el => {
                        el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
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
                this.setProcessingState(false);
                const isEmpty = jsonResponse.data && jsonResponse.data.length === 0;
                if (isEmpty) {
                    showToast('No reports found', 'This disk has no JSON reports yet.', 'warning');
                    UINodes.statusText.textContent = 'No data — disk is empty.';
                } else {
                    showToast('API returned an error', jsonResponse.message || 'Could not load disk data.', 'error');
                    UINodes.statusText.textContent = 'API error.';
                }
                // Reset all dashboard UI to empty state
                resetDashboardToEmpty(AppState.chartManagerInstance);
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
            // TASK-06: Toast on successful sync
            const snapshots = this.dataStore._rawData?.length ?? 0;
            showToast('Data synced successfully', `Loaded ${jsonResponse.total_files} snapshot${jsonResponse.total_files !== 1 ? 's' : ''}`, 'success');
            
        } catch (error) {
            console.error("Server API Sync Failed:", error);
            this.setProcessingState(false);
            UINodes.statusText.textContent = "Error: " + error.message;
            UINodes.statusDot.classList.remove('scanning');
            UINodes.statusDot.style.backgroundColor = 'var(--rose-500)';
            // TASK-06: Toast on sync error
            showToast('Sync failed', error.message || 'Check connection and try again', 'error');
        }
    }

    async _fetchPermissions() {
        const permBody = document.getElementById('permissions-body');
        // TASK-05: Loading state with styled empty-state
        if (permBody) {
            permBody.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                    </div>
                    <h3>Scanning permissions...</h3>
                    <p>Analyzing file system access for this disk.</p>
                </div>`;
        }
        try {
            const diskConf = this.disksConfig?.find(d => d.id === this._activeDisk);
            const diskPath = diskConf?.path || this._activeDisk;
            const res = await fetch(`api.php?dir=${encodeURIComponent(diskPath)}&x=1`);
            const json = await res.json();

            if (json?.status === 'success') {
                this._permissionsLoaded = true;
                this.dataStore.permissionIssues = json.data ?? null;
                document.dispatchEvent(new CustomEvent('permissionsLoaded', {
                    detail: json.data ? { diskDir: diskPath, ...json.data } : { diskDir: diskPath },
                }));
            } else {
                if (permBody) {
                    permBody.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-state-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                                </svg>
                            </div>
                            <h3>No Issues Found</h3>
                            <p>No permission problems detected for this disk.</p>
                        </div>`;
                }
            }
        } catch (e) {
            console.warn('Could not load permission issues:', e);
            if (permBody) {
                permBody.innerHTML = `
                    <div class="empty-state variant-rose">
                        <div class="empty-state-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                            </svg>
                        </div>
                        <h3>Failed to Load</h3>
                        <p>Could not fetch permission data. Check connection and try again.</p>
                    </div>`;
            }
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
        const getEl = id => document.getElementById(id);
        const ssbScan = getEl('ssb-scan-val');
        const ssbFill = getEl('ssb-gap-fill');
        const ssbPct  = getEl('ssb-gap-pct');
        const ssbGVal = getEl('ssb-gap-val');
        if (ssbScan) ssbScan.textContent = fmt(scannedBytes, 1);
        if (ssbFill) ssbFill.style.width = `${gapPct}%`;
        if (ssbPct)  ssbPct.textContent  = `${gapPct}%`;
        if (ssbGVal) ssbGVal.textContent  = fmt(gapBytes, 1);

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
            // TASK-10: Indeterminate progress animation while loading
            UINodes.progressBar.classList.add('loading-indeterminate');
        } else {
            UINodes.statusDot.classList.remove('scanning');
            UINodes.progressBar.classList.remove('loading-indeterminate');
            setTimeout(() => {
                UINodes.progressBar.style.width = '100%';
            }, 300);
        }
    }
}

// ── Mobile sidebar toggle ──────────────────────────────────────────────
function initMobileSidebar() {
    const sidebar   = document.querySelector('.sidebar');
    const backdrop  = document.getElementById('sidebar-backdrop');
    const hamburger = document.getElementById('btn-hamburger');
    const closeBtn  = document.getElementById('btn-sidebar-close');
    if (!sidebar || !backdrop || !hamburger) return;

    const open  = () => { sidebar.classList.add('open');    backdrop.classList.add('visible');    document.body.style.overflow = 'hidden'; };
    const close = () => { sidebar.classList.remove('open'); backdrop.classList.remove('visible'); document.body.style.overflow = ''; };
    const toggle = () => sidebar.classList.contains('open') ? close() : open();

    hamburger.addEventListener('click', toggle);
    backdrop.addEventListener('click', close);
    if (closeBtn) closeBtn.addEventListener('click', close);

    // Auto-close sidebar on nav-item click when mobile
    document.querySelectorAll('.nav-item').forEach(el =>
        el.addEventListener('click', () => { if (window.innerWidth <= 640) close(); })
    );
    // Auto-close sidebar when disk is selected on mobile (PF-03)
    document.addEventListener('diskSelected', () => { if (window.innerWidth <= 640) close(); });
}

// Bootstrap
document.addEventListener('DOMContentLoaded', () => {
    initRouter();
    initScaleToggle();
    initMobileSidebar();
    window.appFetcher = new DataFetcher();
});

