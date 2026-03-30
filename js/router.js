// SPA Router — manages page visibility and active nav state
import { saveFilters, loadFilters } from './filterStorage.js';

const PAGES = {
    overview: document.getElementById('page-overview'),
    detail: document.getElementById('page-detail'),
    team: document.getElementById('page-team-overview'),
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
        if (el) {
            el.classList.remove('page-active');
            el.classList.add('page-hidden');
        }
    });

    // Remove active from all nav items
    Object.values(NAV_ITEMS).forEach(el => {
        if (el) {
            el.classList.remove('active');
            el.removeAttribute('aria-current');
        }
    });

    // Show target page
    if (PAGES[pageId]) {
        PAGES[pageId].classList.remove('page-hidden');
        PAGES[pageId].classList.add('page-active');
    }
    if (NAV_ITEMS[pageId]) {
        NAV_ITEMS[pageId].classList.add('active');
        NAV_ITEMS[pageId].setAttribute('aria-current', 'page');
    }

    const statBar = document.getElementById('shared-stat-bar');
    if (statBar) {
        statBar.style.display = (pageId === 'team') ? 'none' : '';
    }

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
