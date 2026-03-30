import { UINodes, AppState, animateValue, bytesToTB, showToast } from './main.js';
import { DataStore } from './dataStore.js';
import { ChartManager } from './chartManager.js';
import { initRouter, navigateTo } from './router.js';
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

        // Dropped disk-dropdown logic completely per user request.

        // Start live clock
        startClock();

        // Load disk list (auto-fetch is triggered inherently by disk click simulation inside)
        this._initDiskSelector();
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
            const res = await fetch('api.php?type=disks');
            const rawDisks = await res.json();
            
            // Flatten the disks for internal application logic
            const flatDisks = [];
            rawDisks.forEach(p_or_d => {
                if (p_or_d.project && p_or_d.teams) {
                    p_or_d.teams.forEach(t => {
                        t.disks?.forEach(d => {
                            flatDisks.push({ ...d, project: p_or_d.project, team: t.name });
                        });
                    });
                } else if (p_or_d.name && p_or_d.disks) {
                    p_or_d.disks.forEach(d => {
                        flatDisks.push({ ...d, project: "Workspace", team: p_or_d.name });
                    });
                } else if (p_or_d.id) {
                    flatDisks.push(p_or_d);
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
                this._activeDisk = id;
                saveFilters({ activeDisk: id });

                const activeCfg = this.disksConfig?.find(d => d.id === id);
                const titleEl = document.getElementById('shared-page-title');
                if (titleEl && activeCfg) {
                    titleEl.textContent = activeCfg.name;
                }
                const pathEl = document.getElementById('header-disk-path');
                if (pathEl && activeCfg) {
                    pathEl.textContent = '...'; // Will be replaced by actual directory path after sync
                }

                this._permissionsLoaded = false;
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
            let phtml = '';
            
            const rawD = rawDisks;
            
            rawD.forEach((p_or_d, pIdx) => {
                if (p_or_d.project) {
                    phtml += `<div class="disk-project-group">
                                <div class="disk-project-header">${chevronSVG} <span>${p_or_d.project}</span></div>`;
                    p_or_d.teams?.forEach((t, tIdx) => {
                        phtml += `<div class="disk-team-group" data-pidx="${pIdx}" data-tidx="${tIdx}">
                                    <div class="disk-team-header">${t.name}</div>
                                  </div>`;
                    });
                    phtml += `</div>`;
                } else if (p_or_d.name && p_or_d.disks) {
                    phtml += `<div class="disk-project-group">
                                <div class="disk-team-group standalone" data-pidx="${pIdx}" data-tidx="-1">
                                    <div class="disk-team-header">${p_or_d.name}</div>
                                </div>
                              </div>`;
                }
            });
            projectContainer.innerHTML = phtml;

            projectContainer.querySelectorAll('.disk-project-header').forEach(header => {
                header.style.cursor = 'pointer';
                header.addEventListener('click', (e) => {
                    e.stopPropagation();
                    header.parentElement.classList.toggle('collapsed');
                });
            });

            projectContainer.querySelectorAll('.disk-team-group').forEach(teamGroup => {
                teamGroup.addEventListener('click', (e) => {
                    e.stopPropagation();
                    projectContainer.querySelectorAll('.disk-team-group').forEach(g => {
                        g.classList.remove('active-team');
                    });
                    teamGroup.classList.add('active-team');
                    
                    const pIdx = parseInt(teamGroup.dataset.pidx);
                    const tIdx = parseInt(teamGroup.dataset.tidx);
                    const node = rawD[pIdx];
                    let teamNode = null, pName = "Workspace";
                    
                    if (tIdx === -1) { teamNode = node; } 
                    else { teamNode = node.teams[tIdx]; pName = node.project; }
                    
                    this._activeDisk = null;
                    saveFilters({ activeDisk: null, activeTeamPIdx: pIdx, activeTeamTIdx: tIdx });
                    const list = document.getElementById('disk-list');
                    if (list) list.querySelectorAll('.disk-list-item').forEach(el => el.classList.remove('active'));

                    // Always render the context (which populates the dropdown menu disk-list)
                    this.renderTeamContext(teamNode, pName);

                    if (!window._isRestoringDisk) {
                        // Logic defined by user: 
                        // Logic defined by user: 
                        // - Standalone Team (tIdx === -1) -> Jump directly to its first disk
                        // - Project Team (tIdx >= 0) -> ALWAYS show Team Overview grid
                        if (tIdx === -1 && teamNode.disks && teamNode.disks.length > 0) {
                            setTimeout(() => {
                                const diskEl = document.querySelector(`.disk-list-item[data-id="${teamNode.disks[0].id}"]`);
                                if (diskEl) diskEl.click();
                            }, 50);
                        } else {
                            this.loadTeamOverview(teamNode.name || pName);
                        }
                    }
                });
            });

            const savedFilters = loadFilters();
            const savedDisk = savedFilters.activeDisk;
            const savedPIdx = savedFilters.activeTeamPIdx;
            const savedTIdx = savedFilters.activeTeamTIdx;
            
            if (savedDisk) {
                let foundTeamEl = null;
                rawD.forEach((p, pIdx) => {
                    if (p.project) {
                        p.teams?.forEach((t, tIdx) => {
                            if (t.disks?.find(d => d.id === savedDisk)) {
                                foundTeamEl = projectContainer.querySelector(`.disk-team-group[data-pidx="${pIdx}"][data-tidx="${tIdx}"]`);
                            }
                        });
                    } else if (p.name && p.disks?.find(d => d.id === savedDisk)) {
                         foundTeamEl = projectContainer.querySelector(`.disk-team-group[data-pidx="${pIdx}"][data-tidx="-1"]`);
                    }
                });
                if (foundTeamEl) {
                    window._isRestoringDisk = true;
                    foundTeamEl.click();
                    setTimeout(() => {
                        const dl = document.querySelector(`.disk-list-item[data-id="${savedDisk}"]`);
                        if (dl) dl.click();
                        window._isRestoringDisk = false;
                    }, 100);
                } else {
                   const firstTeam = projectContainer.querySelector('.disk-team-group');
                   if (firstTeam) firstTeam.click();
                }
            } else if (savedPIdx !== undefined && savedTIdx !== undefined) {
                const teamEl = projectContainer.querySelector(`.disk-team-group[data-pidx="${savedPIdx}"][data-tidx="${savedTIdx}"]`);
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
        }
    }

    async loadTeamOverview(teamName) {
        this._activeDisk = null;

        // Reset Header
        const titleEl = document.getElementById('shared-page-title');
        if (titleEl) titleEl.textContent = teamName + ' Overview';
        const pathEl = document.getElementById('header-disk-path');
        if (pathEl) pathEl.textContent = 'Aggregated usage';
        
        const teamTitleEl = document.getElementById('team-overview-title-text');
        if (teamTitleEl) teamTitleEl.textContent = teamName ? teamName + ' Drives' : 'All Team Drives';
        
        // Reset dropdown label
        const titleText = document.getElementById('disk-title-text');
        if (titleText) titleText.textContent = "Select a disk...";
        
        // Switch to Team Overview Page
        // Hide irrelevant tabs/buttons for the team aggregated view
        const workspaceHeader = document.querySelector('.workspace-header');
        if (workspaceHeader) workspaceHeader.style.display = 'none';
        
        const navTabs = document.querySelector('.workspace-nav-tabs');
        if (navTabs) navTabs.style.display = 'none';
        
        const syncBtn = document.getElementById('btn-fetch');
        if (syncBtn) syncBtn.style.display = 'none';
        
        const syncStatusPill = document.getElementById('sync-status-pill');
        if (syncStatusPill) syncStatusPill.style.display = 'none';

        const sharedHeader = document.getElementById('shared-header');
        if (sharedHeader) sharedHeader.style.display = 'none'; // Hide entirely on Team view

        // Switch to Team Overview Page via Router
        navigateTo('team');

        const grid = document.getElementById('team-disk-grid');
        if (!grid) return;
        
        grid.innerHTML = '<div class="glass-panel" style="padding:20px;"><div class="spinner"></div> Loading team data...</div>';

        try {
            const res = await fetch(`api.php?type=team&name=${encodeURIComponent(teamName)}`);
            if (!res.ok) throw new Error('API fetching failed');
            const result = await res.json();
            
            if (result.status !== 'success' || !result.data || result.data.length === 0) {
                grid.innerHTML = '<div class="glass-panel" style="padding:20px; color:var(--text-secondary);">No disk usage reports available for this team.</div>';
                return;
            }

            let totalBytes = 0;
            let usedBytes = 0;
            let cardsHTML = '';

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
                
                let usedColor = 'var(--text-secondary)';
                if (usedPct >= 85) usedColor = '#f43f5e'; // rose-500
                else if (usedPct >= 70) usedColor = '#f59e0b'; // amber-500
                else usedColor = '#10b981'; // emerald-500
                
                cardsHTML += `<div class="team-disk-card" onclick="document.querySelector('.disk-list-item[data-id=\\'${diskId}\\']')?.click()">
                    <div class="card-header" style="margin-bottom: 12px;">
                        <span class="disk-name" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${diskName}">${diskName}</span>
                        <span class="disk-path" style="font-size: 0.8rem; white-space:nowrap; font-weight:700; color:${usedColor}; font-family:'JetBrains Mono', monospace;">${usedPct}% Used</span>
                    </div>
                    
                    <div class="team-card-bar-wrapper" style="width: 100%;">
                        <div class="sbar-track sbar-track-stacked" style="height: 10px; margin-bottom: 12px; border-radius: 5px;">
                            <div class="sbar-seg seg-amber" style="width:${scannedPct}%;" data-tooltip="Scanned: ${fmt(scanned)}"></div>
                            <div class="sbar-seg seg-slate" style="width:${unknownPct}%;" data-tooltip="Unknown: ${fmt(unknown)}"></div>
                        </div>
                        
                        <div class="team-card-stats" style="display: flex; justify-content: space-between; font-size: 0.75rem;">
                            <span class="text-secondary"><span class="legend-dot dot-amber"></span> Scanned <strong>${scannedPct}%</strong></span>
                            <span class="text-secondary"><span class="legend-dot dot-slate"></span> Unknown <strong>${unknownPct}%</strong></span>
                        </div>
                    </div>
                </div>`;
            });

            grid.innerHTML = cardsHTML;
            
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
                        plugins: { legend: { display: false }, tooltip: {
                            callbacks: { label: (ctx) => ' ' + fmt(ctx.raw) }
                        }},
                        cutout: '75%'
                    }
                });
            }
        } catch (e) {
            console.error("Team load error:", e);
            grid.innerHTML = '<div class="glass-panel" style="padding:20px; color:#f43f5e;">Failed to load team aggregated data. Please check connection.</div>';
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
            const response = await fetch(`api.php?id=${encodeURIComponent(this._activeDisk)}`);
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
            const res = await fetch(`api.php?id=${encodeURIComponent(this._activeDisk)}&type=permissions`);
            const text = await res.text();
            let json;
            try { 
                json = JSON.parse(text); 
            } catch (err1) { 
                try {
                    json = JSON.parse(atob(text)); 
                } catch (err2) {
                    console.error("API response was neither valid JSON nor Base64.", { text_preview: text.substring(0, 100) });
                    throw new Error(`Invalid API Response: ${text.substring(0, 100)}`);
                }
            }

            if (json?.status === 'success') {
                this._permissionsLoaded = true;
                document.dispatchEvent(new CustomEvent('permissionsLoaded', {
                    detail: json.data ? { diskId: this._activeDisk, ...json.data } : { diskId: this._activeDisk },
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
        if (titleEl && activeDisk) {
            titleEl.textContent = activeDisk.name;
        }

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
    const hamburgers = document.querySelectorAll('.hamburger-btn');
    const closeBtn  = document.getElementById('btn-sidebar-close');
    if (!sidebar || !backdrop || hamburgers.length === 0) return;

    const open  = () => { sidebar.classList.add('open');    backdrop.classList.add('visible');    document.body.style.overflow = 'hidden'; };
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
    document.addEventListener('diskSelected', () => { if (window.innerWidth <= 640) close(); });
}

// Bootstrap
document.addEventListener('DOMContentLoaded', () => {
    initRouter();
    initScaleToggle();
    initMobileSidebar();
    window.appFetcher = new DataFetcher();
});

