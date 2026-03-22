// permissionRenderer.js — Renders Permission Issues tab content
// Listens for 'permissionsLoaded' event dispatched by dataFetcher.js
import { fmtDateSec as fmtDate } from './formatters.js';

const TYPE_ICON = { directory: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`, file: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>` };

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderItem(item) {
    const icon = TYPE_ICON[item.type] ?? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`;
    return `
        <div class="perm-item">
            <span class="perm-item-icon">${icon}</span>
            <span class="perm-item-path">${escHtml(item.path)}</span>
            <span class="perm-item-type">${escHtml(item.type ?? '')}</span>
            <span class="perm-item-error">${escHtml(item.error ?? '')}</span>
        </div>`;
}

// ── Filter helpers ────────────────────────────────────────────────────────────

function getActiveKeys() {
    return new Set(
        Array.from(document.querySelectorAll('#perm-filter-list .user-filter-item.selected'))
            .map(el => el.dataset.key)
    );
}

function applyPermFilter(query) {
    const activeKeys = getActiveKeys();
    const q = (query ?? document.getElementById('perm-path-search')?.value ?? '').toLowerCase();

    document.querySelectorAll('.perm-user-card[data-key]').forEach(card => {
        const keyMatch = activeKeys.has(card.dataset.key);
        if (!keyMatch) { card.style.display = 'none'; return; }

        if (q) {
            let anyVisible = false;
            card.querySelectorAll('.perm-item').forEach(item => {
                const path = item.querySelector('.perm-item-path')?.textContent ?? '';
                const show = path.toLowerCase().includes(q);
                item.style.display = show ? '' : 'none';
                if (show) anyVisible = true;
            });
            card.style.display = anyVisible ? '' : 'none';
        } else {
            card.querySelectorAll('.perm-item').forEach(item => item.style.display = '');
            card.style.display = '';
        }
    });

    // Update count badge
    const countEl = document.getElementById('perm-filter-count');
    if (countEl) countEl.textContent = `${activeKeys.size} selected`;
}

window._permToggleItem = function(el) {
    el.classList.toggle('selected');
    const chk = el.querySelector('.user-filter-check');
    if (chk) chk.textContent = el.classList.contains('selected') ? '✓' : '';
    applyPermFilter();
};

window._permSearch = function(val) {
    applyPermFilter(val);
};

// ── Main render ───────────────────────────────────────────────────────────────

function renderPermissions(data) {
    const body = document.getElementById('permissions-body');
    if (!body) return;

    if (!data) {
        body.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/>
                    </svg>
                </div>
                <h3>No Permission Data</h3>
                <p>No permission issues file found for this disk.</p>
            </div>`;
        return;
    }

    const issues  = data.permission_issues ?? {};
    const users   = issues.users         ?? [];
    const unknown = issues.unknown_items ?? [];
    const dateStr = fmtDate(data.date);
    const dir     = data.directory ?? '—';

    const userIssues  = users.reduce((n, u) => n + (u.inaccessible_items?.length ?? 0), 0);
    const totalIssues = userIssues + unknown.length;

    // Default: first user selected only
    const defaultKey = users[0]?.name ?? null;

    // ── Filter box items ───────────────────────────────────────────────────────
    const filterItems = users.map(u => {
        const sel = u.name === defaultKey;
        const count = (u.inaccessible_items ?? []).length;
        return `<div class="user-filter-item${sel ? ' selected' : ''}" data-key="${escHtml(u.name)}"
            onclick="window._permToggleItem(this)">
            <span class="user-filter-check">${sel ? '✓' : ''}</span>
            <span class="user-filter-name">${escHtml(u.name)}</span>
            <span class="result-count" style="font-size:0.65rem;padding:1px 5px">${count}</span>
        </div>`;
    }).join('');

    const unknownItem = unknown.length > 0
        ? `<div class="user-filter-divider"></div>
           <div class="user-filter-item" data-key="__unknown__"
               onclick="window._permToggleItem(this)">
               <span class="user-filter-check"></span>
               <span class="user-filter-name"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17"/></svg> Unknown</span>
               <span class="result-count" style="font-size:0.65rem;padding:1px 5px">${unknown.length}</span>
           </div>`
        : '';

    // ── User cards ─────────────────────────────────────────────────────────────
    const userSections = users.map(u => {
        const items = u.inaccessible_items ?? [];
        const count = items.length;
        return `
        <div class="perm-user-card glass-panel" data-key="${escHtml(u.name)}">
            <div class="perm-user-header">
                <span class="perm-user-name"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${escHtml(u.name)}</span>
                <span class="result-count">${count} item${count !== 1 ? 's' : ''}</span>
            </div>
            <div class="perm-items">${items.map(renderItem).join('')}</div>
        </div>`;
    }).join('');

    const unknownSection = unknown.length > 0 ? `
        <div class="perm-user-card glass-panel" data-key="__unknown__">
            <div class="perm-user-header">
                <span class="perm-user-name"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17"/></svg> Unknown Items</span>
                <span class="result-count">${unknown.length}</span>
            </div>
            <div class="perm-items">${unknown.map(renderItem).join('')}</div>
        </div>` : '';

    // ── Full layout ────────────────────────────────────────────────────────────
    body.innerHTML = `
        <div class="perm-meta">
            <span class="perm-meta-date"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${dateStr}</span>
            <span class="perm-meta-dir"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> ${escHtml(dir)}</span>
            <span class="result-count">${totalIssues} total issue${totalIssues !== 1 ? 's' : ''}</span>
        </div>

        <div class="perm-summary-bar glass-panel">
            <div class="perm-summary-item">
                <span class="perm-summary-num">${users.length}</span>
                <span class="perm-summary-label">Users affected</span>
            </div>
            <div class="stat-divider"></div>
            <div class="perm-summary-item">
                <span class="perm-summary-num">${userIssues}</span>
                <span class="perm-summary-label">User inaccessible items</span>
            </div>
            <div class="stat-divider"></div>
            <div class="perm-summary-item">
                <span class="perm-summary-num">${unknown.length}</span>
                <span class="perm-summary-label">Unknown items</span>
            </div>
        </div>

        <!-- 2-col: Filter Box + Cards -->
        <div class="history-main-row">

            <!-- Left: User Filter Box -->
            <div class="glass-panel user-filter-box">
                <div class="user-filter-header">
                    <span class="user-filter-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Users</span>
                    <span class="user-filter-count" id="perm-filter-count">1 selected</span>
                </div>
                <div class="perm-filter-searches">
                    <input type="text" id="perm-user-search" class="user-filter-search"
                        placeholder="Search user…"
                        oninput="
                            const q = this.value.toLowerCase();
                            document.querySelectorAll('#perm-filter-list .user-filter-item').forEach(el => {
                                el.style.display = (el.dataset.key || '').toLowerCase().includes(q) ? '' : 'none';
                            });
                        ">
                    <input type="text" id="perm-path-search" class="user-filter-search"
                        placeholder="Filter paths…"
                        oninput="window._permSearch(this.value)">
                </div>
                <div class="user-filter-list" id="perm-filter-list">
                    ${filterItems}${unknownItem}
                </div>
                <div class="user-filter-footer">
                    <button class="user-bar-btn" onclick="
                        document.querySelectorAll('#perm-filter-list .user-filter-item').forEach(el => {
                            el.classList.add('selected');
                            const chk = el.querySelector('.user-filter-check');
                            if (chk) chk.textContent = '✓';
                        });
                        window._permSearch();
                    ">All</button>
                    <button class="user-bar-btn" onclick="
                        document.querySelectorAll('#perm-filter-list .user-filter-item').forEach(el => {
                            el.classList.remove('selected');
                            const chk = el.querySelector('.user-filter-check');
                            if (chk) chk.textContent = '';
                        });
                        window._permSearch();
                    ">Clear</button>
                 </div>
            </div>

            <!-- Right: User Cards -->
            <div class="history-content">
                <div class="perm-sections" style="display:flex;flex-direction:column;gap:12px">
                    ${userSections}
                    ${unknownSection}
                </div>
            </div>

        </div>`;

    // Apply initial filter (only first user visible)
    applyPermFilter();
}

document.addEventListener('permissionsLoaded', (e) => {
    renderPermissions(e.detail);
});

export { renderPermissions };
