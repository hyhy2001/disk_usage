// SPA Router — manages page visibility and active nav state
import { saveFilters, loadFilters } from './filterStorage.js';

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
        el?.classList.remove('nav-active');
        el?.removeAttribute('aria-current');
    });

    // Show target page
    PAGES[pageId].classList.remove('page-hidden');
    PAGES[pageId].classList.add('page-active');
    NAV_ITEMS[pageId]?.classList.add('nav-active');
    NAV_ITEMS[pageId]?.setAttribute('aria-current', 'page');

    currentPage = pageId;
    saveFilters({ activePage: pageId });
}

export function navigateTo(pageId) {
    showPage(pageId);
}

export function initRouter() {
    // Restore saved page or default to overview
    const saved = loadFilters().activePage;
    const initialPage = (saved && PAGES[saved]) ? saved : 'overview';
    showPage(initialPage);

    // Bind nav clicks
    Object.entries(NAV_ITEMS).forEach(([pageId, el]) => {
        el?.addEventListener('click', () => showPage(pageId));
    });
}
