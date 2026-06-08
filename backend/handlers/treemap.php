<?php
// Treemap handler — SQLite-backed (treemap.db).
// Replaces NDJSON shard reader. shard_id in API is now the dir_id (decimal),
// preserved as string in JSON for frontend compatibility.

function api_treemap_open_db($disk_path) {
    return api_db_open_treemap($disk_path);
}

function api_treemap_meta($pdo, $key) {
    static $cache = array();
    $oid = spl_object_hash($pdo);
    if (!isset($cache[$oid])) {
        $cache[$oid] = array();
        try {
            foreach ($pdo->query('SELECT key, value FROM meta')->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $cache[$oid][(string)$r['key']] = (string)$r['value'];
            }
        } catch (Exception $e) {}
    }
    return isset($cache[$oid][$key]) ? $cache[$oid][$key] : '';
}

function api_treemap_owner_lookup($pdo, $uid) {
    static $cache = array();
    $oid = spl_object_hash($pdo);
    if (!isset($cache[$oid])) {
        $cache[$oid] = array();
        try {
            foreach ($pdo->query('SELECT uid, username FROM owners')->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $cache[$oid][(int)$r['uid']] = (string)$r['username'];
            }
        } catch (Exception $e) {}
    }
    $key = (int)$uid;
    return isset($cache[$oid][$key]) ? $cache[$oid][$key] : '';
}

function api_treemap_full_path($pdo, $dir_id) {
    return api_path_for($pdo, $dir_id, '');
}

function api_treemap_row_to_item($pdo, $r, $parent_dir_id = null) {
    $dir_id = (int)$r['id'];
    $name = (string)$r['name'];
    if ($name === '/' && $dir_id !== 0) $name = '';
    $owner = api_treemap_owner_lookup($pdo, (int)$r['owner_uid']);
    $value = (float)$r['total_size'];
    $path = api_treemap_full_path($pdo, $dir_id);
    return array(
        'name' => $name === '' ? $path : $name,
        'path' => $path,
        'owner' => $owner,
        'value' => $value,
        'size' => $value,
        'type' => 'directory',
        'shard_id' => (string)$dir_id,
        'parent_shard_id' => $parent_dir_id === null ? '' : (string)$parent_dir_id,
        'has_children' => ((int)$r['dir_count'] > 0) || ((int)$r['has_files'] === 1),
    );
}

function api_treemap_make_root($pdo) {
    try {
        $stmt = $pdo->prepare(
            'SELECT d.id, n.name AS name, d.total_size, d.file_count, '
            . 'd.dir_count, d.owner_uid, d.has_files '
            . 'FROM dirs d JOIN names n ON d.name_id = n.id '
            . 'WHERE d.parent_id IS NULL LIMIT 1'
        );
        $stmt->execute();
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
    } catch (Exception $e) {
        return null;
    }
    if (!$row) return null;
    $item = api_treemap_row_to_item($pdo, $row, null);
    $item['parent_shard_id'] = '';
    $item['children'] = array();
    return $item;
}

