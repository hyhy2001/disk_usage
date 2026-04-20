import { showToast } from './main.js';
import { fmt } from './formatters.js';

let _diskId = null;
let _rootNode = null;
let _currentNode = null;
let _searchQuery = '';
let _searchRenderToken = 0;
let _searchDebounceTimer = null;

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

function renderList(node) {
    const list = document.getElementById('tmx-list');
    if (!list) return;

    const st = getNodeState(node);
    list.innerHTML = '';

    if (st.children.length === 0 && !st.hasMore) {
        list.innerHTML = '<div class="tmx-empty">No child nodes.</div>';
        return;
    }

    st.children.forEach(function(child) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tmx-item';

        const icon = (child.type === 'file_group' || child.type === 'file') ? '📄' : '📁';

        btn.innerHTML =
            '<span class="tmx-item-folder">' +
                '<span class="tmx-item-icon">' + icon + '</span>' +
                '<span class="tmx-item-main">' +
                '<span class="tmx-item-name">' + escHtml(child.name || child.path || 'node') + '</span>' +
                '</span>' +
            '</span>' +
            '<span class="tmx-item-owner">' + escHtml(child.owner || '-') + '</span>' +
            '<span class="tmx-item-size">' + escHtml(fmt(child.value || 0)) + '</span>' +
            '<span class="tmx-item-type">' + escHtml(getNodeTypeLabel(child)) + '</span>';

        btn.addEventListener('click', function() {
            if (child.has_children || child.shard_id) {
                _currentNode = child;
                renderCurrentNode();
            } else {
                setMeta(child, st.source || 'index');
            }
        });

        list.appendChild(btn);
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
        list.appendChild(moreWrap);
    }

    syncTableHeadGutter();
}

function renderGlobalSearchList() {
    const list = document.getElementById('tmx-list');
    if (!list) return;

    list.innerHTML = '';

    if (_searchState.items.length === 0 && !_searchState.hasMore) {
        list.innerHTML = '<div class="tmx-empty">No global match found.</div>';
        return;
    }

    _searchState.items.forEach(function(hit) {
        const node = mapSearchHitToNode(hit);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tmx-item';

        const icon = (node.type === 'file_group' || node.type === 'file') ? '📄' : '📁';

        btn.innerHTML =
            '<span class="tmx-item-folder">' +
                '<span class="tmx-item-icon">' + icon + '</span>' +
                '<span class="tmx-item-main">' +
                '<span class="tmx-item-name">' + escHtml(node.name || node.path || 'node') + '</span>' +
                '</span>' +
            '</span>' +
            '<span class="tmx-item-owner">' + escHtml(node.owner || '-') + '</span>' +
            '<span class="tmx-item-size">' + escHtml(fmt(node.value || 0)) + '</span>' +
            '<span class="tmx-item-type">' + escHtml(getNodeTypeLabel(node)) + '</span>';

        btn.addEventListener('click', function() {
            if (node.has_children || node.shard_id) {
                _searchQuery = '';
                resetSearchState('');
                const input = document.getElementById('tmx-search-input');
                if (input) input.value = '';
                _currentNode = node;
                renderCurrentNode();
            } else {
                setMeta(node, _searchState.source || 'global_search');
            }
        });

        list.appendChild(btn);
    });

    if (_searchState.hasMore) {
        const moreWrap = document.createElement('div');
        moreWrap.className = 'tmx-load-more';
        const moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'user-bar-btn';
        moreBtn.textContent = _searchState.loading ? 'Loading...' : 'Load more results';
        moreBtn.disabled = _searchState.loading;
        moreBtn.addEventListener('click', async function() {
            moreBtn.disabled = true;
            moreBtn.textContent = 'Loading...';
            await loadMoreGlobalSearch();
            renderGlobalSearchList();
            const titleEl = document.getElementById('tmx-current-title');
            if (titleEl) {
                titleEl.textContent = 'Global search "' + _searchState.q + '" (' + _searchState.items.length + '/' + _searchState.total + ')';
            }
        });
        moreWrap.appendChild(moreBtn);
        list.appendChild(moreWrap);
    }

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
            searchTitleEl.textContent = 'Global search "' + query + '" (' + _searchState.items.length + '/' + _searchState.total + ')';
        }

        renderGlobalSearchList();
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
                    '<button class="user-bar-btn" id="tm-back-btn">← Back</button>' +
                    '<button class="user-bar-btn" id="tm-root-btn">Root</button>' +
                '</div>' +
                '<div class="treemap-toolbar-right"><span class="treemap-meta" id="tm-meta"></span></div>' +
            '</div>' +
            '<div class="glass-panel tmx-wrap">' +
                '<div class="tmx-breadcrumb" id="tmx-breadcrumb"></div>' +
                '<div class="tmx-search">' +
                    '<input id="tmx-search-input" class="tmx-search-input" type="text" placeholder="Global search path/name..." autocomplete="off" />' +
                    '<button type="button" id="tmx-search-clear" class="tmx-search-clear">Clear</button>' +
                '</div>' +
                '<div class="tmx-current-title" id="tmx-current-title"></div>' +
                '<div class="tmx-table-head">' +
                    '<span class="tmx-col-name">Folder</span>' +
                    '<span class="tmx-col-owner">Owner</span>' +
                    '<span class="tmx-col-size">Size</span>' +
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
    }

    const clearBtn = document.getElementById('tmx-search-clear');
    if (clearBtn) {
        clearBtn.addEventListener('click', function() {
            _searchQuery = '';
            resetSearchState('');
            if (searchInput) searchInput.value = '';
            renderCurrentNode();
        });
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
