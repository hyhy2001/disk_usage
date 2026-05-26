<?php
// Per-user file/dir detail — reads SQLite (data_detail.db + treemap.db).
// Replaces NDJSON-based reader; PHP query_cli external binary deprecated.

function api_detail_open_db($disk_path) {
    return api_db_open_detail($disk_path);
}

function api_detail_meta($pdo, $key) {
    static $cache = array();
    $oid = spl_object_hash($pdo);
    if (!isset($cache[$oid])) {
        $cache[$oid] = array();
        try {
            $rows = $pdo->query('SELECT key, value FROM meta')->fetchAll(PDO::FETCH_ASSOC);
            foreach ($rows as $r) $cache[$oid][(string)$r['key']] = (string)$r['value'];
        } catch (Exception $e) {}
    }
    return isset($cache[$oid][$key]) ? $cache[$oid][$key] : '';
}

function api_detail_user_row($pdo, $username) {
    static $cache = array();
    $oid = spl_object_hash($pdo);
    $key = $oid . ':' . $username;
    if (array_key_exists($key, $cache)) return $cache[$key];
    try {
        $stmt = $pdo->prepare(
            'SELECT uid, username, team_id, total_files, total_dirs, total_size '
            . 'FROM users WHERE username = ?'
        );
        $stmt->execute(array($username));
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
    } catch (Exception $e) {
        $row = false;
    }
    return $cache[$key] = $row ? $row : false;
}


function api_detail_filters($is_file) {
    return array(
        'q' => strtolower(trim(param('filter_query', ''))),
        'ext' => $is_file ? strtolower(trim(param('filter_ext', ''))) : '',
        'min' => get_int('filter_min_size', 0, 0, PHP_INT_MAX),
        'max' => get_int('filter_max_size', 0, 0, PHP_INT_MAX),
    );
}

function api_detail_keyword_clause($column, $q, &$bind) {
    return api_keyword_like_clause($column, api_keyword_tokens($q), $bind);
}

// Cursor helpers: URL-safe base64(JSON)
function api_detail_encode_cursor($obj) {
    $json = json_encode($obj);
    if (!is_string($json)) return '';
    return strtr(rtrim(base64_encode($json), '='), '+/', '-_');
}

function api_detail_decode_cursor($raw) {
    if (!is_string($raw) || $raw === '') return null;
    $b64 = strtr($raw, '-_', '+/');
    $pad = strlen($b64) % 4;
    if ($pad) $b64 .= str_repeat('=', 4 - $pad);
    $json = base64_decode($b64, true);
    if ($json === false) return null;
    $obj = json_decode($json, true);
    return is_array($obj) ? $obj : null;
}