function api_treemap_children($pdo, $parent_id, $node_type, $offset, $limit) {
    try {
        $stmt = $pdo->prepare(
            'SELECT COUNT(*) FROM dirs WHERE parent_id = ?'
        );
        $stmt->execute(array((int)$parent_id));
        $dir_total = (int)$stmt->fetchColumn();

        // Parent metadata for the synthetic [files] pseudo-node.
        $stmt = $pdo->prepare(
            'SELECT total_size, file_count, has_files, owner_uid '
            . 'FROM dirs WHERE id = ? LIMIT 1'
        );
        $stmt->execute(array((int)$parent_id));
        $parent_row = $stmt->fetch(PDO::FETCH_ASSOC);

        // Sum of direct sub-dir totals (across all pages) — needed to compute
        // files-in-this-dir = parent.total - sum(child dirs).
        $stmt = $pdo->prepare(
            'SELECT COALESCE(SUM(total_size), 0) FROM dirs WHERE parent_id = ?'
        );
        $stmt->execute(array((int)$parent_id));
        $sum_child_dirs = (int)$stmt->fetchColumn();

        // Decide whether the synthetic [files] node belongs in this listing.
        $has_files_node = false;
        $files_size = 0;
        $files_count = 0;
        $files_owner_uid = 0;
        if ($parent_row && (int)$parent_row['has_files'] === 1 && $node_type !== 'dir') {
            $files_size = max(0, (int)$parent_row['total_size'] - $sum_child_dirs);
            $files_count = (int)$parent_row['file_count'];
            $files_owner_uid = (int)$parent_row['owner_uid'];
            if ($files_size > 0 || $files_count > 0) {
                $has_files_node = true;
            }
        }

        // Use UNION ALL so SQL sorts dirs + the synthetic row together by
        // total_size DESC. We tag rows with a `kind` column so PHP can tell
        // them apart after fetch.
        if ($has_files_node) {
            $stmt = $pdo->prepare(
                'SELECT * FROM ('
                . '  SELECT 0 AS kind, d.id AS id, n.name AS name, d.total_size AS total_size, '
                . '         d.file_count AS file_count, d.dir_count AS dir_count, '
                . '         d.owner_uid AS owner_uid, d.has_files AS has_files '
                . '  FROM dirs d JOIN names n ON d.name_id = n.id '
                . '  WHERE d.parent_id = ? '
                . '  UNION ALL '
                . '  SELECT 1 AS kind, NULL AS id, ? AS name, CAST(? AS INTEGER) AS total_size, '
                . '         CAST(? AS INTEGER) AS file_count, 0 AS dir_count, '
                . '         CAST(? AS INTEGER) AS owner_uid, 1 AS has_files'
                . ') ORDER BY total_size DESC LIMIT ? OFFSET ?'
            );
            $stmt->execute(array(
                (int)$parent_id,
                '[files]',
                (int)$files_size,
                (int)$files_count,
                (int)$files_owner_uid,
                (int)$limit,
                (int)$offset,
            ));
        } else {
            $stmt = $pdo->prepare(
                'SELECT 0 AS kind, d.id AS id, n.name AS name, d.total_size, '
                . 'd.file_count, d.dir_count, d.owner_uid, d.has_files '
                . 'FROM dirs d JOIN names n ON d.name_id = n.id '
                . 'WHERE d.parent_id = ? '
                . 'ORDER BY d.total_size DESC LIMIT ? OFFSET ?'
            );
            $stmt->execute(array((int)$parent_id, (int)$limit, (int)$offset));
        }
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Exception $e) {
        return array('items' => array(), 'total' => 0, 'has_more' => false, 'source' => 'sqlite_error');
    }

    // Pre-resolve all dir paths in ONE batched walk (avoids per-row N+1:
    // api_treemap_row_to_item → api_path_for would otherwise call
    // api_path_resolve_batch with a single id per row). Populates the shared
    // per-PDO path cache so each row's api_path_for hits cache (O(1)).
    $path_ids = array();
    foreach ($rows as $r) {
        if ((int)$r['kind'] !== 1) $path_ids[] = (int)$r['id'];
    }
    if (!empty($path_ids)) api_path_resolve_batch($pdo, $path_ids, '');

    $items = array();
    if ($node_type !== 'file') {
        foreach ($rows as $r) {
            if ((int)$r['kind'] === 1) {
                // Synthetic [files] pseudo-node.
                $owner = api_treemap_owner_lookup($pdo, (int)$r['owner_uid']);
                $items[] = array(
                    'name' => '[files]',
                    'path' => '',
                    'owner' => $owner,
                    'value' => (int)$r['total_size'],
                    'size' => (int)$r['total_size'],
                    'type' => 'file_group',
                    'shard_id' => '',
                    'parent_shard_id' => (string)$parent_id,
                    'has_children' => false,
                    'file_count' => (int)$r['file_count'],
                );
            } else {
                $items[] = api_treemap_row_to_item($pdo, $r, $parent_id);
            }
        }
    }

    $total = $dir_total + ($has_files_node ? 1 : 0);
    $has_more = ($offset + count($items)) < $total;
    return array('items' => $items, 'total' => $total, 'has_more' => $has_more, 'source' => 'sqlite');
}


function api_handle_treemap($disk_path) {
    $shard_id = trim(param('shard_id', ''));
    $offset = get_int('offset', 0, 0, PHP_INT_MAX);
    $limit = get_int('limit', 120, 1, 500);
    $node_type = strtolower(trim(param('node_type', 'all')));
    if ($node_type !== 'dir' && $node_type !== 'file') $node_type = 'all';

    $pdo = api_treemap_open_db($disk_path);
    if (!$pdo) {
        b64_success(array('root' => null, 'items' => array(), 'total' => 0, 'has_more' => false, 'source' => 'none'));
    }

    $root = api_treemap_make_root($pdo);
    if (!$root) {
        b64_success(array('root' => null, 'items' => array(), 'total' => 0, 'has_more' => false, 'source' => 'invalid'));
    }

    // Override root name/path with the full filesystem scan_root from meta
    // so the breadcrumb and root tile show /full/path instead of just basename.
    $scan_root = api_treemap_meta($pdo, 'scan_root');
    if ($scan_root !== '') {
        $root['name'] = $scan_root;
        $root['path'] = $scan_root;
    }

    if ($shard_id === '' || $shard_id === $root['shard_id']) {
        $children = api_treemap_children($pdo, (int)$root['shard_id'], $node_type, $offset, $limit);
        $children['root'] = $root;
        b64_success($children);
    }

    if (!ctype_digit($shard_id)) {
        b64_success(array('root' => $root, 'items' => array(), 'total' => 0, 'has_more' => false, 'source' => 'invalid_shard'));
    }
    $children = api_treemap_children($pdo, (int)$shard_id, $node_type, $offset, $limit);
    b64_success($children);
}

