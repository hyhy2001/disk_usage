import { showToast } from '../core/main.js';
import { fmt } from '../utils/formatters.js';

let _diskId = null;
let _rootNode = null;
let _currentNode = null;
let _searchQuery = '';
let _searchRenderToken = 0;
let _searchDebounceTimer = null;
let _searchOutsideClickBound = false;

let _searchState = {
    q: '',
    offset: 0,
    total: 0,
    hasMore: false,
    loading: false,
    source: 'none',
    items: []
};

const NODE_PAGE_SIZE = 20;
const SEARCH_PAGE_SIZE = 20;
const _pageCache = {};       // key: shard:offset:limit => response
const _inflight = {};        // key => Promise
const _searchPageCache = {}; // key: q:offset:limit => response
const _searchInflight = {};  // key => Promise
let _listDelegationBound = false;
let _lastRenderedNodeState = null;

function getRootTotalSize() {
    return Math.max(0, Number((_rootNode && _rootNode.value) || 0));
}

function getPercentOfDisk(value) {
    const total = getRootTotalSize();
    if (!total) return 0;
    return Math.max(0, Math.min(100, (Number(value || 0) / total) * 100));
}

function formatPercent(pct) {
    if (pct >= 10) return pct.toFixed(1) + '%';
    if (pct >= 1) return pct.toFixed(2) + '%';
    if (pct > 0) return '<0.01%';
    return '0%';
}

function getNodeIconSvg(node) {
    if (node && (node.type === 'file_group' || node.type === 'file')) {
        return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    }
    return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
}

function escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function sortByValueDesc(a, b) {
    return (b.value || 0) - (a.value || 0);
}

function getNodeTypeLabel(node) {
    if (!node) return 'Unknown';
    if (node.type === 'file_group') return 'Files';
    if (node.type === 'file') return 'File';
    return 'Directory';
}

function setMeta(node, source) {
    const el = document.getElementById('tm-meta');
    if (!el) return;
    if (!node) {
        el.textContent = 'No node selected';
        return;
    }
    el.textContent = (node.path || node.name || '-') + ' • ' + fmt(node.value || 0) + (source ? (' • source: ' + source) : '');
}

function getNodeState(node) {
    if (!node.__tmState) {
        node.__tmState = {
            loading: false,
            offset: 0,
            total: 0,
            hasMore: false,
            source: 'index',
            children: [],
            sortedInline: false
        };
    }
    return node.__tmState;
}

function getChain(node) {
    const arr = [];
    let cur = node || null;
    while (cur) {
        arr.push(cur);
        cur = cur.__tmParent || null;
    }
    arr.reverse();
    return arr;
}

function buildVirtualChainFromPath(path) {
    if (!path || path === '/') return [{ name: '/', path: '/', __tmVirtualRoot: true }];
    const parts = String(path).split('/').filter(function(p) { return p !== ''; });
    const chain = [{ name: '/', path: '/', __tmVirtualRoot: true }];
    let acc = '';
    for (let i = 0; i < parts.length; i++) {
        acc += '/' + parts[i];
        chain.push({
            name: parts[i],
            path: acc,
            __tmVirtual: true
        });
    }
    return chain;
}

function renderBreadcrumb(node) {
    const holder = document.getElementById('tmx-breadcrumb');
    if (!holder) return;

    if (!node) {
        holder.innerHTML = '<span class="tmx-crumb-empty">/</span>';
        return;
    }

    let chain = getChain(node);
    if (node && node.path && chain.length <= 2) {
        chain = buildVirtualChainFromPath(node.path);
    }
    let html = '';
    for (let i = 0; i < chain.length; i++) {
        const n = chain[i];
        const label = (n.name && n.name !== '/') ? n.name : '/';
        html += '<button type="button" class="tmx-crumb-btn" data-idx="' + i + '">' + escHtml(label) + '</button>';
        if (i < chain.length - 1) html += '<span class="tmx-crumb-sep">/</span>';
    }
    holder.innerHTML = html;

    holder.querySelectorAll('.tmx-crumb-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const idx = parseInt(btn.getAttribute('data-idx') || '-1', 10);
            if (isNaN(idx) || idx < 0 || idx >= chain.length) return;
            const target = chain[idx];

            if (target.__tmVirtualRoot) {
                _searchQuery = '';
                resetSearchState('');
                const input = document.getElementById('tmx-search-input');
                if (input) input.value = '';
                _currentNode = _rootNode;
                renderCurrentNode();
                return;
            }

            if (target.__tmVirtual) {
                _searchQuery = target.path || target.name || '';
                // Force a fresh fetch for the breadcrumb-selected segment.
                // If we set state.q equal here, renderCurrentNode may skip fetching.
                resetSearchState('');
                const input = document.getElementById('tmx-search-input');
                if (input) input.value = _searchQuery;
                renderCurrentNode();
                return;
            }

            _currentNode = target;
            renderCurrentNode();
        });
    });
}