// Directory rows: keyset pagination by (size DESC, id ASC)
function api_detail_dir_rows($pdo, $uid, $cursor, $limit, $filters) {
    $where = array('uid = ?');
    $bind = array((int)$uid);
    if ($filters['min'] > 0) { $where[] = 'size >= ?'; $bind[] = (int)$filters['min']; }
    if ($filters['max'] > 0) { $where[] = 'size <= ?'; $bind[] = (int)$filters['max']; }
    $where_sql = implode(' AND ', $where);
    $needle = $filters['q'];

    if ($needle === '') {
        try {
            $fetch_limit = (int)$limit + 1;

            // Keyset clause when cursor present
            if (is_array($cursor) && isset($cursor['size'], $cursor['id'])) {
                $where_sql .= ' AND (size < ? OR (size = ? AND id > ?))';
                $bind[] = (int)$cursor['size'];
                $bind[] = (int)$cursor['size'];
                $bind[] = (int)$cursor['id'];
            }

            $bind2 = $bind;
            $bind2[] = $fetch_limit;
            $stmt = $pdo->prepare(
                'SELECT id, path, size, files FROM dirs WHERE ' . $where_sql
                . ' ORDER BY size DESC, id ASC LIMIT ?'
            );
            $stmt->execute($bind2);
            $page = $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (Exception $e) {
            return array('rows' => array(), 'has_more' => false, 'next_cursor' => null);
        }

        $has_more = count($page) > $limit;
        if ($has_more) $page = array_slice($page, 0, (int)$limit);
        $rows = array();
        foreach ($page as $r) {
            $rows[] = array('path' => (string)$r['path'], 'used' => (int)$r['size'], 'files' => (int)$r['files']);
        }
        $next_cursor = null;
        if ($has_more) {
            $last = end($page);
            $next_cursor = api_detail_encode_cursor(array('size' => (int)$last['size'], 'id' => (int)$last['id']));
        }
        return array('rows' => $rows, 'has_more' => $has_more, 'next_cursor' => $next_cursor);
    }

    return api_detail_dir_rows_keyword($pdo, $uid, $cursor, $limit, $filters, $needle, $where_sql, $bind);
}

// Keyword search for dirs. LIKE-only (no FTS). Uses api_keyword_like_clause to build token clauses.
function api_detail_dir_rows_keyword($pdo, $uid, $cursor, $limit, $filters, $needle, $where_sql, $bind) {
    $tokens = api_detail_keyword_tokens($needle);
    if (empty($tokens)) {
        return api_detail_dir_rows($pdo, $uid, $cursor, $limit,
            array('q' => '', 'ext' => '', 'min' => $filters['min'], 'max' => $filters['max']));
    }

    $like_bind = array();
    $like_clause = api_keyword_like_clause('path', $tokens, $like_bind);
    if ($like_clause === '') {
        return array('rows' => array(), 'has_more' => false, 'next_cursor' => null);
    }
    $where_sql2 = $where_sql . ' AND (' . $like_clause . ')';
    $all_bind = array_merge($bind, $like_bind);

    try {
        $fetch_limit = (int)$limit + 1;
        // Keyset clause when cursor present
        if (is_array($cursor) && isset($cursor['size'], $cursor['id'])) {
            $where_sql2 .= ' AND (size < ? OR (size = ? AND id > ?))';
            $all_bind[] = (int)$cursor['size'];
            $all_bind[] = (int)$cursor['size'];
            $all_bind[] = (int)$cursor['id'];
        }
        $page_bind = array_merge($all_bind, array($fetch_limit));
        $stmt = $pdo->prepare(
            'SELECT id, path, size, files FROM dirs WHERE ' . $where_sql2
            . ' ORDER BY size DESC, id ASC LIMIT ?'
        );
        $stmt->execute($page_bind);
        $page = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Exception $e) {
        return array('rows' => array(), 'has_more' => false, 'next_cursor' => null);
    }

    $has_more = count($page) > $limit;
    if ($has_more) $page = array_slice($page, 0, (int)$limit);
    $rows = array();
    foreach ($page as $r) {
        $rows[] = array('path' => (string)$r['path'], 'used' => (int)$r['size'], 'files' => (int)$r['files']);
    }
    $next_cursor = null;
    if ($has_more) {
        $last = end($page);
        $next_cursor = api_detail_encode_cursor(array('size' => (int)$last['size'], 'id' => (int)$last['id']));
    }
    return array('rows' => $rows, 'has_more' => $has_more, 'next_cursor' => $next_cursor);
}


// File rows: keyset pagination by (f.size DESC, f.dir_id ASC, f.name_id ASC)
function api_detail_file_rows($pdo, $uid, $cursor, $limit, $filters) {
    $where = array('f.uid = ?');
    $bind = array((int)$uid);
    if ($filters['min'] > 0) { $where[] = 'f.size >= ?'; $bind[] = (int)$filters['min']; }
    if ($filters['max'] > 0) { $where[] = 'f.size <= ?'; $bind[] = (int)$filters['max']; }

    // Ext filter: TEXT inline, no ext_id lookup needed
    if ($filters['ext'] !== '') {
        $ext_list = array_filter(array_map('trim', explode(',', strtolower($filters['ext']))));
        if (!empty($ext_list)) {
            $place = implode(',', array_fill(0, count($ext_list), '?'));
            $where[] = 'f.ext IN (' . $place . ')';
            foreach ($ext_list as $e) $bind[] = $e;
        }
    }

    $where_sql = implode(' AND ', $where);
    $needle = $filters['q'];

    if ($needle !== '') {
        return api_detail_file_rows_keyword($pdo, $uid, $cursor, $limit, $filters, $needle, $where_sql, $bind);
    }

    try {
        $fetch_limit = (int)$limit + 1;

        // Keyset clause when cursor present
        if (is_array($cursor) && isset($cursor['size'], $cursor['dir_id'], $cursor['name_id'])) {
            $where_sql .= ' AND (f.size < ? OR (f.size = ? AND f.dir_id > ?) OR (f.size = ? AND f.dir_id = ? AND f.name_id > ?))';
            $bind[] = (int)$cursor['size'];
            $bind[] = (int)$cursor['size']; $bind[] = (int)$cursor['dir_id'];
            $bind[] = (int)$cursor['size']; $bind[] = (int)$cursor['dir_id']; $bind[] = (int)$cursor['name_id'];
        }

        $bind2 = $bind;
        $bind2[] = $fetch_limit;
        $stmt = $pdo->prepare(
            'SELECT f.dir_id, f.name_id, n.name AS basename, f.ext, f.size '
            . 'FROM files f JOIN file_names n ON f.name_id = n.id '
            . 'WHERE ' . $where_sql . ' ORDER BY f.size DESC, f.dir_id ASC, f.name_id ASC LIMIT ?'
        );
        $stmt->execute($bind2);
        $page = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Exception $e) {
        return array('rows' => array(), 'has_more' => false, 'next_cursor' => null);
    }

    $has_more = count($page) > $limit;
    if ($has_more) $page = array_slice($page, 0, (int)$limit);
    $rows = api_detail_format_files_page($pdo, $page);
    $next_cursor = null;
    if ($has_more) {
        $last = end($page);
        $next_cursor = api_detail_encode_cursor(array('size' => (int)$last['size'], 'dir_id' => (int)$last['dir_id'], 'name_id' => (int)$last['name_id']));
    }
    return array('rows' => $rows, 'has_more' => $has_more, 'next_cursor' => $next_cursor);
}

function api_detail_file_rows_keyword($pdo, $uid, $cursor, $limit, $filters,
                                       $needle, $where_sql, $bind) {
    $tokens = api_detail_keyword_tokens($needle);
    if (empty($tokens)) {
        return api_detail_file_rows($pdo, $uid, $cursor, $limit,
            array('q' => '', 'ext' => $filters['ext'], 'min' => $filters['min'], 'max' => $filters['max']));
    }

    $name_bind = array();
    $name_clause = api_keyword_like_clause('name', $tokens, $name_bind);
    if ($name_clause === '') return array('rows' => array(), 'has_more' => false, 'next_cursor' => null);
    $name_subq = '(SELECT id FROM file_names WHERE ' . $name_clause . ')';
    $where_sql2 = $where_sql . ' AND f.name_id IN ' . $name_subq;
    $all_bind = array_merge($bind, $name_bind);

    try {
        $fetch_limit = (int)$limit + 1;

        // Keyset clause when cursor present
        if (is_array($cursor) && isset($cursor['size'], $cursor['dir_id'], $cursor['name_id'])) {
            $where_sql2 .= ' AND (f.size < ? OR (f.size = ? AND f.dir_id > ?) OR (f.size = ? AND f.dir_id = ? AND f.name_id > ?))';
            $all_bind[] = (int)$cursor['size'];
            $all_bind[] = (int)$cursor['size']; $all_bind[] = (int)$cursor['dir_id'];
            $all_bind[] = (int)$cursor['size']; $all_bind[] = (int)$cursor['dir_id']; $all_bind[] = (int)$cursor['name_id'];
        }

        $page_bind = array_merge($all_bind, array($fetch_limit));
        $stmt = $pdo->prepare(
            'SELECT f.dir_id, f.name_id, n.name AS basename, f.ext, f.size '
            . 'FROM files f JOIN file_names n ON f.name_id = n.id '
            . 'WHERE ' . $where_sql2 . ' ORDER BY f.size DESC, f.dir_id ASC, f.name_id ASC LIMIT ?'
        );
        $stmt->execute($page_bind);
        $page = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Exception $e) {
        return array('rows' => array(), 'has_more' => false, 'next_cursor' => null);
    }

    $has_more = count($page) > $limit;
    if ($has_more) $page = array_slice($page, 0, (int)$limit);
    $rows = api_detail_format_files_page($pdo, $page);
    $next_cursor = null;
    if ($has_more) {
        $last = end($page);
        $next_cursor = api_detail_encode_cursor(array('size' => (int)$last['size'], 'dir_id' => (int)$last['dir_id'], 'name_id' => (int)$last['name_id']));
    }
    return array('rows' => $rows, 'has_more' => $has_more, 'next_cursor' => $next_cursor);
}


function api_detail_format_files_page($pdo, $page) {
    if (empty($page)) {
        return array();
    }
    // Batch resolve dir_id → path from dirs table.
    // Chunk to 500 to stay well under SQLite's 32766 binding limit.
    $dir_ids = array_values(array_unique(array_map(function($r) { return (int)$r['dir_id']; }, $page)));
    $path_map = array();
    if (!empty($dir_ids)) {
        foreach (array_chunk($dir_ids, 500) as $chunk) {
            $place = implode(',', array_fill(0, count($chunk), '?'));
            try {
                $stmt = $pdo->prepare('SELECT DISTINCT id, path FROM dirs WHERE id IN (' . $place . ')');
                $stmt->execute($chunk);
                foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
                    $path_map[(int)$r['id']] = (string)$r['path'];
                }
            } catch (Exception $e) {}
        }
    }
    $rows = array();
    foreach ($page as $r) {
        $dir_id = (int)$r['dir_id'];
        $parent = isset($path_map[$dir_id]) ? $path_map[$dir_id] : '';
        $base = (string)$r['basename'];
        $path = $parent === '/' ? '/' . $base : ($parent === '' ? $base : $parent . '/' . $base);
        $rows[] = array('path' => $path, 'size' => (int)$r['size'], 'xt' => (string)$r['ext']);
    }
    return $rows;
}


