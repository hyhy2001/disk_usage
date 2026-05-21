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
        $total = (int)$stmt->fetchColumn();

        $stmt = $pdo->prepare(
            'SELECT d.id, n.name AS name, d.total_size, d.file_count, '
            . 'd.dir_count, d.owner_uid, d.has_files '
            . 'FROM dirs d JOIN names n ON d.name_id = n.id '
            . 'WHERE d.parent_id = ? '
            . 'ORDER BY d.total_size DESC '
            . 'LIMIT ? OFFSET ?'
        );
        $stmt->execute(array((int)$parent_id, (int)$limit, (int)$offset));
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Exception $e) {
        return array('items' => array(), 'total' => 0, 'has_more' => false, 'source' => 'sqlite_error');
    }
    $items = array();
    if ($node_type !== 'file') {
        foreach ($rows as $r) {
            $items[] = api_treemap_row_to_item($pdo, $r, $parent_id);
        }
    }
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

    $sql = 'SELECT d.id, n.name AS name, d.total_size, d.file_count, '
        . 'd.dir_count, d.owner_uid, d.has_files, d.parent_id '
        . 'FROM dirs d JOIN names n ON d.name_id = n.id '
        . 'WHERE ' . $name_clause . ' '
        . 'ORDER BY d.total_size DESC '
        . 'LIMIT ? OFFSET ?';
    $bind_full = $bind;
    $bind_full[] = (int)$limit;
    $bind_full[] = (int)$offset;
    try {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($bind_full);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $count_sql = 'SELECT COUNT(*) FROM dirs d JOIN names n ON d.name_id = n.id '
            . 'WHERE ' . $name_clause;
        $stmt = $pdo->prepare($count_sql);
        $stmt->execute($bind);
        $total = (int)$stmt->fetchColumn();
    } catch (Exception $e) {
        b64_success(array('items' => array(), 'total' => 0, 'has_more' => false, 'source' => 'search_error'));
    }

    $items = array();
    if ($node_type !== 'file') {
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