async function fetchShardPage(shardId, offset, limit) {
    if (!shardId || !_diskId) return { items: [], total: 0, has_more: false, source: 'none' };

    const key = shardId + ':' + offset + ':' + limit;
    if (_pageCache[key]) return _pageCache[key];
    if (_inflight[key]) return _inflight[key];

    _inflight[key] = (async function() {
        try {
            const res = await fetch(
                'api.php?id=' + encodeURIComponent(_diskId) +
                '&type=treemap&shard_id=' + encodeURIComponent(shardId) +
                '&offset=' + encodeURIComponent(offset) +
                '&limit=' + encodeURIComponent(limit)
            );
            const text = await res.text();
            let json;
            try {
                json = JSON.parse(text);
            } catch (_e) {
                json = JSON.parse(atob(text));
            }

            if (json && json.status === 'success' && json.data && Array.isArray(json.data.items)) {
                _pageCache[key] = json.data;
                return json.data;
            }
        } catch (e) {
            showToast('Tree load failed', e.message || 'Could not load folder children', 'warning', 2200);
        } finally {
            delete _inflight[key];
        }

        return { items: [], total: 0, has_more: false, source: 'none' };
    })();

    return _inflight[key];
}

async function fetchSearchPage(query, offset, limit) {
    if (!_diskId || !query) return { items: [], total: 0, has_more: false, source: 'none' };

    const key = query + ':' + offset + ':' + limit;
    if (_searchPageCache[key]) return _searchPageCache[key];
    if (_searchInflight[key]) return _searchInflight[key];

    _searchInflight[key] = (async function() {
        try {
            const res = await fetch(
                'api.php?id=' + encodeURIComponent(_diskId) +
                '&type=treemap_search&q=' + encodeURIComponent(query) +
                '&offset=' + encodeURIComponent(offset) +
                '&limit=' + encodeURIComponent(limit)
            );
            const text = await res.text();
            let json;
            try {
                json = JSON.parse(text);
            } catch (_e) {
                json = JSON.parse(atob(text));
            }

            if (json && json.status === 'success' && json.data && Array.isArray(json.data.items)) {
                _searchPageCache[key] = json.data;
                return json.data;
            }
        } catch (e) {
            showToast('Search failed', e.message || 'Could not search tree map', 'warning', 2200);
        } finally {
            delete _searchInflight[key];
        }

        return { items: [], total: 0, has_more: false, source: 'none' };
    })();

    return _searchInflight[key];
}

async function loadMoreForNode(node) {
    const st = getNodeState(node);
    if (st.loading) return;
    st.loading = true;

    try {
        let batch = [];
        let hasMore = false;
        let total = 0;
        let source = st.source || 'index';

        if (node.shard_id) {
            const data = await fetchShardPage(node.shard_id, st.offset, NODE_PAGE_SIZE);
            batch = Array.isArray(data.items) ? data.items : [];
            hasMore = !!data.has_more;
            total = Number(data.total || 0);
            source = data.source || 'shard';
        } else {
            const all = Array.isArray(node.children) ? node.children : [];
            if (!st.sortedInline) {
                all.sort(sortByValueDesc);
                st.sortedInline = true;
            }
            batch = all.slice(st.offset, st.offset + NODE_PAGE_SIZE);
            total = all.length;
            hasMore = (st.offset + batch.length) < total;
            source = 'index';
        }

        for (let i = 0; i < batch.length; i++) {
            batch[i].__tmParent = node;
        }

        st.children = st.children.concat(batch);
        st.offset += batch.length;
        st.total = total;
        st.hasMore = hasMore;
        st.source = source;
    } finally {
        st.loading = false;
    }
}

function resetSearchState(query) {
    _searchState = {
        q: query || '',
        offset: 0,
        total: 0,
        hasMore: false,
        loading: false,
        source: 'none',
        items: []
    };
}