// Tokenize keyword query the same way api_keyword_match_path does.
function api_detail_keyword_tokens($q) {
    return api_keyword_tokens($q);
}

function api_detail_keyword_match($path, $q) {
    return api_keyword_match_path($path, $q);
}

function api_detail_empty_dir($who, $limit) {
    return array(
        'date' => 0, 'user' => $who, 'total_dirs_full' => 0,
        'scan_root' => '',
        'total_used' => 0, 'limit' => $limit,
        'has_more' => false, 'next_cursor' => null, 'dirs' => array(),
    );
}

function api_detail_empty_file($who, $limit) {
    return array(
        'date' => 0, 'user' => $who, 'total_files_full' => 0,
        'scan_root' => '',
        'total_used' => 0, 'limit' => $limit,
        'has_more' => false, 'next_cursor' => null, 'files' => array(),
    );
}

function api_handle_dirs($disk_path) {
    $who = sanitize_name(get_b64_param('user', ''));
    $cursor_raw = (string)param('cursor', '');
    $cursor = $cursor_raw !== '' ? api_detail_decode_cursor($cursor_raw) : null;
    $limit = get_int('limit', 500, 1, 50000);

    $pdo = api_detail_open_db($disk_path);
    if (!$pdo) {
        b64_success(array('dir' => api_detail_empty_dir($who, $limit)));
    }
    $user = api_detail_user_row($pdo, $who);
    if (!$user) {
        b64_success(array('dir' => api_detail_empty_dir($who, $limit)));
    }

    $result = api_detail_dir_rows($pdo, (int)$user['uid'], $cursor, $limit, api_detail_filters(false));
    $payload = array(
        'date' => (int)api_detail_meta($pdo, 'scan_timestamp'),
        'scan_root' => api_detail_meta($pdo, 'scan_root'),
        'user' => $who,
        'total_dirs_full' => (int)$user['total_dirs'],
        'total_used' => (int)$user['total_size'],
        'limit' => $limit,
        'has_more' => !empty($result['has_more']),
        'next_cursor' => isset($result['next_cursor']) ? $result['next_cursor'] : null,
        'dirs' => $result['rows'],
    );
    b64_success(array('dir' => $payload));
}

