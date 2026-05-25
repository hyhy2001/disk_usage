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

function api_detail_dir_rows($pdo, $uid, $offset, $limit, $filters) {
    $where = array('uid = ?');
    $bind = array((int)$uid);
    if ($filters['min'] > 0) { $where[] = 'size >= ?'; $bind[] = (int)$filters['min']; }
    if ($filters['max'] > 0) { $where[] = 'size <= ?'; $bind[] = (int)$filters['max']; }
    $where_sql = implode(' AND ', $where);
    $needle = $filters['q'];

    if ($needle === '') {
        $approx = (int)param('approx_total', 0) === 1;
        try {
            $total = -1;
            $is_export = (int)param('export_stream', 0) === 1;
            $reverse = false;
            $sql_offset = (int)$offset;
            $fetch_limit = (int)$limit;

            if (!$approx) {
                $stmt = $pdo->prepare('SELECT COUNT(*) FROM dirs WHERE ' . $where_sql);
                $stmt->execute($bind);
                $total = (int)$stmt->fetchColumn();
                if (!$is_export && $total > 0 && $offset + $limit > $total / 2) {
                    $sql_offset = max(0, $total - $offset - $limit);
                    $reverse = true;
                }
            } else {
                $fetch_limit = (int)$limit + 1;
            }

            $bind2 = $bind;
            $bind2[] = $fetch_limit;
            $bind2[] = $sql_offset;
            $order = $reverse ? 'ASC' : 'DESC';
            $stmt = $pdo->prepare(
                'SELECT id, path, size, files FROM dirs WHERE ' . $where_sql
                . ' ORDER BY size ' . $order . ' LIMIT ? OFFSET ?'
            );
            $stmt->execute($bind2);
            $page = $stmt->fetchAll(PDO::FETCH_ASSOC);
            if ($reverse) $page = array_reverse($page);
        } catch (Exception $e) {
            return array('rows' => array(), 'total' => 0, 'has_more' => false);
        }

        $has_more = false;
        if ($approx && count($page) > $limit) {
            $has_more = true;
            $page = array_slice($page, 0, (int)$limit);
        }

        $rows = array();
        foreach ($page as $r) {
            $rows[] = array('path' => (string)$r['path'], 'used' => (int)$r['size'], 'files' => (int)$r['files']);
        }
        if (!$approx) $has_more = ($offset + count($rows)) < $total;
        return array('rows' => $rows, 'total' => $approx ? -1 : $total, 'has_more' => $has_more);
    }

    return api_detail_dir_rows_keyword($pdo, $uid, $offset, $limit, $filters, $needle, $where_sql, $bind);
}