async function loadMoreGlobalSearch() {
    const q = (_searchState.q || '').trim();
    if (!q || _searchState.loading) return;

    _searchState.loading = true;
    try {
        const data = await fetchSearchPage(q, _searchState.offset, SEARCH_PAGE_SIZE);
        const batch = Array.isArray(data.items) ? data.items : [];
        _searchState.items = _searchState.items.concat(batch);
        _searchState.offset += batch.length;
        _searchState.total = Number(data.total || 0);
        _searchState.hasMore = !!data.has_more;
        _searchState.source = data.source || 'none';
    } finally {
        _searchState.loading = false;
    }
}

function mapSearchHitToNode(hit) {
    return {
        name: hit.name || hit.path || 'node',
        path: hit.path || '',
        value: hit.value || 0,
        type: hit.type || 'directory',
        owner: hit.owner || '',
        has_children: !!hit.has_children,
        shard_id: hit.shard_id || '',
        __tmParent: _rootNode || null
    };
}

function hideSearchDropdown() {
    const box = document.getElementById('tmx-search-dropdown');
    if (!box) return;
    box.classList.remove('is-open');
    box.innerHTML = '';
}

function pickSearchHit(hit) {
    const node = mapSearchHitToNode(hit);
    _searchQuery = '';
    resetSearchState('');
    const input = document.getElementById('tmx-search-input');
    if (input) input.value = '';
    hideSearchDropdown();
    _currentNode = node;
    renderCurrentNode();
}

function renderSearchDropdown() {
    const box = document.getElementById('tmx-search-dropdown');
    if (!box) return;

    const q = (_searchQuery || '').trim();
    if (!q) {
        hideSearchDropdown();
        return;
    }

    if (_searchState.loading && _searchState.items.length === 0) {
        box.classList.add('is-open');
        box.innerHTML = '<div class="tmx-search-dropdown-empty">Searching...</div>';
        return;
    }

    if (_searchState.items.length === 0) {
        box.classList.add('is-open');
        box.innerHTML = '<div class="tmx-search-dropdown-empty">No match found.</div>';
        return;
    }

    let html = '';
    _searchState.items.forEach(function(hit, idx) {
        const label = hit.name || hit.path || 'node';
        const fullPath = hit.path || '/';
        html +=
            '<button type="button" class="tmx-search-option" data-idx="' + idx + '">' +
                '<span class="tmx-search-option-name">' + escHtml(label) + '</span>' +
                '<span class="tmx-search-option-path">' + escHtml(fullPath) + '</span>' +
            '</button>';
    });

    box.classList.add('is-open');
    box.innerHTML = html;

    box.querySelectorAll('.tmx-search-option').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const idx = parseInt(btn.getAttribute('data-idx') || '-1', 10);
            if (isNaN(idx) || idx < 0 || idx >= _searchState.items.length) return;
            pickSearchHit(_searchState.items[idx]);
        });
    });
}