function api_handle_files($disk_path) {
    $who = sanitize_name(get_b64_param('user', ''));
    $cursor_raw = (string)param('cursor', '');
    $cursor = $cursor_raw !== '' ? api_detail_decode_cursor($cursor_raw) : null;
    $limit = get_int('limit', 500, 1, 50000);

    $pdo = api_detail_open_db($disk_path);
    if (!$pdo) {
        b64_success(array('file' => api_detail_empty_file($who, $limit)));
    }
    $user = api_detail_user_row($pdo, $who);
    if (!$user) {
        b64_success(array('file' => api_detail_empty_file($who, $limit)));
    }

    $result = api_detail_file_rows($pdo, (int)$user['uid'], $cursor, $limit, api_detail_filters(true));
    $payload = array(
        'date' => (int)api_detail_meta($pdo, 'scan_timestamp'),
        'scan_root' => api_detail_meta($pdo, 'scan_root'),
        'user' => $who,
        'total_files_full' => (int)$user['total_files'],
        'total_used' => (int)$user['total_size'],
        'limit' => $limit,
        'has_more' => !empty($result['has_more']),
        'next_cursor' => isset($result['next_cursor']) ? $result['next_cursor'] : null,
        'files' => $result['rows'],
    );
    b64_success(array('file' => $payload));
}

