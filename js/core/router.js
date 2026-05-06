// SPA Router — manages page visibility, active nav state, and hash routes
import { saveFilters, loadFilters } from '../utils/filterStorage.js';

const PAGES = {
    overview: document.getElementById('page-overview'),
    detail: document.getElementById('page-detail'),
    team: document.getElementById('page-team-overview'),
};

const NAV_ITEMS = {
    overview: document.getElementById('nav-overview'),
    detail: document.getElementById('nav-detail'),
};

const DETAIL_TAB_PATH = {
    snapshot: 'latest',
    history: 'history',
    'user-detail': 'detail-user',
    permissions: 'permission',
    treemap: 'treemap',
    inodes: 'inode',
};

const PATH_TO_DETAIL_TAB = Object.fromEntries(
    Object.entries(DETAIL_TAB_PATH).map(([k, v]) => [v, k])
);

let currentPage = 'overview';
let routeContext = { space: '', team: '', disk: '' };

function showPage(pageId) {
    if (!PAGES[pageId]) return;

    Object.values(PAGES).forEach(el => {
        if (el) {
            el.classList.remove('page-active');
            el.classList.add('page-hidden');
        }
    });

    Object.values(NAV_ITEMS).forEach(el => {
        if (el) {
            el.classList.remove('active');
            el.removeAttribute('aria-current');
        }
    });

    if (PAGES[pageId]) {
        PAGES[pageId].classList.remove('page-hidden');
        PAGES[pageId].classList.add('page-active');
    }
    if (NAV_ITEMS[pageId]) {
        NAV_ITEMS[pageId].classList.add('active');
        NAV_ITEMS[pageId].setAttribute('aria-current', 'page');
    }

    const statBar = document.getElementById('shared-stat-bar');
    if (statBar) statBar.style.display = (pageId === 'team') ? 'none' : '';

    currentPage = pageId;
    saveFilters({ activePage: pageId });
}