// Keyword search for dirs. Fast path pushes the name LIKE subquery + LIMIT/OFFSET
// down to SQL (basename-only match). Falls back to streaming when tokens
// normalise to nothing usable (rare).
function api_detail_dir_rows_keyword($pdo, $uid, $offset, $limit, $filters, $needle, $where_sql, $bind) {
    $tokens = api_detail_keyword_tokens($needle);
    if (empty($tokens)) {
        return api_detail_dir_rows($pdo, $uid, $offset, $limit,
            array('q' => '', 'ext' => '', 'min' => $filters['min'], 'max' => $filters['max']));
    }

    // Try FTS4 first (fast path)
    $dir_tokens = api_keyword_fts_dir_tokens($needle);
    $fts_info = api_keyword_fts_match($dir_tokens);
    $approx = (int)param('approx_total', 0) === 1;

    if (!$fts_info['needs_like'] && $fts_info['match'] !== '') {
        // FTS path: id IN (SELECT rowid FROM fts_dir_paths WHERE MATCH ?)
        $fts_where = $where_sql . ' AND id IN (SELECT rowid FROM fts_dir_paths WHERE fts_dir_paths MATCH ?)';
        $fts_bind = array_merge($bind, array($fts_info['match']));
        try {
            $total = -1;
            $fetch_limit = (int)$limit;
            if (!$approx) {
                $stmt = $pdo->prepare('SELECT COUNT(*) FROM dirs WHERE ' . $fts_where);
                $stmt->execute($fts_bind);
                $total = (int)$stmt->fetchColumn();
                if ($total === 0) return array('rows' => array(), 'total' => 0, 'has_more' => false);
            } else {
                $fetch_limit = (int)$limit + 1;
            }
            $page_bind = array_merge($fts_bind, array($fetch_limit, (int)$offset));
            $stmt = $pdo->prepare(
                'SELECT id, path, size, files FROM dirs WHERE ' . $fts_where
                . ' ORDER BY size DESC LIMIT ? OFFSET ?'
            );
            $stmt->execute($page_bind);
            $page = $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (Exception $e) {
            // FTS failed → fall through to LIKE
            $fts_info['needs_like'] = true;
        }
    }

    if ($fts_info['needs_like'] || $fts_info['match'] === '') {
        // LIKE fallback: path LIKE '%needle%'
        $like_val = '%' . str_replace(array('%', '_'), array('\%', '\_'), $needle) . '%';
        $like_where = $where_sql . ' AND path LIKE ? ESCAPE \'\\\'';
        $like_bind = array_merge($bind, array($like_val));
        try {
            $total = -1;
            $fetch_limit = (int)$limit;
            if (!$approx) {
                $stmt = $pdo->prepare('SELECT COUNT(*) FROM dirs WHERE ' . $like_where);
                $stmt->execute($like_bind);
                $total = (int)$stmt->fetchColumn();
                if ($total === 0) return array('rows' => array(), 'total' => 0, 'has_more' => false);
            } else {
                $fetch_limit = (int)$limit + 1;
            }
            $page_bind = array_merge($like_bind, array($fetch_limit, (int)$offset));
            $stmt = $pdo->prepare(
                'SELECT id, path, size, files FROM dirs WHERE ' . $like_where
                . ' ORDER BY size DESC LIMIT ? OFFSET ?'
            );
            $stmt->execute($page_bind);
            $page = $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (Exception $e) {
            return array('rows' => array(), 'total' => 0, 'has_more' => false);
        }
    }

    $has_more = false;
    if ($approx && count($page) > $limit) {
        $has_more = true;
        $page = array_slice($page, 0, (int)$limit);
    }
    $rows = array();
    foreach ($page as $r) {
        $rows[] = array('path' => (string)$r['path'], 'used' => (int)$r['size'], 'files' => (int)$r['files']);
    }
    if (!$approx) $has_more = ($offset + count($rows)) < $total;
    return array('rows' => $rows, 'total' => $approx ? -1 : $total, 'has_more' => $has_more);
}


function api_detail_file_rows($pdo, $uid, $offset, $limit, $filters) {
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
        return api_detail_file_rows_keyword($pdo, $uid, $offset, $limit, $filters, $needle, $where_sql, $bind);
    }

    $approx = (int)param('approx_total', 0) === 1;
    try {
        $total = -1;
        $is_export_f = (int)param('export_stream', 0) === 1;
        $reverse = false;
        $sql_offset = (int)$offset;
        $fetch_limit = (int)$limit;

        if (!$approx) {
            $stmt = $pdo->prepare('SELECT COUNT(*) FROM files f WHERE ' . $where_sql);
            $stmt->execute($bind);
            $total = (int)$stmt->fetchColumn();
            if (!$is_export_f && $total > 0 && $offset + $limit > $total / 2) {
                $sql_offset = max(0, $total - $offset - $limit);
                $reverse = true;
            }
        } else {
            $fetch_limit = (int)$limit + 1;
        }

        $bind2 = $bind;
        $bind2[] = $fetch_limit;
        $bind2[] = $sql_offset;
        $order = $reverse ? 'ASC' : 'DESC';
        $stmt = $pdo->prepare(
            'SELECT f.dir_id, n.name AS basename, f.ext, f.size '
            . 'FROM files f JOIN file_names n ON f.name_id = n.id '
            . 'WHERE ' . $where_sql . ' ORDER BY f.size ' . $order . ' LIMIT ? OFFSET ?'
        );
        $stmt->execute($bind2);
        $page = $stmt->fetchAll(PDO::FETCH_ASSOC);
        if ($reverse) $page = array_reverse($page);
    } catch (Exception $e) {
        return array('rows' => array(), 'total' => 0, 'has_more' => false);
    }

    if ($approx) {
        $has_more = count($page) > $limit;
        if ($has_more) $page = array_slice($page, 0, (int)$limit);
        return api_detail_format_files_page($pdo, $page, $offset, -1, $has_more);
    }
    return api_detail_format_files_page($pdo, $page, $offset, $total);
}

function api_detail_file_rows_keyword($pdo, $uid, $offset, $limit, $filters,
                                       $needle, $where_sql, $bind) {
    $tokens = api_detail_keyword_tokens($needle);
    if (empty($tokens)) {
        return api_detail_file_rows($pdo, $uid, $offset, $limit,
            array('q' => '', 'ext' => $filters['ext'], 'min' => $filters['min'], 'max' => $filters['max']));
    }

    $fts_info = api_keyword_fts_match($tokens);
    $approx = (int)param('approx_total', 0) === 1;

    if (!$fts_info['needs_like'] && $fts_info['match'] !== '') {
        $name_subq = '(SELECT rowid FROM fts_file_names WHERE fts_file_names MATCH ?)';
        $fts_where = $where_sql . ' AND f.name_id IN ' . $name_subq;
        $fts_bind = array_merge($bind, array($fts_info['match']));
        try {
            $total = -1;
            $fetch_limit = (int)$limit;
            if (!$approx) {
                $stmt = $pdo->prepare('SELECT COUNT(*) FROM files f WHERE ' . $fts_where);
                $stmt->execute($fts_bind);
                $total = (int)$stmt->fetchColumn();
            } else {
                $fetch_limit = (int)$limit + 1;
            }
            $page_bind = array_merge($fts_bind, array($fetch_limit, (int)$offset));
            $stmt = $pdo->prepare(
                'SELECT f.dir_id, n.name AS basename, f.ext, f.size '
                . 'FROM files f JOIN file_names n ON f.name_id = n.id '
                . 'WHERE ' . $fts_where . ' ORDER BY f.size DESC LIMIT ? OFFSET ?'
            );
            $stmt->execute($page_bind);
            $page = $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (Exception $e) {
            $fts_info['needs_like'] = true;
        }
    }

    if ($fts_info['needs_like'] || $fts_info['match'] === '') {
        // LIKE fallback on file_names.name
        $like_bind = array();
        $like_clause = api_keyword_like_clause('n.name', $tokens, $like_bind);
        if ($like_clause === '') {
            return array('rows' => array(), 'total' => 0, 'has_more' => false);
        }
        $like_where = $where_sql . ' AND ' . $like_clause;
        $all_bind = array_merge($bind, $like_bind);
        try {
            $total = -1;
            $fetch_limit = (int)$limit;
            if (!$approx) {
                $stmt = $pdo->prepare(
                    'SELECT COUNT(*) FROM files f JOIN file_names n ON f.name_id = n.id WHERE ' . $like_where
                );
                $stmt->execute($all_bind);
                $total = (int)$stmt->fetchColumn();
            } else {
                $fetch_limit = (int)$limit + 1;
            }
            $page_bind = array_merge($all_bind, array($fetch_limit, (int)$offset));
            $stmt = $pdo->prepare(
                'SELECT f.dir_id, n.name AS basename, f.ext, f.size '
                . 'FROM files f JOIN file_names n ON f.name_id = n.id '
                . 'WHERE ' . $like_where . ' ORDER BY f.size DESC LIMIT ? OFFSET ?'
            );
            $stmt->execute($page_bind);
            $page = $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (Exception $e) {
            return array('rows' => array(), 'total' => 0, 'has_more' => false);
        }
    }

    $has_more = false;
    if ($approx && count($page) > $limit) {
        $has_more = true;
        $page = array_slice($page, 0, (int)$limit);
    }
    if (!$approx) $has_more = ($offset + count($page)) < $total;
    return api_detail_format_files_page($pdo, $page, $offset, $approx ? -1 : $total, $approx ? $has_more : null);
}


function api_detail_format_files_page($pdo, $page, $offset, $total, $has_more_override = null) {
    if (empty($page)) {
        return array('rows' => array(), 'total' => $total, 'has_more' => false);
    }
    // Batch resolve dir_id → path from dirs table
    $dir_ids = array_values(array_unique(array_map(function($r) { return (int)$r['dir_id']; }, $page)));
    $path_map = array();
    if (!empty($dir_ids)) {
        $place = implode(',', array_fill(0, count($dir_ids), '?'));
        try {
            $stmt = $pdo->prepare('SELECT DISTINCT id, path FROM dirs WHERE id IN (' . $place . ')');
            $stmt->execute($dir_ids);
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $path_map[(int)$r['id']] = (string)$r['path'];
            }
        } catch (Exception $e) {}
    }
    $rows = array();
    foreach ($page as $r) {
        $dir_id = (int)$r['dir_id'];
        $parent = isset($path_map[$dir_id]) ? $path_map[$dir_id] : '';
        $base = (string)$r['basename'];
        $path = $parent === '/' ? '/' . $base : ($parent === '' ? $base : $parent . '/' . $base);
        $rows[] = array('path' => $path, 'size' => (int)$r['size'], 'xt' => (string)$r['ext']);
    }
    $has_more = $has_more_override !== null ? $has_more_override : (($offset + count($rows)) < $total);
    return array('rows' => $rows, 'total' => $total, 'has_more' => $has_more);
}


// Tokenize keyword query the same way api_keyword_match_path does.
function api_detail_keyword_tokens($q) {
    return api_keyword_tokens($q);
}

function api_detail_keyword_match($path, $q) {
    return api_keyword_match_path($path, $q);
}

function api_detail_empty_dir($who, $offset, $limit) {
    return array(
        'date' => 0, 'user' => $who, 'total_dirs' => 0, 'total_dirs_full' => 0,
        'scan_root' => '',
        'total_used' => 0, 'offset' => $offset, 'limit' => $limit,
        'has_more' => false, 'dirs' => array(),
    );
}

function api_detail_empty_file($who, $offset, $limit) {
    return array(
        'date' => 0, 'user' => $who, 'total_files' => 0, 'total_files_full' => 0,
        'scan_root' => '',
        'total_used' => 0, 'offset' => $offset, 'limit' => $limit,
        'has_more' => false, 'files' => array(),
    );
}

function api_handle_dirs($disk_path) {
    $who = sanitize_name(get_b64_param('user', ''));
    $offset = get_int('offset', 0, 0, PHP_INT_MAX);
    $limit = get_int('limit', 500, 1, 50000);
    $count_only = (param('count_only', '0') === '1');

    $pdo = api_detail_open_db($disk_path);
    if (!$pdo) {
        if ($count_only) b64_success(array('dir_count' => 0));
        b64_success(array('dir' => api_detail_empty_dir($who, $offset, $limit)));
    }
    $user = api_detail_user_row($pdo, $who);
    if (!$user) {
        if ($count_only) b64_success(array('dir_count' => 0));
        b64_success(array('dir' => api_detail_empty_dir($who, $offset, $limit)));
    }

    $result = api_detail_dir_rows($pdo, (int)$user['uid'], $offset, $limit, api_detail_filters(false));
    $payload = array(
        'date' => (int)api_detail_meta($pdo, 'scan_timestamp'),
        'scan_root' => api_detail_meta($pdo, 'scan_root'),
        'user' => $who,
        'total_dirs' => (int)$result['total'],
        'total_dirs_full' => (int)$user['total_dirs'],
        'total_used' => (int)$user['total_size'],
        'offset' => $offset,
        'limit' => $limit,
        'has_more' => !empty($result['has_more']),
        'dirs' => $result['rows'],
    );
    if ($count_only) b64_success(array('dir_count' => (int)$payload['total_dirs']));
    b64_success(array('dir' => $payload));
}

function api_handle_files($disk_path) {
    $who = sanitize_name(get_b64_param('user', ''));
    $offset = get_int('offset', 0, 0, PHP_INT_MAX);
    $limit = get_int('limit', 500, 1, 50000);
    $count_only = (param('count_only', '0') === '1');

    $pdo = api_detail_open_db($disk_path);
    if (!$pdo) {
        if ($count_only) b64_success(array('file_count' => 0));
        b64_success(array('file' => api_detail_empty_file($who, $offset, $limit)));
    }
    $user = api_detail_user_row($pdo, $who);
    if (!$user) {
        if ($count_only) b64_success(array('file_count' => 0));
        b64_success(array('file' => api_detail_empty_file($who, $offset, $limit)));
    }

    $result = api_detail_file_rows($pdo, (int)$user['uid'], $offset, $limit, api_detail_filters(true));
    $payload = array(
        'date' => (int)api_detail_meta($pdo, 'scan_timestamp'),
        'scan_root' => api_detail_meta($pdo, 'scan_root'),
        'user' => $who,
        'total_files' => (int)$result['total'],
        'total_files_full' => (int)$user['total_files'],
        'total_used' => (int)$user['total_size'],
        'offset' => $offset,
        'limit' => $limit,
        'has_more' => !empty($result['has_more']),
        'files' => $result['rows'],
    );
    if ($count_only) b64_success(array('file_count' => (int)$payload['total_files']));
    b64_success(array('file' => $payload));
}

function api_handle_detail($disk_path) {
    $who = sanitize_name(get_b64_param('user', ''));
    $dir_offset = get_int('dir_offset', 0, 0, PHP_INT_MAX);
    $file_offset = get_int('file_offset', 0, 0, PHP_INT_MAX);
    $limit = get_int('limit', 500, 1, 50000);
    $node_type = strtolower(trim(param('node_type', 'all')));
    if ($node_type !== 'dir' && $node_type !== 'file') $node_type = 'all';

    $pdo = api_detail_open_db($disk_path);
    if (!$pdo) {
        b64_success(array(
            'dir' => api_detail_empty_dir($who, $dir_offset, $limit),
            'file' => api_detail_empty_file($who, $file_offset, $limit),
        ));
    }
    $user = api_detail_user_row($pdo, $who);
    if (!$user) {
        b64_success(array(
            'dir' => api_detail_empty_dir($who, $dir_offset, $limit),
            'file' => api_detail_empty_file($who, $file_offset, $limit),
        ));
    }
    $scan_ts = (int)api_detail_meta($pdo, 'scan_timestamp');
    $uid = (int)$user['uid'];

    $dir = api_detail_empty_dir($who, $dir_offset, $limit);
    if ($node_type !== 'file') {
        $dr = api_detail_dir_rows($pdo, $uid, $dir_offset, $limit, api_detail_filters(false));
        $dir = array(
            'date' => $scan_ts, 'user' => $who,
            'scan_root' => api_detail_meta($pdo, 'scan_root'),
            'total_dirs' => (int)$dr['total'],
            'total_dirs_full' => (int)$user['total_dirs'],
            'total_used' => (int)$user['total_size'],
            'offset' => $dir_offset, 'limit' => $limit,
            'has_more' => !empty($dr['has_more']),
            'dirs' => $dr['rows'],
        );
    }
    $file = api_detail_empty_file($who, $file_offset, $limit);
    if ($node_type !== 'dir') {
        $fr = api_detail_file_rows($pdo, $uid, $file_offset, $limit, api_detail_filters(true));
        $file = array(
            'date' => $scan_ts, 'user' => $who,
            'scan_root' => api_detail_meta($pdo, 'scan_root'),
            'total_files' => (int)$fr['total'],
            'total_files_full' => (int)$user['total_files'],
            'total_used' => (int)$user['total_size'],
            'offset' => $file_offset, 'limit' => $limit,
            'has_more' => !empty($fr['has_more']),
            'files' => $fr['rows'],
        );
    }

    b64_success(array('dir' => $dir, 'file' => $file));
}