function api_handle_detail($disk_path) {
    $who = sanitize_name(get_b64_param('user', ''));
    $dir_cursor_raw = (string)param('dir_cursor', '');
    $file_cursor_raw = (string)param('file_cursor', '');
    $dir_cursor = $dir_cursor_raw !== '' ? api_detail_decode_cursor($dir_cursor_raw) : null;
    $file_cursor = $file_cursor_raw !== '' ? api_detail_decode_cursor($file_cursor_raw) : null;
    $limit = get_int('limit', 500, 1, 50000);
    $node_type = strtolower(trim(param('node_type', 'all')));
    if ($node_type !== 'dir' && $node_type !== 'file') $node_type = 'all';

    $pdo = api_detail_open_db($disk_path);
    if (!$pdo) {
        b64_success(array(
            'dir' => api_detail_empty_dir($who, $limit),
            'file' => api_detail_empty_file($who, $limit),
        ));
    }
    $user = api_detail_user_row($pdo, $who);
    if (!$user) {
        b64_success(array(
            'dir' => api_detail_empty_dir($who, $limit),
            'file' => api_detail_empty_file($who, $limit),
        ));
    }
    $scan_ts = (int)api_detail_meta($pdo, 'scan_timestamp');
    $uid = (int)$user['uid'];

    $dir = api_detail_empty_dir($who, $limit);
    if ($node_type !== 'file') {
        $dr = api_detail_dir_rows($pdo, $uid, $dir_cursor, $limit, api_detail_filters(false));
        $dir = array(
            'date' => $scan_ts, 'user' => $who,
            'scan_root' => api_detail_meta($pdo, 'scan_root'),
            'total_dirs_full' => (int)$user['total_dirs'],
            'total_used' => (int)$user['total_size'],
            'limit' => $limit,
            'has_more' => !empty($dr['has_more']),
            'next_cursor' => isset($dr['next_cursor']) ? $dr['next_cursor'] : null,
            'dirs' => $dr['rows'],
        );
    }
    $file = api_detail_empty_file($who, $limit);
    if ($node_type !== 'dir') {
        $fr = api_detail_file_rows($pdo, $uid, $file_cursor, $limit, api_detail_filters(true));
        $file = array(
            'date' => $scan_ts, 'user' => $who,
            'scan_root' => api_detail_meta($pdo, 'scan_root'),
            'total_files_full' => (int)$user['total_files'],
            'total_used' => (int)$user['total_size'],
            'limit' => $limit,
            'has_more' => !empty($fr['has_more']),
            'next_cursor' => isset($fr['next_cursor']) ? $fr['next_cursor'] : null,
            'files' => $fr['rows'],
        );
    }

    b64_success(array('dir' => $dir, 'file' => $file));
}