function renderList(node) {
    const list = document.getElementById('tmx-list');
    if (!list) return;

    const st = getNodeState(node);
    _lastRenderedNodeState = st;

    if (!_listDelegationBound) {
        list.addEventListener('click', function(e) {
            const btn = e.target && typeof e.target.closest === 'function'
                ? e.target.closest('.tmx-item[data-child-idx]')
                : null;
            if (!btn || !_lastRenderedNodeState) return;
            const idx = parseInt(btn.getAttribute('data-child-idx'), 10);
            if (isNaN(idx) || idx < 0 || idx >= _lastRenderedNodeState.children.length) return;
            const child = _lastRenderedNodeState.children[idx];
            if (child.has_children || child.shard_id) {
                _currentNode = child;
                renderCurrentNode();
            } else {
                setMeta(child, _lastRenderedNodeState.source || 'index');
            }
        });
        _listDelegationBound = true;
    }

    list.innerHTML = '';

    if (st.children.length === 0 && !st.hasMore) {
        list.innerHTML = '<div class="tmx-empty">No child nodes.</div>';
        return;
    }

    const fragment = document.createDocumentFragment();
    st.children.forEach(function(child, idx) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tmx-item';
        btn.setAttribute('data-child-idx', String(idx));

        const isFile = (child.type === 'file_group' || child.type === 'file');
        const iconSvg = getNodeIconSvg(child);
        const iconClass = isFile ? 'is-file' : 'is-dir';
        const value = Number(child.value || 0);
        const pct = getPercentOfDisk(value);
        const pctText = formatPercent(pct);
        const barWidth = Math.max(0.5, Math.min(100, pct)).toFixed(2);

        btn.innerHTML =
            '<span class="tmx-item-folder">' +
                '<span class="tmx-item-icon ' + iconClass + '">' + iconSvg + '</span>' +
                '<span class="tmx-item-main">' +
                    '<span class="tmx-item-name">' + escHtml(child.name || child.path || 'node') + '</span>' +
                '</span>' +
            '</span>' +
            '<span class="tmx-item-owner">' + escHtml(child.owner || '-') + '</span>' +
            '<span class="tmx-item-size">' +
                '<span class="tmx-size-text">' +
                    '<span class="tmx-size-val">' + escHtml(fmt(value)) + '</span>' +
                    '<span class="tmx-size-pct">' + pctText + '</span>' +
                '</span>' +
                '<span class="tmx-size-bar-bg"><span class="tmx-size-bar-fill" style="width:' + barWidth + '%"></span></span>' +
            '</span>' +
            '<span class="tmx-item-type">' + escHtml(getNodeTypeLabel(child)) + '</span>';

        fragment.appendChild(btn);
    });

    if (st.hasMore) {
        const moreWrap = document.createElement('div');
        moreWrap.className = 'tmx-load-more';
        const moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'user-bar-btn';
        moreBtn.textContent = 'Load more';
        moreBtn.addEventListener('click', async function() {
            moreBtn.disabled = true;
            moreBtn.textContent = 'Loading...';
            await loadMoreForNode(node);
            renderList(node);
            setMeta(node, getNodeState(node).source || 'index');
        });
        moreWrap.appendChild(moreBtn);
        fragment.appendChild(moreWrap);
    }

    list.appendChild(fragment);
    syncTableHeadGutter();
}

function syncTableHeadGutter() {
    const wrap = document.querySelector('.tmx-wrap');
    const list = document.getElementById('tmx-list');
    if (!wrap || !list) return;

    const scrollbarWidth = Math.max(0, list.offsetWidth - list.clientWidth);
    wrap.style.setProperty('--tmx-list-scrollbar', scrollbarWidth + 'px');
}

async function renderCurrentNode() {
    const node = _currentNode;
    if (!node) return;

    const token = ++_searchRenderToken;
    const query = (_searchQuery || '').trim();

    if (query) {
        if (_searchState.q !== query) {
            resetSearchState(query);
            await loadMoreGlobalSearch();
            if (token !== _searchRenderToken) return;
        }

        renderBreadcrumb(node);
        setMeta(node, 'global_search');

        const searchTitleEl = document.getElementById('tmx-current-title');
        if (searchTitleEl) {
            searchTitleEl.textContent = 'Global search "' + query + '" • choose a path from dropdown';
        }

        renderList(node);
        renderSearchDropdown();
        return;
    }

    const st = getNodeState(node);
    if (st.children.length === 0 && (node.has_children || node.shard_id || (Array.isArray(node.children) && node.children.length > 0))) {
        await loadMoreForNode(node);
        if (token !== _searchRenderToken) return;
    }

    renderBreadcrumb(node);
    setMeta(node, st.source || 'index');

    const titleEl = document.getElementById('tmx-current-title');
    if (titleEl) {
        const loaded = st.children.length;
        const total = st.total || loaded;
        titleEl.textContent = (node.path || node.name || '/') + ' (' + loaded + '/' + total + ')';
    }

    renderList(node);
    hideSearchDropdown();
}

