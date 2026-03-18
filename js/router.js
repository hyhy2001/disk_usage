// SPA Router — manages page visibility and active nav state

const PAGES = {
    overview: document.getElementById('page-overview'),
    detail: document.getElementById('page-detail'),
};

const NAV_ITEMS = {
    overview: document.getElementById('nav-overview'),
    detail: document.getElementById('nav-detail'),
};

let currentPage = 'overview';

function showPage(pageId) {
    if (!PAGES[pageId]) return;

    // Hide all pages
    Object.values(PAGES).forEach(el => {
        el.classList.remove('page-active');
        el.classList.add('page-hidden');
    });

    // Remove active from all nav items
    Object.values(NAV_ITEMS).forEach(el => {
        el?.classList.remove('nav-item-active');
    });

    // Show target page
    PAGES[pageId].classList.remove('page-hidden');
    PAGES[pageId].classList.add('page-active');
    NAV_ITEMS[pageId]?.classList.add('nav-item-active');

    currentPage = pageId;
}

export function navigateTo(pageId) {
    showPage(pageId);
}

export function initRouter() {
    // Set initial state
    showPage('overview');

    // Bind nav clicks
    Object.entries(NAV_ITEMS).forEach(([pageId, el]) => {
        el?.addEventListener('click', () => showPage(pageId));
    });
}