function api_handle_treemap_search($disk_path) {
    $offset = get_int('offset', 0, 0, PHP_INT_MAX);
    $limit = get_int('limit', 120, 1, 500);
    $node_type = strtolower(trim(param('node_type', 'all')));
    if ($node_type !== 'dir' && $node_type !== 'file') $node_type = 'all';
    $q = trim(param('q', ''));
    if ($q === '') {
        b64_success(array('items' => array(), 'total' => 0, 'has_more' => false, 'source' => 'search'));
    }

    $pdo = api_treemap_open_db($disk_path);
    if (!$pdo) {
        b64_success(array('items' => array(), 'total' => 0, 'has_more' => false, 'source' => 'none'));
    }

    // Search ranks dirs by total_size DESC. We post-filter by full path
    // because path is reconstructed via recursive CTE per row. Cap inspection
    // to a generous LIMIT to keep response time bounded for huge trees.
    $tokens = api_keyword_tokens($q);
    if (!$tokens) {
        b64_success(array('items' => array(), 'total' => 0, 'has_more' => false, 'source' => 'search'));
    }
    $bind = array();
    $like_clause = api_keyword_like_clause('n.name', $tokens, $bind);
    if ($like_clause === '') {
        b64_success(array('items' => array(), 'total' => 0, 'has_more' => false, 'source' => 'search'));
    }
    // api_keyword_like_clause already wraps in (...); strip outer parens to inline in WHERE
    $name_clause = substr($like_clause, 1, -1);

    // Optional descendant filter
    $under_raw = trim((string)param('under', ''));
    $under_id = ctype_digit($under_raw) ? (int)$under_raw : -1;
    $under_clause = '';
    $under_bind = array();
    if ($under_id >= 0) {
        $under_clause = ' AND d.id IN (WITH RECURSIVE sub(id) AS ('
            . 'SELECT id FROM dirs WHERE parent_id = ? '
            . 'UNION ALL '
            . 'SELECT dirs.id FROM dirs JOIN sub ON dirs.parent_id = sub.id'
            . ') SELECT id FROM sub) ';
        $under_bind[] = $under_id;
    }

    $sql = 'SELECT d.id, n.name AS name, d.total_size, d.file_count, '
        . 'd.dir_count, d.owner_uid, d.has_files, d.parent_id '
        . 'FROM dirs d JOIN names n ON d.name_id = n.id '
        . 'WHERE (' . $name_clause . ')' . $under_clause
        . 'ORDER BY d.total_size DESC '
        . 'LIMIT ? OFFSET ?';
    $bind_full = array_merge($bind, $under_bind);
    $bind_full[] = (int)$limit;
    $bind_full[] = (int)$offset;
    try {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($bind_full);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $count_sql = 'SELECT COUNT(*) FROM dirs d JOIN names n ON d.name_id = n.id '
            . 'WHERE (' . $name_clause . ')' . $under_clause;
        $count_bind = array_merge($bind, $under_bind);
        $stmt = $pdo->prepare($count_sql);
        $stmt->execute($count_bind);
        $total = (int)$stmt->fetchColumn();
    } catch (Exception $e) {
        b64_success(array('items' => array(), 'total' => 0, 'has_more' => false, 'source' => 'search_error'));
    }

    $items = array();
    if ($node_type !== 'file') {
        // Pre-resolve all paths in one batched walk (avoids per-row N+1).
        $path_ids = array();
        foreach ($rows as $r) $path_ids[] = (int)$r['id'];
        if (!empty($path_ids)) api_path_resolve_batch($pdo, $path_ids, '');

        foreach ($rows as $r) {
            $parent_id = $r['parent_id'] === null ? '' : (string)$r['parent_id'];
            $item = api_treemap_row_to_item($pdo, $r);
            $item['parent_shard_id'] = $parent_id;
            $items[] = $item;
        }
    }
    b64_success(array(
        'items' => $items,
        'total' => $total,
        'has_more' => ($offset + count($items)) < $total,
        'source' => 'sqlite_search',
    ));
}