function renderExplorer(rootNode, meta) {
    const body = document.getElementById('treemap-body');
    if (!body) return;

    if (!rootNode) {
        body.innerHTML =
            '<div class="empty-state">' +
                '<div class="empty-state-icon">' +
                    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                        '<circle cx="12" cy="12" r="10"></circle><path d="M12 8v4"></path><circle cx="12" cy="16" r="1"></circle>' +
                    '</svg>' +
                '</div>' +
                '<h3>No Tree Data</h3>' +
                '<p>No <code>tree_map_report.json</code> found for this disk.</p>' +
            '</div>';
        return;
    }

    body.innerHTML =
        '<div class="treemap-layout">' +
            '<div class="glass-panel treemap-toolbar">' +
                '<div class="treemap-toolbar-left">' +
                    '<button class="user-bar-btn" id="tm-back-btn" data-tooltip="Back to parent"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg> Back</button>' +
                    '<button class="user-bar-btn" id="tm-root-btn" data-tooltip="Jump to disk root"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 12 3l9 6.5"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg> Root</button>' +
                '</div>' +
                '<div class="treemap-toolbar-right"><span class="treemap-meta" id="tm-meta"></span></div>' +
            '</div>' +
            '<div class="glass-panel tmx-wrap">' +
                '<div class="tmx-breadcrumb" id="tmx-breadcrumb"></div>' +
                '<div class="tmx-search">' +
                    '<div class="tmx-search-input-wrap">' +
                        '<input id="tmx-search-input" class="tmx-search-input" type="text" placeholder="Global search path/name..." autocomplete="off" />' +
                        '<div class="tmx-search-dropdown" id="tmx-search-dropdown"></div>' +
                    '</div>' +
                    '<button type="button" id="tmx-search-clear" class="tmx-search-clear" data-tooltip="Clear search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
                '</div>' +
                '<div class="tmx-current-title" id="tmx-current-title"></div>' +
                '<div class="tmx-table-head">' +
                    '<span class="tmx-col-name">Folder</span>' +
                    '<span class="tmx-col-owner">Owner</span>' +
                    '<span class="tmx-col-size">Size · %</span>' +
                    '<span class="tmx-col-type">Type</span>' +
                '</div>' +
                '<div class="tmx-list" id="tmx-list"></div>' +
            '</div>' +
        '</div>';

    rootNode.__tmParent = null;
    const rootState = getNodeState(rootNode);
    rootState.source = (meta && meta.db_available) ? 'sqlite_db/json_shard' : 'index';

    _currentNode = rootNode;

    const backBtn = document.getElementById('tm-back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', function() {
            if (_currentNode && _currentNode.__tmParent) {
                _currentNode = _currentNode.__tmParent;
                renderCurrentNode();
            }
        });
    }

    const rootBtn = document.getElementById('tm-root-btn');
    if (rootBtn) {
        rootBtn.addEventListener('click', function() {
            _currentNode = rootNode;
            renderCurrentNode();
        });
    }

    const searchInput = document.getElementById('tmx-search-input');
    if (searchInput) {
        searchInput.value = _searchQuery;
        searchInput.addEventListener('input', function() {
            _searchQuery = searchInput.value || '';
            if (_searchDebounceTimer) clearTimeout(_searchDebounceTimer);
            _searchDebounceTimer = setTimeout(function() {
                renderCurrentNode();
            }, 180);
        });
        searchInput.addEventListener('focus', function() {
            if ((_searchQuery || '').trim()) renderSearchDropdown();
        });
        searchInput.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                hideSearchDropdown();
                return;
            }
            if (e.key === 'Enter' && _searchState.items.length > 0) {
                e.preventDefault();
                pickSearchHit(_searchState.items[0]);
            }
        });
    }

    const clearBtn = document.getElementById('tmx-search-clear');
    if (clearBtn) {
        clearBtn.addEventListener('click', function() {
            _searchQuery = '';
            resetSearchState('');
            if (searchInput) searchInput.value = '';
            hideSearchDropdown();
            renderCurrentNode();
        });
    }

    if (!_searchOutsideClickBound) {
        document.addEventListener('click', function(ev) {
            const target = ev.target;
            const searchWrap = document.querySelector('.tmx-search');
            if (!searchWrap || !target) return;
            if (!searchWrap.contains(target)) hideSearchDropdown();
        });
        _searchOutsideClickBound = true;
    }

    renderCurrentNode();
    syncTableHeadGutter();

    if (window && !window.__tmxGutterBound) {
        window.addEventListener('resize', syncTableHeadGutter);
        window.__tmxGutterBound = true;
    }
}

document.addEventListener('treemapLoaded', function(e) {
    const detail = e.detail || {};
    _diskId = detail.diskId || null;
    _rootNode = detail.root || null;
    _currentNode = null;
    _searchQuery = '';
    resetSearchState('');

    if (_searchDebounceTimer) {
        clearTimeout(_searchDebounceTimer);
        _searchDebounceTimer = null;
    }

    Object.keys(_pageCache).forEach(function(k) { delete _pageCache[k]; });
    Object.keys(_inflight).forEach(function(k) { delete _inflight[k]; });
    Object.keys(_searchPageCache).forEach(function(k) { delete _searchPageCache[k]; });
    Object.keys(_searchInflight).forEach(function(k) { delete _searchInflight[k]; });

    renderExplorer(_rootNode, detail);
});

export { renderExplorer };
