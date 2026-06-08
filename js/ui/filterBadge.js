// ui/filterBadge.js — at narrow content widths the History/Permission filter box
// collapses behind a "Filters" badge (see user-filter.css). This toggles the
// .filter-open state on the badge's .history-main-row; clicking outside or
// pressing Escape closes it. Delegated listeners survive list re-renders.

function closeAll(except) {
    document.querySelectorAll('.history-main-row.filter-open').forEach((row) => {
        if (row !== except) row.classList.remove('filter-open');
    });
}

export function initFilterBadge() {
    document.addEventListener('click', (e) => {
        const badge = e.target.closest('.filter-toggle-badge');
        if (badge) {
            e.preventDefault();
            e.stopPropagation();
            const row = badge.closest('.history-main-row');
            if (!row) return;
            const willOpen = !row.classList.contains('filter-open');
            closeAll(row);
            row.classList.toggle('filter-open', willOpen);
            return;
        }
        // Click outside an open filter box (and not on its badge) → close.
        if (!e.target.closest('.history-main-row.filter-open > .user-filter-box')) {
            closeAll(null);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAll(null);
    });
}