function parseRoute() {
    const raw = String(window.location.hash || '').replace(/^#/, '');
    const clean = (raw.startsWith('/') ? raw : `/${raw}`).replace(/\/+$/, '') || '/';
    const parts = clean.split('/').filter(Boolean);

    if (clean === '/') return { page: 'overview', detailTab: 'snapshot', space: '', team: '', disk: '', invalid: false };

    if (parts.length >= 1 && parts[0] !== 'spaces') {
        const team = decodeURIComponent(parts[0] || '').trim();
        if (!team) return { page: 'overview', detailTab: 'snapshot', space: '', team: '', disk: '', invalid: true };

        if (parts.length === 1) {
            return { page: 'overview', detailTab: 'snapshot', space: 'storageos', team, disk: '', invalid: false };
        }

        const disk = decodeURIComponent(parts[1] || '').trim();
        if (!disk) return { page: 'overview', detailTab: 'snapshot', space: '', team: '', disk: '', invalid: true };

        const pageSeg = (parts[2] || '').trim();
        if (pageSeg === 'overview') {
            return { page: 'overview', detailTab: 'snapshot', space: 'storageos', team, disk, invalid: false };
        }
        if (pageSeg === 'detail') {
            const slug = (parts[3] || 'latest').trim();
            const tab = PATH_TO_DETAIL_TAB[slug];
            if (!tab && slug !== 'latest') {
                return { page: 'overview', detailTab: 'snapshot', space: '', team: '', disk: '', invalid: true };
            }
            return { page: 'detail', detailTab: tab || 'snapshot', space: 'storageos', team, disk, invalid: false };
        }
        return { page: 'overview', detailTab: 'snapshot', space: '', team: '', disk: '', invalid: true };
    }

    if (parts[0] === 'spaces') {
        if (parts.length >= 5) {
            const page = parts[4] === 'detail' ? 'detail' : (parts[4] === 'overview' ? 'overview' : '');
            if (!page) return { page: 'overview', detailTab: 'snapshot', space: '', team: '', disk: '', invalid: true };
            const slug = (parts[5] || 'latest').trim();
            const tab = PATH_TO_DETAIL_TAB[slug];
            if (page === 'detail' && !tab && slug !== 'latest') {
                return { page: 'overview', detailTab: 'snapshot', space: '', team: '', disk: '', invalid: true };
            }
            return {
                page,
                detailTab: page === 'detail' ? (tab || 'snapshot') : 'snapshot',
                space: decodeURIComponent(parts[1] || ''),
                team: decodeURIComponent(parts[2] || ''),
                disk: decodeURIComponent(parts[3] || ''),
                invalid: false,
            };
        }
        return { page: 'overview', detailTab: 'snapshot', space: '', team: '', disk: '', invalid: true };
    }

    if (clean === '/overview') return { page: 'overview', detailTab: 'snapshot', space: '', team: '', disk: '', invalid: false };
    if (clean === '/detail' || clean === '/detail/latest') return { page: 'detail', detailTab: 'snapshot', space: '', team: '', disk: '', invalid: false };
    if (clean.startsWith('/detail/')) {
        const slug = clean.slice('/detail/'.length).trim();
        const tab = PATH_TO_DETAIL_TAB[slug];
        if (!tab) return { page: 'overview', detailTab: 'snapshot', space: '', team: '', disk: '', invalid: true };
        return { page: 'detail', detailTab: tab, space: '', team: '', disk: '', invalid: false };
    }

    return { page: 'overview', detailTab: 'snapshot', space: '', team: '', disk: '', invalid: true };
}


function toRoutePath(pageId, detailTab = 'snapshot') {
    const team = encodeURIComponent(routeContext.team || 'team');
    const diskRaw = String(routeContext.disk || '').trim();
    if (diskRaw === '') return `/${team}`;

    const disk = encodeURIComponent(diskRaw);
    const page = pageId === 'detail' ? 'detail' : 'overview';

    if (page === 'detail') {
        const slug = DETAIL_TAB_PATH[detailTab] || 'latest';
        return `/${team}/${disk}/detail/${slug}`;
    }
    return `/${team}/${disk}/overview`;
}

export function setRouteContext(ctx = {}) {
    routeContext = {
        space: Object.prototype.hasOwnProperty.call(ctx, 'space') ? String(ctx.space || '') : String(routeContext.space || ''),
        team: Object.prototype.hasOwnProperty.call(ctx, 'team') ? String(ctx.team || '') : String(routeContext.team || ''),
        disk: Object.prototype.hasOwnProperty.call(ctx, 'disk') ? String(ctx.disk || '') : String(routeContext.disk || ''),
    };
}

export function getDetailTabFromUrl() {
    return parseRoute().detailTab;
}

export function replaceRoute(pageId, detailTab = 'snapshot') {
    const next = `#${toRoutePath(pageId, detailTab)}`;
    if (window.location.hash !== next) {
        const base = window.location.href.split('#')[0];
        history.replaceState({}, '', `${base}${next}`);
    }
}

export function navigateTo(pageId, detailTab = null) {
    showPage(pageId);
    const tab = detailTab || parseRoute().detailTab || loadFilters().activeTab || 'snapshot';
    const next = `#${toRoutePath(pageId, tab)}`;
    if (window.location.hash !== next) window.location.hash = next;
}

export function initRouter() {
    const fromRoute = parseRoute();
    if (fromRoute.invalid) {
        const base = window.location.href.split('#')[0];
        history.replaceState({}, '', `${base}#/`);
        showPage('overview');
        saveFilters({ activePage: 'overview', activeTab: 'snapshot', activeDisk: null });
        return;
    }
    if (fromRoute.space || fromRoute.team || fromRoute.disk) {
        setRouteContext({ space: fromRoute.space, team: fromRoute.team, disk: fromRoute.disk });
    }

    const savedState = loadFilters();
    const saved = savedState.activePage;
    const initialPage = (fromRoute.page && PAGES[fromRoute.page]) ? fromRoute.page : ((saved && PAGES[saved]) ? saved : 'overview');

    // Seed state from URL route first (critical for deep-link restore with disk + tab)
    const seed = { activePage: initialPage, activeTab: fromRoute.detailTab || savedState.activeTab || 'snapshot' };
    if (fromRoute.disk) seed.activeDisk = fromRoute.disk;
    saveFilters(seed);

    showPage(initialPage);
    replaceRoute(initialPage, fromRoute.detailTab || 'snapshot');

    Object.entries(NAV_ITEMS).forEach(([pageId, el]) => {
        el?.addEventListener('click', () => navigateTo(pageId, pageId === 'detail' ? (loadFilters().activeTab || 'snapshot') : null));
    });

    window.addEventListener('hashchange', () => {
        const state = parseRoute();
        if (state.invalid) {
            const base = window.location.href.split('#')[0];
            history.replaceState({}, '', `${base}#/`);
            showPage('overview');
            saveFilters({ activePage: 'overview', activeTab: 'snapshot', activeDisk: null });
            return;
        }
        if (state.space || state.team || state.disk) {
            setRouteContext({ space: state.space, team: state.team, disk: state.disk });
        }
        showPage(state.page);
        saveFilters({ activeTab: state.detailTab });
        if (state.page === 'detail') {
            const btn = document.querySelector(`.detail-tab-btn[data-tab="${state.detailTab}"]`);
            if (btn && !btn.classList.contains('active')) btn.click();
        }
    });
}
