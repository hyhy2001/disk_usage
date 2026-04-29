/**
 * Render the Inodes Stat tab
 * @param {Object} inodesData - The JSON object from inode_usage_report.json
 */
export function renderInodesTab(inodesData, chartMgr) {
    const container = document.getElementById('inodes-body');
    if (!container) return;

    if (!inodesData) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                </div>
                <h3>No Inode Data</h3>
                <p>Inode tracking information is not available for this disk yet.</p>
            </div>
        `;
        return;
    }

    const { inodes_total = 0, inodes_used = 0, inodes_scanned = 0, inodes_free = 0, users = [] } = inodesData;

    function pct(part, total) { return total ? ((part / total) * 100).toFixed(1) : '0.0'; }

    const scannedBytes = inodes_scanned;
    const gapBytes = Math.max(0, inodes_used - inodes_scanned);
    
    const usedPct = pct(inodes_used, inodes_total);
    const pctCls  = parseFloat(usedPct) > 85 ? 'var(--rose-400)' : parseFloat(usedPct) > 65 ? 'var(--amber-400)' : 'var(--emerald-400)';

    const scannedOfTotal = inodes_total ? ((scannedBytes / inodes_total) * 100).toFixed(2) : 0;
    const gapOfTotal     = inodes_total ? ((gapBytes / inodes_total) * 100).toFixed(2) : 0;
    const freeOfTotal    = inodes_total ? ((inodes_free / inodes_total) * 100).toFixed(2) : 0;

    // Build the 4 mini stat cards
    const statCards = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px;">
            <div class="inode-stat-card">
                <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">Total Inodes</div>
                <div style="font-size: 1.25rem; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums;">${inodes_total.toLocaleString()}</div>
            </div>
            <div class="inode-stat-card">
                <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">Used Inodes</div>
                <div style="font-size: 1.25rem; font-weight: 600; color: ${pctCls}; font-variant-numeric: tabular-nums;">${inodes_used.toLocaleString()}</div>
            </div>
            <div class="inode-stat-card">
                <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">Scanned Inodes</div>
                <div style="font-size: 1.25rem; font-weight: 600; color: var(--emerald-400); font-variant-numeric: tabular-nums;">${inodes_scanned.toLocaleString()}</div>
            </div>
            <div class="inode-stat-card">
                <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">Free Inodes</div>
                <div style="font-size: 1.25rem; font-weight: 600; color: var(--sky-400); font-variant-numeric: tabular-nums;">${inodes_free.toLocaleString()}</div>
            </div>
        </div>
    `;

    // Unique main progress bar (thicker than normal sbar, using custom tooltips)
    const capacityBar = `
        <div style="margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
            <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 500;">Overall Inode Capacity</div>
            <div style="font-size: 0.85rem; font-weight: 600; color: ${pctCls};">${usedPct}% Used</div>
        </div>
        <div class="inode-chart-wrapper">
            <canvas id="inodePieChart"></canvas>
        </div>
    `;

    // Users Grid
    let userGrid = '<div class="table-empty" style="grid-column: 1 / -1;">No user data available.</div>';
    if (users && users.length > 0) {
        const sortedUsers = [...users].sort((a, b) => (b.inodes || 0) - (a.inodes || 0));
        userGrid = sortedUsers.map(u => {
            const userInodes = u.inodes || 0;
            const uPctTotal = pct(userInodes, inodes_total);
            const uPctUsed = pct(userInodes, inodes_used || 1);
            
            return `
            <div class="inode-user-card" data-username="${u.name.toLowerCase()}">
                <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 12px;">
                    <span style="font-weight: 500; font-size: 0.9rem; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${u.name}">${u.name}</span>
                    <span style="font-size: 0.85rem; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text-primary);">${userInodes.toLocaleString()}</span>
                </div>
                <div class="sbar-track" style="height: 6px; border-radius: 3px;" data-tooltip="${userInodes.toLocaleString()} inodes · ${uPctTotal}% of Total · ${uPctUsed}% of Used">
                    <div class="sbar-fill fill-sky" style="width:${Math.min(parseFloat(uPctTotal), 100)}%; border-radius: 3px;"></div>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--text-secondary);">
                    <span>${uPctTotal}% of System Total</span>
                    <span>${uPctUsed}% of Used</span>
                </div>
            </div>`;
        }).join('');
    }

    container.innerHTML = `
        <div class="snapshot-two-col" style="width: 100%;">
            <div class="glass-panel inode-panel inode-sys">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 20px; flex-shrink: 0;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--sky-400)"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    <h3 style="margin: 0; font-size: 1.1rem; color: var(--text-primary); font-weight: 600;">System Inode Overview</h3>
                </div>
                ${statCards}
                ${capacityBar}
            </div>

            <div class="glass-panel inode-panel inode-users">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; flex-wrap: wrap; gap: 16px; flex-shrink: 0;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--emerald-400)"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                        <h3 style="margin: 0; font-size: 1.1rem; color: var(--text-primary); font-weight: 600;">User Inode Distribution</h3>
                        <span class="result-count" style="margin-left: 8px;">${users.length} Users</span>
                    </div>
                    <div style="position: relative; width: 100%; max-width: 300px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--text-secondary); pointer-events: none;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        <input type="text" id="inode-user-search" placeholder="Search users..." class="sidebar-text-input" autocomplete="off" spellcheck="false" style="padding-top: 6px; padding-bottom: 6px; font-size: 0.8rem;">
                    </div>
                </div>
                <div id="inode-user-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; flex: 1; min-height: 0; overflow-y: auto; padding-right: 4px; align-content: start; padding-bottom: 8px;">
                    ${userGrid}
                </div>
            </div>
        </div>
    `;

    // Attach search event listener
    const searchInput = document.getElementById('inode-user-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const cards = document.querySelectorAll('.inode-user-card');
            cards.forEach(card => {
                const username = card.dataset.username;
                if (username.includes(term)) {
                    card.style.display = 'flex';
                } else {
                    card.style.display = 'none';
                }
            });
        });
    }

    if (chartMgr) {
        chartMgr.renderInodePieChart(inodes_total, inodes_used, inodes_scanned, inodes_free);
    }
}
