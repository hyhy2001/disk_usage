document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-settings-toggle');
    const dropdown = document.getElementById('settings-dropdown');
    if (btn && dropdown) {
        dropdown.style.display = 'none';
        dropdown.dataset.visible = 'false';

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isVisible = dropdown.dataset.visible === 'true' || dropdown.style.display === 'flex';
            if (isVisible) {
                dropdown.style.display = 'none';
                dropdown.dataset.visible = 'false';
            } else {
                dropdown.style.display = 'flex';
                dropdown.dataset.visible = 'true';

                requestAnimationFrame(() => {
                    const rect = dropdown.getBoundingClientRect();
                    if (rect.bottom > window.innerHeight - 10) {
                        dropdown.style.top = 'auto';
                        dropdown.style.bottom = '0';
                    } else {
                        dropdown.style.top = '';
                        dropdown.style.bottom = '';
                    }
                });
                dropdown.style.animation = 'dropdownPop 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
            }
        });

        document.addEventListener('click', (e) => {
            if (dropdown.dataset.visible === 'true' && !dropdown.contains(e.target) && !btn.contains(e.target)) {
                dropdown.style.display = 'none';
                dropdown.dataset.visible = 'false';
            }
        });
    }

    const collapseBtn = document.getElementById('btn-sidebar-edge-collapse');
    if (localStorage.getItem('sidebar-collapsed') === 'true') {
        document.body.classList.add('sidebar-collapsed');
    }

    if (collapseBtn) {
        collapseBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const isCollapsed = document.body.classList.toggle('sidebar-collapsed');
            localStorage.setItem('sidebar-collapsed', isCollapsed ? 'true' : 'false');
        });
    }

    window.addEventListener('load', () => {
        setTimeout(() => {
            const perf = performance.getEntriesByType('navigation')[0];
            const loadTime = perf ? Math.round(perf.loadEventEnd - perf.startTime) : 0;
            const loadEl = document.getElementById('page-load-time');
            if (loadEl && loadTime > 0) {
                loadEl.innerHTML = `Load time: <span style="color:var(--emerald-400)">${loadTime}ms</span>`;
            }
        }, 0);
    });
});

(function () {
    const resizer = document.getElementById('col2-resizer');
    if (!resizer) return;

    let isResizing = false;

    const savedW = localStorage.getItem('col2_width');
    if (savedW) document.documentElement.style.setProperty('--col2-width', savedW + 'px');

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
        resizer.classList.add('active');
        e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const col2 = document.getElementById('team-disk-sidebar');
        if (!col2) return;
        const col2Rect = col2.getBoundingClientRect();
        const newWidth = e.clientX - col2Rect.left;

        const maxColWidth = Math.max(200, window.innerWidth - col2Rect.left - 450);
        if (newWidth >= 200 && newWidth <= Math.min(800, maxColWidth)) {
            document.documentElement.style.setProperty('--col2-width', newWidth + 'px');
        }
    });

    window.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            resizer.classList.remove('active');
            const w = getComputedStyle(document.documentElement).getPropertyValue('--col2-width').replace('px', '').trim();
            localStorage.setItem('col2_width', w);
        }
    });
})();
