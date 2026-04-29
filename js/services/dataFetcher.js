import { UINodes, AppState, animateValue, bytesToTB, showToast } from '../core/main.js';
import { DataStore } from '../core/dataStore.js';
import { ChartManager } from '../renderers/chartManager.js';
import { initRouter, navigateTo } from '../core/router.js';
import { renderDetailTables, initScaleToggle, resetDashboardToEmpty } from '../renderers/detailRenderer.js';
import { initUserDetailTab, resetUserDetailTab } from '../renderers/userDetailRenderer.js';
import { fmt, smartFmtTick } from '../utils/formatters.js';
import { saveFilters, loadFilters } from '../utils/filterStorage.js';

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
        this._treeMapLoaded = false;
        this._inflightTreeMapByDisk = new Map(); // disk_id -> Promise
        this._aggregateCacheByDisk = new Map(); // disk_id -> { latestDate, payload }
        this._inflightSyncByDisk = new Map(); // disk_id -> Promise
        this._syncSequence = 0;
        this._activeSyncController = null;
        this._toastHistory = new Map(); // toastKey -> lastShownAtMs
        this._groupUserConfig = null;
        this._scanStatusTimer = null; // ID of the status polling timer

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

        // Lazy-load TreeMap on tab click
        const treeMapTab = document.querySelector('.detail-tab-btn[data-tab="treemap"]');
        if (treeMapTab) {
            treeMapTab.addEventListener('click', () => {
                if (!this._treeMapLoaded && this._activeDisk) {
                    this._fetchTreeMap();
                }
            });
        }

        // Lazy-load Detail User tab on click
        const userDetailTab = document.querySelector('.detail-tab-btn[data-tab="user-detail"]');
        if (userDetailTab) {
            userDetailTab.addEventListener('click', () => {
                if (this._activeDisk) {
                    const snapshot = this.dataStore?.latestSnapshot;
                    // Merge user_usage + other_usage so picker shows all known users
                    // even when detail report files haven't been generated yet
                    const snapshotUsers = [
                        ...(snapshot?.users || []),
                        ...(snapshot?.other || []),
                    ].map(o => ({ name: o.name, used: o.used }));
                    initUserDetailTab(this._activeDisk, snapshotUsers);
                }
            });
        }

        // Workspace header tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!this._activeDisk) return;
                if (btn.id === 'nav-detail') {
                    navigateTo('detail');
                } else {
                    navigateTo('overview');
                }
            });
        });

        // Team Overview Grid/List View Toggle
        const viewToggleBtns = document.querySelectorAll('#team-view-toggle .view-toggle-btn');
        if (viewToggleBtns.length > 0) {
            const savedView = localStorage.getItem('teamViewMode') || 'grid';

            // Initial state application
            const teamDiskGrid = document.getElementById('team-disk-grid');
            if (savedView === 'list' && teamDiskGrid) {
                teamDiskGrid.classList.add('list-view');
            }

            viewToggleBtns.forEach(btn => {
                if (btn.dataset.view === savedView) {
                    viewToggleBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                }

                btn.addEventListener('click', () => {
                    const viewType = btn.dataset.view;
                    viewToggleBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    if (teamDiskGrid) {
                        if (viewType === 'list') {
                            teamDiskGrid.classList.add('list-view');
                        } else {
                            teamDiskGrid.classList.remove('list-view');
                        }
                    }
                    localStorage.setItem('teamViewMode', viewType);
                });
            });
        }

        // Init sort UI
        this._initSortUI();
        this._initTeamComparisonUI();

        // Start live clock
        startClock();

        // Load disk list (auto-fetch is triggered inherently by disk click simulation inside)
        this._initDiskSelector();

        // Receive grouping config updates from Group User modal and refresh dashboard immediately.
        const onGroupConfigUpdated = (e) => {
            this._groupUserConfig = e?.detail?.config || null;
            this._applyGroupingAndRefresh();
        };
        document.addEventListener('groupUserConfigReady', onGroupConfigUpdated);
        document.addEventListener('groupUserConfigChanged', onGroupConfigUpdated);

        // Team comparison chart is a separate canvas flow; force a repaint on
        // theme switch so axis/label colors follow light/dark mode correctly.
        document.addEventListener('themeChanged', () => {
            if (!this._lastTeamData || this._lastTeamData.length === 0) return;
            const overviewEmpty = document.getElementById('overview-empty-state');
            if (!overviewEmpty || overviewEmpty.style.display === 'none') return;
            this._renderTeamComparisonChart(this._lastTeamData, this._getTeamChartApiMode());
        });
    }

    // Avoid spamming identical toast messages when users click rapidly.
    _toastOnce(key, title, message, variant = 'info', cooldownMs = 2500) {
        const now = Date.now();
        const last = this._toastHistory.get(key) || 0;
        if ((now - last) < cooldownMs) return;
        this._toastHistory.set(key, now);
        showToast(title, message, variant);
    }

    // Lightweight in-memory cache for idempotent GET JSON requests.
    // - cacheTimeMs > 0: serve cached payload while fresh.
    // - Also dedupes concurrent identical inflight requests.
    async _fetchJson(url, { signal, cacheTimeMs = 0 } = {}) {
        if (!this._fetchCache) this._fetchCache = new Map();
        if (!this._fetchInflight) this._fetchInflight = new Map();

        if (cacheTimeMs > 0) {
            const cached = this._fetchCache.get(url);
            if (cached && (Date.now() - cached.time) < cacheTimeMs) {
                return cached.data;
            }
            const pending = this._fetchInflight.get(url);
            if (pending) return pending;
        }

        const exec = (async () => {
            const res = await fetch(url, { signal });
            if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
            const data = await res.json();
            if (cacheTimeMs > 0) {
                this._fetchCache.set(url, { time: Date.now(), data });
            }
            return data;
        })();

        if (cacheTimeMs > 0) {
            this._fetchInflight.set(url, exec);
            exec.finally(() => this._fetchInflight.delete(url));
        }
        return exec;
    }

    async _fetchDiskMeta(diskId, signal) {
        try {
            const json = await this._fetchJson(`api.php?id=${encodeURIComponent(diskId)}&type=meta`, { signal, cacheTimeMs: 15000 });
            if (json?.status !== 'success' || !json?.data) return null;
            return json.data;
        } catch (_err) {
            return null;
        }
    }

    async _fetchScanStatus(diskId) {
        try {
            // cacheTimeMs: 2000 so rapid clicks don't spam, but updates reasonably fast
            const json = await this._fetchJson(`api.php?id=${encodeURIComponent(diskId)}&type=scan_status`, { cacheTimeMs: 2000 });
            if (json?.status === 'success' && json.data) {
                return json.data;
            }
        } catch (_e) {
            // Ignore errors on background poll
        }
        return null;
    }

    _startStatusPolling(diskId) {
        this._stopStatusPolling();
        // Poll every 3 seconds
        this._scanStatusTimer = setInterval(async () => {
            if (this._activeDisk !== diskId) {
                this._stopStatusPolling();
                return;
            }
            const status = await this._fetchScanStatus(diskId);
            // Insert banner into workspace actions area (near sync button)
            const anchor = document.querySelector('.workspace-actions');
            let banner = document.getElementById('scan-status-banner');
            if (!banner && anchor) {
                banner = document.createElement('div');
                banner.id = 'scan-status-banner';
                banner.className = 'scan-status-banner hidden';
                banner.innerHTML = '<span class="scan-status-banner-icon"></span><span class="scan-status-banner-text"></span>';
                // Insert as first child so it appears before the sync button
                anchor.insertBefore(banner, anchor.firstChild);
            }
            const bannerText = banner ? banner.querySelector('.scan-status-banner-text') : null;

            if (status && status.running) {
                const stage = status.stage ? `[${status.stage}] ` : '';
                const msg = status.message || 'Scanning filesystem';
                UINodes.statusText.textContent = `Disk scan in progress — ${msg}`;
                UINodes.statusDot.classList.add('scanning');
                UINodes.statusDot.style.backgroundColor = '';
                UINodes.statusDot.title = `Stage: ${status.stage}`;
                if (banner && bannerText) {
                    banner.classList.remove('hidden');
                    bannerText.textContent = `${stage}${msg}`;
                }
            } else if (status && !status.running && !AppState.isProcessing) {
                UINodes.statusText.textContent = "System Optimized";
                UINodes.statusDot.classList.remove('scanning');
                UINodes.statusDot.title = '';
                if (banner) banner.classList.add('hidden');
            }
        }, 3000);
    }

    _stopStatusPolling() {
        if (this._scanStatusTimer) {
            clearInterval(this._scanStatusTimer);
            this._scanStatusTimer = null;
        }
    }

    _applyAggregatePayload(jsonResponse, { fromCache = false, silentToast = false } = {}) {
        UINodes.statusText.textContent = fromCache ? "Using cached payload..." : "Loading payload...";
        AppState.filesTotal = jsonResponse.total_files;
        UINodes.filesProcessed.textContent = `0/${AppState.filesTotal} files`;

        this.dataStore = new DataStore();
        this.dataStore.setGroupingContext(this._groupUserConfig, this._activeDisk);
        UINodes.statusText.textContent = "Aggregating metrics...";

        this.dataStore.processChunk(jsonResponse.data);
        if (jsonResponse.inodes) {
            this.dataStore.setLatestInodes(jsonResponse.inodes);
        }

        AppState.filesProcessed = AppState.filesTotal;
        UINodes.progressBar.style.width = `100%`;
        UINodes.filesProcessed.textContent = `${AppState.filesTotal}/${AppState.filesTotal} files`;

        const now = new Date();
        const dStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const tStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const syncEl = document.getElementById('last-sync-time');
        if (syncEl) syncEl.textContent = `${dStr} ${tStr}`;

        this.handleComplete();

        if (!silentToast) {
            if (fromCache) {
                this._toastOnce('sync-cache-hit', 'Data is up to date', 'No changes detected. Reused cached aggregate payload.', 'success');
            } else {
                this._toastOnce('sync-success', 'Data synced successfully', `Loaded ${jsonResponse.total_files} snapshot${jsonResponse.total_files !== 1 ? 's' : ''}`, 'success');
            }
        }
    }

    _applyGroupingAndRefresh() {
        if (!this.dataStore) return;
        this.dataStore.setGroupingContext(this._groupUserConfig, this._activeDisk);
        if (!this.dataStore.latestSnapshot) return;

        AppState.chartManagerInstance.render(this.dataStore);
        renderDetailTables(this.dataStore);
        this.updateMetricCards();
    }

    _getTeamChartApiMode() {
        const storedMode = localStorage.getItem('teamChartViewMode') || 'absolute-linear';
        if (storedMode === 'absolute-log') return 'logarithmic';
        if (storedMode === 'percent') return 'percent';
        return 'linear';
    }

    _initSortUI() {
        const btnAlpha = document.getElementById('btn-sort-alpha');
        const btnMore = document.getElementById('btn-sort-disk-more');
        const sortDropdown = document.getElementById('disk-sort-dropdown');
        const dropdownItems = document.querySelectorAll('.sort-item');
        const iconSortAlpha = document.getElementById('icon-sort-alpha');

        let currentSort = localStorage.getItem('teamDiskSort') || 'alpha-asc';

        const PATH_AZ = '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M20 8h-5"/><path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10"/><path d="M15 14h5l-5 6h5"/>';
        const PATH_ZA = '<path d="m3 8 4-4 4 4"/><path d="M7 4v16"/><path d="M20 8h-5"/><path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10"/><path d="M15 14h5l-5 6h5"/>';

        const applySort = () => {
            const grid = document.getElementById('team-disk-grid');
            if (!grid) return;
            const cards = Array.from(grid.querySelectorAll('.team-disk-card'));
            if (cards.length === 0) return;

            cards.sort((a, b) => {
                const nameA = a.dataset.name || '';
                const nameB = b.dataset.name || '';
                const usedA = parseFloat(a.dataset.usedPct) || 0;
                const usedB = parseFloat(b.dataset.usedPct) || 0;
                const freeA = parseFloat(a.dataset.freeBytes) || 0;
                const freeB = parseFloat(b.dataset.freeBytes) || 0;

                if (currentSort === 'alpha-asc') return nameA.localeCompare(nameB);
                if (currentSort === 'alpha-desc') return nameB.localeCompare(nameA);
                if (currentSort === 'usage-desc') return usedB - usedA;
                if (currentSort === 'free-desc') return freeB - freeA;
                return 0;
            });

            cards.forEach(card => grid.appendChild(card));

            if (btnAlpha && btnMore && iconSortAlpha) {
                if (currentSort.startsWith('alpha')) {
                    btnAlpha.classList.add('active-sort-btn');
                    btnMore.classList.remove('active-sort-btn');
                    iconSortAlpha.innerHTML = currentSort === 'alpha-asc' ? PATH_AZ : PATH_ZA;
                } else {
                    btnAlpha.classList.remove('active-sort-btn');
                    btnMore.classList.add('active-sort-btn');
                }
            }

            if (this._lastTeamData) {
                // Add minor timeout to ensure DOM container is available over the race-condition sync flow
                setTimeout(() => {
                    this._renderTeamComparisonChart(this._lastTeamData, this._getTeamChartApiMode());
                }, 50);
            }
        };

        this.applySort = applySort;

        if (btnAlpha) {
            btnAlpha.addEventListener('click', () => {
                currentSort = currentSort === 'alpha-asc' ? 'alpha-desc' : 'alpha-asc';
                localStorage.setItem('teamDiskSort', currentSort);
                applySort();
            });
        }

        if (btnMore && sortDropdown) {
            btnMore.addEventListener('click', (e) => {
                e.stopPropagation();
                sortDropdown.style.display = sortDropdown.style.display === 'none' ? 'block' : 'none';
            });

            document.addEventListener('click', (e) => {
                if (!btnMore.contains(e.target) && !sortDropdown.contains(e.target)) {
                    sortDropdown.style.display = 'none';
                }
            });

            dropdownItems.forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    currentSort = item.dataset.sort;
                    localStorage.setItem('teamDiskSort', currentSort);
                    sortDropdown.style.display = 'none';
                    applySort();
                });
            });
        }
    }

    _initTeamComparisonUI() {
        const btnSettings = document.getElementById('btn-chart-settings');
        const settingsDropdown = document.getElementById('chart-settings-dropdown');
        const modeItems = document.querySelectorAll('.chart-mode-item');

        // Migrate old distinct settings to a unified setting if needed
        let currentMode = localStorage.getItem('teamChartViewMode');
        if (!currentMode) {
            const currentScale = localStorage.getItem('teamChartScale') || 'linear';
            const isPercent = localStorage.getItem('teamChartPercent') === 'true';
            currentMode = isPercent ? 'percent' : (currentScale === 'logarithmic' ? 'absolute-log' : 'absolute-linear');
            localStorage.setItem('teamChartViewMode', currentMode);
        }

        const updateUI = () => {
            modeItems.forEach(item => {
                if (item.dataset.mode === currentMode) {
                    item.style.color = 'var(--text-primary)';
                    item.style.background = 'var(--bg-surface-elevated)';
                } else {
                    item.style.color = 'var(--text-secondary)';
                    item.style.background = 'transparent';
                }
            });
            // Update the icon to reflect the currently active mode
            if (btnSettings) {
                const activeSvg = Array.from(modeItems).find(i => i.dataset.mode === currentMode)?.querySelector('svg')?.outerHTML;
                if (activeSvg) btnSettings.innerHTML = activeSvg;
            }
        };
        updateUI();

        if (btnSettings && settingsDropdown) {
            btnSettings.addEventListener('click', (e) => {
                e.stopPropagation();
                settingsDropdown.style.display = settingsDropdown.style.display === 'none' ? 'block' : 'none';
            });

            document.addEventListener('click', (e) => {
                if (!btnSettings.contains(e.target) && !settingsDropdown.contains(e.target)) {
                    settingsDropdown.style.display = 'none';
                }
            });

            modeItems.forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    currentMode = item.dataset.mode;
                    localStorage.setItem('teamChartViewMode', currentMode);
                    settingsDropdown.style.display = 'none';
                    updateUI();

                    if (this._lastTeamData && window._teamCompChart) {
                        this._renderTeamComparisonChart(this._lastTeamData, this._getTeamChartApiMode());
                    }
                });
            });
        }
    }

    _renderTeamComparisonChart(data, mode) {
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

        const sortedData = [...data].sort((a, b) => {
            const nameA = (a._disk_name || '').toLowerCase();
            const nameB = (b._disk_name || '').toLowerCase();
            const sysA = a.general_system || {};
            const sysB = b.general_system || {};
            const totalA = sysA.total || 0;
            const totalB = sysB.total || 0;
            const usedA = sysA.used || 0;
            const usedB = sysB.used || 0;
            const freeA = Math.max(0, totalA - usedA);
            const freeB = Math.max(0, totalB - usedB);

            const usedPctA = totalA > 0 ? (usedA / totalA) * 100 : 0;
            const usedPctB = totalB > 0 ? (usedB / totalB) * 100 : 0;

            if (currentSort === 'alpha-asc') return nameA.localeCompare(nameB);
            if (currentSort === 'alpha-desc') return nameB.localeCompare(nameA);
            if (currentSort === 'usage-desc') return usedPctB - usedPctA;
            if (currentSort === 'free-desc') return freeB - freeA;
            return 0;
        });

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

    async _initDiskSelector() {
        try {
            // TASK-04: Show skeleton while fetching disk list
            const list = document.getElementById('disk-list');
            if (list) {
                const skeletonHTML = Array(3).fill(0)
                    .map(() => '<div class="skeleton skeleton-disk-item"></div>').join('');
                list.innerHTML = skeletonHTML;
            }
            // Fetch configuration securely via api.php (path hidden)
            const rawDisks = await this._fetchJson('api.php?type=disks', { cacheTimeMs: 30000 });
            if (!Array.isArray(rawDisks)) throw new Error('Invalid disks payload');

            // Flatten the disks for internal application logic
            const flatDisks = [];
            rawDisks.forEach((team, tIdx) => {
                if (team.name && team.disks) {
                    team.disks.forEach(d => {
                        flatDisks.push({ ...d, team: team.name, tIdx });
                    });
                } else if (team.id) {
                    flatDisks.push(team);
                }
            });
            this.disksConfig = flatDisks;

            if (!document.getElementById('project-team-list')) return;

            // Define method to activate a disk
            this.activateDisk = (id) => {
                const list = document.getElementById('disk-list');
                if (list) {
                    list.querySelectorAll('.disk-list-item').forEach(el => el.classList.remove('active'));
                    const target = list.querySelector(`.disk-list-item[data-id="${id}"]`);
                    if (target) target.classList.add('active');
                }

                // Highlight the card in the middle column
                const grid = document.getElementById('team-disk-grid');
                if (grid) {
                    grid.querySelectorAll('.team-disk-card').forEach(card => card.classList.remove('selected'));
                    const card = grid.querySelector(`.team-disk-card[data-id="${id}"]`);
                    if (card) card.classList.add('selected');
                }

                this._activeDisk = id;
                saveFilters({ activeDisk: id });
                // Keep disk activation lightweight; user list loads on demand in detail tab.

                // Start polling scan status whenever the active disk changes
                this._startStatusPolling(id);

                // Hiding empty state constraints & show features
                const currentTab = loadFilters().activePage || 'overview';
                navigateTo(currentTab === 'detail' ? 'detail' : 'overview');
                const tabs = document.querySelector('.detail-tabs');
                if (tabs) tabs.style.display = ''; // Restore subtabs visibility

                const activeCfg = this.disksConfig?.find(d => d.id === id);
                const titleEl = document.getElementById('shared-page-title');
                if (titleEl && activeCfg) {
                    titleEl.textContent = activeCfg.name;
                }
                const pathEl = document.getElementById('header-disk-path');
                if (pathEl) {
                    pathEl.style.display = '';
                    pathEl.textContent = '...';
                }
                const headerSepEl = document.querySelector('.header-sep');
                if (headerSepEl) headerSepEl.style.display = '';

                const breadcrumbEl = document.getElementById('shared-page-breadcrumb');
                if (breadcrumbEl) {
                    breadcrumbEl.style.display = 'none';
                }

                this._permissionsLoaded = false;
                this._treeMapLoaded = false;
                const permBody = document.getElementById('permissions-body');
                if (permBody) {
                    permBody.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-state-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" stroke-width="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke-width="2"/></svg>
                            </div>
                            <h3>Permission Analysis</h3>
                            <p>Click the <strong>Permission Issues</strong> tab to scan this disk.</p>
                        </div>`;
                }

                const tmBody = document.getElementById('treemap-body');
                if (tmBody) {
                    tmBody.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-state-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="5"/><rect x="13" y="10" width="8" height="11"/><rect x="3" y="13" width="8" height="8"/>
                                </svg>
                            </div>
                            <h3>TreeMap Analysis</h3>
                            <p>Click the <strong>TreeMap</strong> tab to load folder visual map.</p>
                        </div>`;
                }

                if (typeof resetUserDetailTab === 'function') resetUserDetailTab();

                // Restore nav tabs and sync button if we came from team view
                const workspaceHeader = document.querySelector('.workspace-header');
                if (workspaceHeader) workspaceHeader.style.display = 'flex';
                const navTabs = document.querySelector('.workspace-nav-tabs');
                if (navTabs) navTabs.style.display = 'flex';
                const syncBtn = document.getElementById('btn-fetch');
                if (syncBtn) syncBtn.style.display = 'flex';
                const syncStatusPill = document.getElementById('sync-status-pill');
                if (syncStatusPill) syncStatusPill.style.display = 'flex';

                // Show shared-header and switch to correct page
                const sharedHeader = document.getElementById('shared-header');
                if (sharedHeader) sharedHeader.style.display = '';


                const activeTabBtn = document.querySelector('.tab-btn.active');
                if (activeTabBtn && activeTabBtn.id === 'nav-detail') {
                    navigateTo('detail');
                } else {
                    navigateTo('overview');
                }
            };

            // Setup render context function
            this.renderTeamContext = (teamNode, projectName) => {
                const list = document.getElementById('disk-list');
                if (!list) return;

                const disks = teamNode.disks || [];
                let html = '';
                disks.forEach(d => {
                    html += `<div class="disk-list-item" data-id="${d.id}" tabindex="0" data-search-terms="${d.name.toLowerCase()}">${d.name}</div>`;
                });
                if (disks.length === 0) {
                    html = '<div class="disk-list-item" style="opacity:0.5; cursor:default;">No disks directly in this team</div>';
                }
                list.innerHTML = html;

                list.querySelectorAll('.disk-list-item[data-id]').forEach(el => {
                    el.addEventListener('click', () => {
                        if (el.dataset.id === this._activeDisk) return;
                        this.activateDisk(el.dataset.id);
                        this.startServerSync();
                        document.dispatchEvent(new CustomEvent('diskSelected'));
                    });
                });

                const searchInput = document.getElementById('disk-search');
                if (searchInput) {
                    const newSearch = searchInput.cloneNode(true);
                    searchInput.parentNode.replaceChild(newSearch, searchInput);
                    newSearch.addEventListener('input', () => {
                        const q = newSearch.value.toLowerCase().trim();
                        list.querySelectorAll('.disk-list-item[data-id]').forEach(item => {
                            const match = item.dataset.searchTerms.includes(q);
                            item.style.display = match ? '' : 'none';
                        });
                    });
                }

                // Removed standalone specific dropdown chevron logic
            };

            const projectContainer = document.getElementById('project-team-list');

            const chevronSVG = `<svg class="toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="vertical-align: middle; margin-right: 6px; transition: transform 0.2s;"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
            const projectSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="margin-right: 6px; opacity: 0.6;"><rect width="16" height="16" x="4" y="4" rx="2"></rect><rect width="6" height="6" x="9" y="9" rx="1"></rect><path d="M15 2v2"></path><path d="M15 20v2"></path><path d="M2 15h2"></path><path d="M2 9h2"></path><path d="M20 15h2"></path><path d="M20 9h2"></path><path d="M9 2v2"></path><path d="M9 20v2"></path></svg>`;
            const teamSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="margin-right: 6px; opacity: 0.6;"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`;
            let phtml = '';

            const rawD = rawDisks;

            rawD.forEach((team, tIdx) => {
                if (team.name && team.disks) {
                    phtml += `<div class="disk-project-group" style="margin-bottom: 8px;">
                                <div class="disk-team-group" data-tidx="${tIdx}" data-tooltip="${team.name}" data-tooltip-pos="right" style="margin-bottom: 2px;">
                                    <div class="disk-team-header" style="padding: 12px 14px; font-size: 0.85rem;">${teamSVG}<span style="font-weight: 600;">${team.name}</span></div>
                                </div>
                              </div>`;
                }
            });
            projectContainer.innerHTML = phtml;

            // Sidebar Search Handler
            const sidebarSearch = document.getElementById('sidebar-team-search');
            if (sidebarSearch && !sidebarSearch.hasAttribute('data-bound')) {
                sidebarSearch.setAttribute('data-bound', 'true');
                sidebarSearch.addEventListener('input', (e) => {
                    const term = e.target.value.toLowerCase().trim();
                    const groupNodes = projectContainer.querySelectorAll('.disk-project-group');

                    groupNodes.forEach(group => {
                        const team = group.querySelector('.disk-team-group');
                        if (team) {
                            const teamName = team.textContent.toLowerCase();
                            if (teamName.includes(term)) {
                                group.style.display = '';
                            } else {
                                group.style.display = 'none';
                            }
                        }
                    });
                });
            }

            projectContainer.querySelectorAll('.disk-team-group').forEach(teamGroup => {
                teamGroup.addEventListener('click', (e) => {
                    e.stopPropagation();
                    projectContainer.querySelectorAll('.disk-team-group').forEach(g => {
                        g.classList.remove('active-team');
                    });
                    teamGroup.classList.add('active-team');

                    const tIdx = parseInt(teamGroup.dataset.tidx);
                    const teamNode = rawD[tIdx];

                    this._activeDisk = null;
                    saveFilters({ activeDisk: null, activeTeamTIdx: tIdx });
                    const list = document.getElementById('disk-list');
                    if (list) list.querySelectorAll('.disk-list-item').forEach(el => el.classList.remove('active'));

                    // Always render the context (which populates the dropdown menu disk-list)
                    this.renderTeamContext(teamNode, teamNode.name);

                    if (!window._isRestoringDisk) {
                        this.loadTeamOverview(teamNode.name);
                    }
                });
            });

            const savedFilters = loadFilters();
            const savedDisk = savedFilters.activeDisk;
            const savedTIdx = savedFilters.activeTeamTIdx;

            if (savedDisk) {
                let foundTeamEl = null;
                let foundTIdx = null;
                rawD.forEach((team, tIdx) => {
                    if (team.name && team.disks?.find(d => d.id === savedDisk)) {
                        foundTeamEl = projectContainer.querySelector(`.disk-team-group[data-tidx="${tIdx}"]`);
                        foundTIdx = tIdx;
                    }
                });
                if (foundTeamEl) {
                    projectContainer.querySelectorAll('.disk-team-group').forEach(g => {
                        g.classList.remove('active-team');
                    });
                    foundTeamEl.classList.add('active-team');

                    const teamNode = rawD[foundTIdx];
                    this.renderTeamContext(teamNode, teamNode.name);
                    this.loadTeamOverview(teamNode.name, savedDisk);
                } else {
                    const firstTeam = projectContainer.querySelector('.disk-team-group');
                    if (firstTeam) firstTeam.click();
                }
            } else if (savedTIdx !== undefined && savedTIdx !== null) {
                const teamEl = projectContainer.querySelector(`.disk-team-group[data-tidx="${savedTIdx}"]`);
                if (teamEl) {
                    teamEl.click();
                } else {
                    const firstTeam = projectContainer.querySelector('.disk-team-group');
                    if (firstTeam) firstTeam.click();
                }
            } else {
                const firstTeam = projectContainer.querySelector('.disk-team-group');
                if (firstTeam) firstTeam.click();
            }
        } catch (e) {
            console.error('Error in fetchDisksList:', e);
            this._toastOnce('load-disks-failed', 'Failed to load disks', e.message || 'Please check API connectivity.', 'error');
        }
    }

    async loadTeamOverview(teamName, restoreDiskId = null) {
        if (!restoreDiskId) {
            this._activeDisk = null;
        }

        // Reset Header
        const titleEl = document.getElementById('shared-page-title');
        if (titleEl) titleEl.textContent = teamName + ' Overview';
        const pathEl = document.getElementById('header-disk-path');
        if (pathEl) pathEl.textContent = 'Aggregated usage';

        const teamTitleEl = document.getElementById('team-overview-title-text');
        if (teamTitleEl) teamTitleEl.textContent = teamName ? teamName : 'All Teams';

        // Reset dropdown label
        const titleText = document.getElementById('disk-title-text');
        if (titleText) titleText.textContent = "Select a disk...";

        // Switch to Team Overview Page
        // Switch to Team Overview Page via Router
        // navigateTo('team'); // Removed because we now have a 3-column layout where team disks are in the sidebar

        const grid = document.getElementById('team-disk-grid');
        if (!grid) return;

        grid.innerHTML = '<div class="glass-panel" style="padding:20px;"><div class="spinner"></div> Loading team data...</div>';

        try {
            const result = await this._fetchJson(`api.php?type=team&name=${encodeURIComponent(teamName)}`, { cacheTimeMs: 20000 });

            if (result.status !== 'success' || !result.data || result.data.length === 0) {
                grid.innerHTML = '<div class="glass-panel" style="padding:20px; color:var(--text-secondary);">No disk usage reports available for this team.</div>';
                return;
            }

            this._lastTeamData = result.data;

            let totalBytes = 0;
            let usedBytes = 0;
            let cardsHTML = '';

            const diskIcon = `<svg viewBox="0 0 24 24" fill="none" class="icon-disk-card" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="flex-shrink:0; color:var(--text-secondary); opacity:0.8;"><path d="M22 12H2"></path><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path><line x1="6" y1="16" x2="6.01" y2="16"></line><line x1="10" y1="16" x2="10.01" y2="16"></line></svg>`;

            result.data.forEach(d => {
                const sys = d.general_system || {};
                const total = sys.total || 0;
                const used = sys.used || 0;
                const scanned = (d.team_usage || []).reduce((sum, t) => sum + (t.used || 0), 0);
                const unknown = Math.max(0, used - scanned);

                totalBytes += total;
                usedBytes += used;

                const scannedPct = total > 0 ? ((scanned / total) * 100).toFixed(1) : 0;
                const unknownPct = total > 0 ? ((unknown / total) * 100).toFixed(1) : 0;
                const usedPct = total > 0 ? ((used / total) * 100).toFixed(1) : 0;

                const diskName = d._disk_name || 'Disk';
                const diskId = d._disk_id || '';
                const dirPath = d.directory || sys.directory || d._disk_path || 'Unknown path';

                let usedClass = 'usage-pill-success';
                if (usedPct >= 85) usedClass = 'usage-pill-danger';
                else if (usedPct >= 70) usedClass = 'usage-pill-warning';

                const free = Math.max(0, total - used);
                const tooltipText = `<div style='display:grid; grid-template-columns: auto 1fr; gap: 4px 16px; text-align: left;'>
                    <div style='color:var(--text-secondary)'>Total:</div><div style='text-align:right; font-weight:600; font-variant-numeric: tabular-nums;'>${fmt(total)}</div>
                    <div style='color:var(--text-secondary)'>Used:</div><div style='text-align:right; font-weight:600; font-variant-numeric: tabular-nums;'>${fmt(used)}</div>
                    <div style='color:var(--text-secondary)'>Scanned:</div><div style='text-align:right; font-weight:600; font-variant-numeric: tabular-nums;'>${fmt(scanned)}</div>
                    <div style='color:var(--text-secondary)'>Free:</div><div style='text-align:right; font-weight:600; font-variant-numeric: tabular-nums;'>${fmt(free)}</div>
                </div>`;

                const freePct = Math.max(0, 100 - usedPct).toFixed(1);

                cardsHTML += `<div class="team-disk-card" data-id="${diskId}" data-name="${diskName.toLowerCase().replace(/"/g, '&quot;')}" data-used-pct="${usedPct}" data-free-bytes="${free}" onclick="document.querySelector('.disk-list-item[data-id=\\'${diskId}\\']')?.click()" data-tooltip="${tooltipText}" data-tooltip-pos="top">
                    <div class="card-content-wrapper">
                        <div class="card-left">
                            <div class="card-header" style="display: flex; flex-direction: column; gap: 6px; width: 100%; align-items: flex-start; margin-bottom: 0;">
                                <div class="disk-name" style="display: flex; align-items: flex-start; gap: 8px; width: 100%;" title="${diskName}">
                                    <div style="margin-top:2px; flex-shrink:0; display:flex;">${diskIcon}</div>
                                    <span style="white-space: normal; overflow-wrap: anywhere; line-height: 1.3; font-weight: 600;">${diskName}</span>
                                </div>
                                <div class="disk-path ${usedClass}" style="white-space: nowrap; margin-left: 24px; align-self: flex-start;">${usedPct}% Used</div>
                            </div>
                            <div class="team-disk-mini-bar">
                                <div class="segment used-scanned" style="width: ${scannedPct}%"></div>
                                <div class="segment used-unknown" style="width: ${unknownPct}%"></div>
                                <div class="segment free" style="width: ${freePct}%"></div>
                            </div>
                        </div>
                        <div class="extended-disk-stats">
                            <div class="extended-stat stat-total"><span class="label">Total</span><span class="value">${fmt(total)}</span></div>
                            <div class="extended-stat stat-used"><span class="label">Used</span><span class="value">${fmt(used)}</span></div>
                            <div class="extended-stat stat-scanned"><span class="label">Scanned</span><span class="value">${fmt(scanned)}</span></div>
                            <div class="extended-stat stat-free"><span class="label">Free</span><span class="value">${fmt(free)}</span></div>
                        </div>
                    </div>
                </div>`;
            });

            grid.innerHTML = cardsHTML;

            // Apply sorting initially once cards are loaded
            if (typeof this.applySort === 'function') {
                this.applySort();
            }

            // Team Disk Search Handler
            const teamSearch = document.getElementById('team-disk-search');
            if (teamSearch) {
                teamSearch.value = ''; // Reset when switching teams
                if (!teamSearch.hasAttribute('data-bound')) {
                    teamSearch.setAttribute('data-bound', 'true');
                    teamSearch.addEventListener('input', (e) => {
                        const term = e.target.value.toLowerCase().trim();
                        const cards = grid.querySelectorAll('.team-disk-card');
                        cards.forEach(card => {
                            const name = card.querySelector('.disk-name')?.textContent.toLowerCase() || '';
                            const path = card.getAttribute('data-tooltip')?.toLowerCase() || '';
                            card.style.display = (name.includes(term) || path.includes(term)) ? '' : 'none';
                        });
                    });
                }
                // Trigger a re-filter just in case
                teamSearch.dispatchEvent(new Event('input'));
            }

            const txtTotal = document.getElementById('team-stat-total');
            const txtUsed = document.getElementById('team-stat-used');

            if (txtTotal) txtTotal.textContent = bytesToTB(totalBytes);
            if (txtUsed) txtUsed.textContent = bytesToTB(usedBytes);

            // Re-render team doughnut chart
            if (window._teamChart) window._teamChart.destroy();
            const ctx = document.getElementById('teamUsageChart');
            if (ctx) {
                const rmd = totalBytes - usedBytes;
                window._teamChart = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: ['Used', 'Free'],
                        datasets: [{
                            data: [usedBytes, rmd > 0 ? rmd : 0],
                            backgroundColor: ['#f43f5e', '#10b981'],
                            borderWidth: 0,
                            hoverOffset: 4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false }, tooltip: {
                                callbacks: { label: (ctx) => ' ' + fmt(ctx.raw) }
                            }
                        },
                        cutout: '75%'
                    }
                });
            }
        } catch (e) {
            console.error("Team load error:", e);
            grid.innerHTML = '<div class="glass-panel" style="padding:20px; color:#f43f5e;">Failed to load team aggregated data. Please check connection.</div>';
            this._toastOnce(`team-overview-failed:${teamName}`, 'Team overview failed', e.message || 'Could not fetch team aggregate data.', 'error');
        }

        // Do not auto-select the disk unless restoring previous session
        if (!restoreDiskId) {
            navigateTo('overview'); // Force overview because no specific disk is selected

            const sharedHeader = document.getElementById('shared-header');
            if (sharedHeader) sharedHeader.style.display = 'none';

            // Clean global charts since no specific disk is active
            resetDashboardToEmpty(AppState.chartManagerInstance);

            // Toggle overview states
            const overviewGrid = document.getElementById('overview-charts-grid');
            const overviewEmpty = document.getElementById('overview-empty-state');
            if (overviewGrid) overviewGrid.style.display = 'none';
            if (overviewEmpty) {
                overviewEmpty.style.display = 'flex';
                // Render the comparison chart
                if (this._lastTeamData && this._lastTeamData.length > 0) {
                    // Need a small timeout to allow display:flex to compute layout before Chart.js takes over
                    setTimeout(() => {
                        this._renderTeamComparisonChart(this._lastTeamData, this._getTeamChartApiMode());
                    }, 50);
                }
            }

            const tabs = document.querySelector('.detail-tabs');
            if (tabs) tabs.style.display = 'none'; // hide tabs when no disk selected

            const detailViewArea = document.getElementById('detail-view-area');
            if (detailViewArea) detailViewArea.innerHTML = '';

            // Switch tabs to snapshot natively
            document.querySelectorAll('.detail-tab-pane').forEach(p => p.classList.remove('active'));
            const snapPane = document.getElementById('tab-pane-snapshot');
            if (snapPane) snapPane.classList.add('active');

            const snapBody = document.getElementById('tab-snapshot-body');
            if (snapBody) {
                snapBody.innerHTML = `
                    <div class="empty-state" style="margin-top: 15vh;">
                        <div class="empty-state-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
                            </svg>
                        </div>
                        <h3>No Disk Selected</h3>
                        <p>Please select a disk from the list to view its details.</p>
                    </div>`;
            }
        } else {
            setTimeout(() => {
                const diskEl = document.querySelector(`.disk-list-item[data-id='${restoreDiskId}']`);
                if (diskEl) diskEl.click();
            }, 100);
        }
    }

    async startServerSync() {
        const diskId = this._activeDisk;
        if (!diskId) {
            UINodes.statusText.textContent = "No valid disk to scan.";
            return;
        }

        const inflight = this._inflightSyncByDisk.get(diskId);
        if (inflight) {
            UINodes.statusText.textContent = "Sync already running...";
            return inflight;
        }

        const syncId = ++this._syncSequence;
        if (this._activeSyncController) this._activeSyncController.abort();
        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const signal = controller ? controller.signal : undefined;
        this._activeSyncController = controller;
        const isStale = () => syncId !== this._syncSequence || diskId !== this._activeDisk;

        const runSync = (async () => {
            try {
                this.setProcessingState(true);

                UINodes.statusText.textContent = "Syncing summary...";
                const meta = await this._fetchDiskMeta(diskId, signal);
                if (isStale()) return;

                const cached = this._aggregateCacheByDisk.get(diskId);
                if (meta && cached && Number(cached.latestDate) === Number(meta.latest_date)) {
                    this._applyAggregatePayload(cached.payload, { fromCache: true });
                    return;
                }

                UINodes.statusText.textContent = "Connecting to API...";
                const jsonResponse = await this._fetchJson(`api.php?id=${encodeURIComponent(diskId)}`, { signal });
                if (isStale()) return;

                if ((jsonResponse.status && jsonResponse.status !== 'success') || !jsonResponse.data || jsonResponse.data.length === 0) {
                    this.setProcessingState(false);
                    const isEmpty = jsonResponse.data && jsonResponse.data.length === 0;
                    if (isEmpty) {
                        this._toastOnce('sync-empty-data', 'No reports found', 'This disk has no JSON reports yet.', 'warning');
                        UINodes.statusText.textContent = 'No data — disk is empty.';
                    } else {
                        this._toastOnce('sync-api-error', 'API returned an error', jsonResponse.message || 'Could not load disk data.', 'error');
                        UINodes.statusText.textContent = 'API error.';
                    }
                    // Reset all dashboard UI to empty state
                    resetDashboardToEmpty(AppState.chartManagerInstance);
                    return;
                }

                const payloadLatestDate = Number(
                    meta?.latest_date ??
                    jsonResponse?.data?.[jsonResponse.data.length - 1]?.date ??
                    0
                ) || 0;
                this._aggregateCacheByDisk.set(diskId, {
                    latestDate: payloadLatestDate,
                    payload: jsonResponse,
                });

                this._applyAggregatePayload(jsonResponse, { fromCache: false });
            } catch (error) {
                if (error?.name === 'AbortError') return;
                if (isStale()) return;
                console.error("Server API Sync Failed:", error);
                this.setProcessingState(false);
                UINodes.statusText.textContent = "Error: " + error.message;
                UINodes.statusDot.classList.remove('scanning');
                UINodes.statusDot.style.backgroundColor = 'var(--rose-500)';
                // TASK-06: Toast on sync error
                this._toastOnce('sync-failed', 'Sync failed', error.message || 'Check connection and try again', 'error');
            } finally {
                this._inflightSyncByDisk.delete(diskId);
                if (this._activeSyncController === controller) {
                    this._activeSyncController = null;
                }
            }
        })();

        this._inflightSyncByDisk.set(diskId, runSync);
        return runSync;
    }

    async _fetchPermissions() {
        const diskId = this._activeDisk;
        if (!diskId) return;
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
            const json = await this._fetchJson(`api.php?id=${encodeURIComponent(diskId)}&type=permissions`, { cacheTimeMs: 60000 });

            if (json?.status === 'success') {
                if (this._activeDisk !== diskId) return;
                this._permissionsLoaded = true;
                document.dispatchEvent(new CustomEvent('permissionsLoaded', {
                    detail: json.data ? { diskId, ...json.data } : { diskId },
                }));
            } else {
                if (this._activeDisk !== diskId) return;
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
            this._toastOnce('permissions-fetch-failed', 'Permission scan failed', e.message || 'Could not fetch permission data.', 'warning');
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

    async _fetchTreeMap() {
        const diskId = this._activeDisk;
        if (!diskId) return;

        const inflight = this._inflightTreeMapByDisk.get(diskId);
        if (inflight) return inflight;

        const body = document.getElementById('treemap-body');
        if (body) {
            body.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                    </div>
                    <h3>Loading TreeMap...</h3>
                    <p>Reading index and shard metadata for this disk.</p>
                </div>`;
        }

        const run = (async () => {
        try {
            const json = await this._fetchJson(`api.php?id=${encodeURIComponent(diskId)}&type=treemap`, { cacheTimeMs: 60000 });

            if (json?.status === 'success') {
                if (this._activeDisk !== diskId) return;
                this._treeMapLoaded = true;
                document.dispatchEvent(new CustomEvent('treemapLoaded', {
                    detail: json.data ? { diskId, ...json.data } : { diskId },
                }));
                return;
            }

            throw new Error(json?.message || 'TreeMap API error');
        } catch (e) {
            if (this._activeDisk !== diskId) return;
            this._toastOnce('treemap-fetch-failed', 'TreeMap load failed', e.message || 'Could not load treemap data.', 'warning');
            if (body) {
                body.innerHTML = `
                    <div class="empty-state variant-rose">
                        <div class="empty-state-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>
                            </svg>
                        </div>
                        <h3>Failed to Load TreeMap</h3>
                        <p>Could not load tree map data. Please check report files and try again.</p>
                    </div>`;
            }
        } finally {
            this._inflightTreeMapByDisk.delete(diskId);
        }
        })();

        this._inflightTreeMapByDisk.set(diskId, run);
        return run;
    }


    handleComplete() {
        this.setProcessingState(false);
        UINodes.statusText.textContent = "System Optimized";

        // Restore overview charts grid
        const overviewGrid = document.getElementById('overview-charts-grid');
        const overviewEmpty = document.getElementById('overview-empty-state');
        if (overviewGrid) overviewGrid.style.display = '';
        if (overviewEmpty) overviewEmpty.style.display = 'none';

        this.dataStore.finalizeProcessing();
        this.updateMetricCards();
        AppState.chartManagerInstance.render(this.dataStore);
        renderDetailTables(this.dataStore);
    }

    updateMetricCards() {
        const stats = this.dataStore.latestStats;

        const totalTB = bytesToTB(stats.total);
        const usedTB = bytesToTB(stats.used);
        const availableTB = bytesToTB(stats.available);
        const scannedBytes = (this.dataStore.latestSnapshot?.teams || []).reduce((s, t) => s + (t.used || 0), 0);
        const scannedTB = bytesToTB(scannedBytes);
        const usagePct = stats.total ? ((stats.used / stats.total) * 100) : 0;

        const animateEl = (el, prev, next) => { if (el) animateValue(el, prev, next, 1200); };

        animateEl(UINodes.valTotal, parseFloat(UINodes.valTotal?.textContent) || 0, totalTB);
        animateEl(UINodes.valUsed, parseFloat(UINodes.valUsed?.textContent) || 0, usedTB);
        animateEl(UINodes.valFree, parseFloat(UINodes.valFree?.textContent) || 0, availableTB);
        animateEl(UINodes.valScanned, parseFloat(UINodes.valScanned?.textContent) || 0, scannedTB);

        // Usage % (formatted separately — not TB)
        if (UINodes.valPct) {
            UINodes.valPct.textContent = usagePct.toFixed(1);
            UINodes.valPct.style.color = usagePct > 80 ? '#f43f5e' : '';
        }

        // Show disk path
        const dirPath = this.dataStore.latestSnapshot?.directory;
        const activeDisk = this.disksConfig?.find(d => d.id === this._activeDisk);
        const diskPathEl = document.getElementById('header-disk-path');
        if (diskPathEl) {
            diskPathEl.style.display = '';
            diskPathEl.textContent = dirPath || activeDisk?.name || '';
        }
        const headerSepEl = document.querySelector('.header-sep');
        if (headerSepEl) {
            headerSepEl.style.display = '';
        }

        // Update page title based on active page
        const titleEl = document.getElementById('shared-page-title');
        if (titleEl && activeDisk) {
            titleEl.textContent = activeDisk.name;
        }

        // ── Scan Summary Bar ──────────────────────────────────────────
        const gapBytes = Math.max(0, stats.used - scannedBytes);
        const gapPct = stats.used ? ((gapBytes / stats.used) * 100).toFixed(1) : '0.0';
        const getEl = id => document.getElementById(id);
        const ssbScan = getEl('ssb-scan-val');
        const ssbFill = getEl('ssb-gap-fill');
        const ssbPct = getEl('ssb-gap-pct');
        const ssbGVal = getEl('ssb-gap-val');
        if (ssbScan) ssbScan.textContent = fmt(scannedBytes, 1);
        if (ssbFill) ssbFill.style.width = `${gapPct}%`;
        if (ssbPct) ssbPct.textContent = `${gapPct}%`;
        if (ssbGVal) ssbGVal.textContent = fmt(gapBytes, 1);

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
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    const hamburgers = document.querySelectorAll('.hamburger-btn');
    const closeBtn = document.getElementById('btn-sidebar-close');
    if (!sidebar || !backdrop || hamburgers.length === 0) return;

    const open = () => { sidebar.classList.add('open'); backdrop.classList.add('visible'); document.body.style.overflow = 'hidden'; };
    const close = () => { sidebar.classList.remove('open'); backdrop.classList.remove('visible'); document.body.style.overflow = ''; };
    const toggle = () => sidebar.classList.contains('open') ? close() : open();

    hamburgers.forEach(btn => btn.addEventListener('click', toggle));
    backdrop.addEventListener('click', close);
    if (closeBtn) closeBtn.addEventListener('click', close);

    // Auto-close sidebar on nav-item click when mobile
    document.querySelectorAll('.nav-item').forEach(el =>
        el.addEventListener('click', () => { if (window.innerWidth <= 640) close(); })
    );
    // Auto-close sidebar when disk is selected on mobile (PF-03)
    document.addEventListener('diskSelected', () => {
        if (window.innerWidth <= 640) close();
        const teamSidebar = document.getElementById('team-disk-sidebar');
        if (teamSidebar) teamSidebar.classList.remove('expanded');
    });
}
// Bootstrap
document.addEventListener('DOMContentLoaded', () => {
    initRouter();
    initScaleToggle();
    initMobileSidebar();
    window.appFetcher = new DataFetcher();
});
