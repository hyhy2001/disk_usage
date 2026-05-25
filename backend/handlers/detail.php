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

// Path resolution delegates to lib/path_resolver.php.
// detail.db's `files.dir_id` references `tm.dirs.id` (treemap.db ATTACHed),
// so the schema prefix is 'tm.'.
function api_detail_path_for($pdo, $dir_id) {
    return api_path_for($pdo, $dir_id, 'tm.');
}

function api_detail_resolve_paths($pdo, $dir_ids) {
    api_path_resolve_batch($pdo, $dir_ids, 'tm.');
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
    $where = array('dus.uid = ?');
    $bind = array((int)$uid);
    if ($filters['min'] > 0) { $where[] = 'dus.size >= ?'; $bind[] = (int)$filters['min']; }
    if ($filters['max'] > 0) { $where[] = 'dus.size <= ?'; $bind[] = (int)$filters['max']; }
    $where_sql = implode(' AND ', $where);
    $needle = $filters['q'];

    // Fast path: no keyword filter → push LIMIT/OFFSET to SQL, use the
    // covering index ix_dus_uid_size. O(limit), not O(N).
    if ($needle === '') {
        $approx = (int)param('approx_total', 0) === 1;
        try {
            $total = -1;
            $is_export = (int)param('export_stream', 0) === 1;
            $reverse = false;
            $sql_offset = (int)$offset;
            $fetch_limit = (int)$limit;

            if (!$approx) {
                $stmt = $pdo->prepare('SELECT COUNT(*) FROM dir_user_size dus WHERE ' . $where_sql);
                $stmt->execute($bind);
                $total = (int)$stmt->fetchColumn();

                // Reverse-pagination: for pages past the midpoint, sort ASC
                // and read from the bottom to avoid deep OFFSET scan.
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
                'SELECT dus.dir_id, dus.size, dus.files FROM dir_user_size dus '
                . 'WHERE ' . $where_sql . ' ORDER BY dus.size ' . $order . ' '
                . 'LIMIT ? OFFSET ?'
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

        $dir_ids = array();
        foreach ($page as $r) $dir_ids[] = (int)$r['dir_id'];
        api_detail_resolve_paths($pdo, $dir_ids);
        $rows = array();
        foreach ($page as $r) {
            $rows[] = array(
                'path' => api_detail_path_for($pdo, (int)$r['dir_id']),
                'used' => (int)$r['size'],
                'files' => (int)$r['files'],
            );
        }

        if (!$approx) {
            $has_more = ($offset + count($rows)) < $total;
        }
        return array('rows' => $rows, 'total' => $approx ? -1 : $total, 'has_more' => $has_more);
    }

    // Keyword path: FTS5 on tm.names returns name_id matches → join dir_user_size
    // using d.name_id (matching names appear as dir basenames). For path
    // substring matches that aren't basenames (e.g. searching "/var/log"),
    // fall back to scanning the result set with a PHP keyword match.
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

    $like_bind = array();
    $like_clause = api_keyword_like_clause('name', $tokens, $like_bind);

    // No usable LIKE clause → fall back to streaming scan + PHP post-filter.
    if ($like_clause === '') {
        return api_detail_dir_rows_keyword_stream($pdo, $uid, $offset, $limit,
            $needle, $where_sql, $bind);
    }

    // Fast path: push name_id IN (subquery) + LIMIT/OFFSET to SQL.
    // dus.uid is in $where_sql; size bounds (if any) also there.
    $name_subq = '(SELECT id FROM tm.names WHERE ' . substr($like_clause, 1, -1) . ')';
    $full_where = $where_sql . ' AND d.name_id IN ' . $name_subq;
    $exec_bind = array_merge($bind, $like_bind);

    $approx = (int)param('approx_total', 0) === 1;

    try {
        $total = -1;
        if (!$approx) {
            $count_sql = 'SELECT COUNT(*) FROM dir_user_size dus '
                       . 'JOIN tm.dirs d ON d.id = dus.dir_id WHERE ' . $full_where;
            $stmt = $pdo->prepare($count_sql);
            $stmt->execute($exec_bind);
            $total = (int)$stmt->fetchColumn();
            if ($total === 0) {
                return array('rows' => array(), 'total' => 0, 'has_more' => false);
            }
        }

        // Fetch limit+1 in approx mode to derive has_more without a COUNT.
        $fetch_limit = $approx ? ((int)$limit + 1) : (int)$limit;
        $page_bind = $exec_bind;
        $page_bind[] = $fetch_limit;
        $page_bind[] = (int)$offset;
        $page_sql = 'SELECT dus.dir_id, dus.size, dus.files FROM dir_user_size dus '
                  . 'JOIN tm.dirs d ON d.id = dus.dir_id WHERE ' . $full_where
                  . ' ORDER BY dus.size DESC LIMIT ? OFFSET ?';
        $stmt = $pdo->prepare($page_sql);
        $stmt->execute($page_bind);
        $page = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Exception $e) {
        return array('rows' => array(), 'total' => 0, 'has_more' => false);
    }

    $has_more = false;
    if ($approx && count($page) > $limit) {
        $has_more = true;
        $page = array_slice($page, 0, (int)$limit);
    }

    if (empty($page)) {
        return array('rows' => array(), 'total' => $approx ? -1 : $total, 'has_more' => $has_more);
    }

    $dir_ids = array();
    foreach ($page as $r) $dir_ids[] = (int)$r['dir_id'];
    api_detail_resolve_paths($pdo, $dir_ids);

    $rows = array();
    foreach ($page as $r) {
        $rows[] = array(
            'path' => api_detail_path_for($pdo, (int)$r['dir_id']),
            'used' => (int)$r['size'],
            'files' => (int)$r['files'],
        );
    }

    if (!$approx) {
        $has_more = ($offset + count($rows)) < $total;
    }
    return array('rows' => $rows, 'total' => $approx ? -1 : $total, 'has_more' => $has_more);
}

// Streaming fallback: scans all candidate dus rows, post-filters by full path.
// Used when name LIKE clause normalises to nothing usable.
function api_detail_dir_rows_keyword_stream($pdo, $uid, $offset, $limit, $needle, $where_sql, $bind) {
    $sql = 'SELECT dus.dir_id, dus.size, dus.files FROM dir_user_size dus '
         . 'WHERE ' . $where_sql . ' ORDER BY dus.size DESC';

    try {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($bind);
    } catch (Exception $e) {
        return array('rows' => array(), 'total' => 0, 'has_more' => false);
    }

    $rows = array();
    $matched = 0;
    $batch = array();
    $batch_size = 512;

    $flush = function() use (&$batch, &$rows, &$matched, $needle, $offset, $limit, $pdo) {
        if (empty($batch)) return;
        $dir_ids = array();
        foreach ($batch as $r) $dir_ids[] = (int)$r['dir_id'];
        api_detail_resolve_paths($pdo, $dir_ids);
        foreach ($batch as $r) {
            $path = api_detail_path_for($pdo, (int)$r['dir_id']);
            if (!api_detail_keyword_match($path, $needle)) continue;
            $matched++;
            if ($matched <= $offset) continue;
            if (count($rows) < $limit) {
                $rows[] = array('path' => $path, 'used' => (int)$r['size'], 'files' => (int)$r['files']);
            }
        }
        $batch = array();
    };

    while (($r = $stmt->fetch(PDO::FETCH_ASSOC)) !== false) {
        $batch[] = $r;
        if (count($batch) >= $batch_size) $flush();
    }
    $flush();

    return array('rows' => $rows, 'total' => $matched, 'has_more' => $matched > ($offset + count($rows)));
}

function api_detail_file_rows($pdo, $uid, $offset, $limit, $filters) {
    $where = array('f.uid = ?');
    $bind = array((int)$uid);
    if ($filters['min'] > 0) { $where[] = 'f.size >= ?'; $bind[] = (int)$filters['min']; }
    if ($filters['max'] > 0) { $where[] = 'f.size <= ?'; $bind[] = (int)$filters['max']; }

    // (Was: anchor for partial ix_files_uid_size_big — replaced by full
    // ix_files_uid_size index, so the planner picks it up automatically.)

    // Resolve ext names → ext_ids so SQL filter can use ix_files_uid_ext_size.
    $ext_ids = null;
    if ($filters['ext'] !== '') {
        $ext_ids = api_detail_resolve_ext_ids($pdo, $filters['ext']);
        if (empty($ext_ids)) {
            // Filter specifies ext that doesn't exist in this DB → empty result.
            return array('rows' => array(), 'total' => 0, 'has_more' => false);
        }
        $where[] = 'f.ext_id IN (' . implode(',', array_map('intval', $ext_ids)) . ')';
    }
    $where_sql = implode(' AND ', $where);
    $needle = $filters['q'];

    // Fastest path: no filter at all. top_files materialized table covers
    // the full top-N truthfully (rank 1..1000 per user are the actual largest
    // files — not a sample). Beyond rank 1000 we fall back to the indexed
    // scan, which is also fast.
    $can_use_top_files =
        $needle === '' &&
        $filters['min'] === 0 &&
        $filters['max'] === 0 &&
        $ext_ids === null &&
        ($offset + $limit) <= 1000;

    if ($can_use_top_files) {
        try {
            $stmt = $pdo->prepare('SELECT COUNT(*) FROM top_files WHERE uid = ?');
            $stmt->execute(array((int)$uid));
            $total = (int)$stmt->fetchColumn();
            // total here is min(1000, real_total). Use users.total_files for
            // the truthful total, so the UI doesn't show a misleading 1000.
            $stmt2 = $pdo->prepare('SELECT total_files FROM users WHERE uid = ?');
            $stmt2->execute(array((int)$uid));
            $real_total = (int)$stmt2->fetchColumn();

            $stmt = $pdo->prepare(
                'SELECT f.dir_id, n.name AS basename, e.ext, t.size '
                . 'FROM top_files t '
                . 'JOIN files f ON f.id = t.file_id '
                . 'JOIN names n ON f.name_id = n.id '
                . 'JOIN exts e  ON f.ext_id  = e.id '
                . 'WHERE t.uid = ? ORDER BY t.rank LIMIT ? OFFSET ?'
            );
            $stmt->execute(array((int)$uid, (int)$limit, (int)$offset));
            $page = $stmt->fetchAll(PDO::FETCH_ASSOC);
            return api_detail_format_files_page($pdo, $page, $offset, $real_total);
        } catch (Exception $e) {
            // Fall through to indexed scan.
        }
    }

    // Keyword search: use FTS5 on tm.names to narrow files set.
    if ($needle !== '') {
        return api_detail_file_rows_keyword($pdo, $uid, $offset, $limit, $filters,
            $needle, $where_sql, $bind);
    }

    // Indexed scan: pushes LIMIT/OFFSET to SQL. Plan hits one of:
    //   * ix_files_uid_size       (covers ORDER BY size DESC for any page)
    //   * ix_files_uid_ext_size   (when ext_id IN ...)
    //   * temp B-tree sort on a (uid)-restricted set (worst case)
    //
    // Reverse-pagination optimization: deep OFFSET on a 700k-row index forces
    // SQLite to skip that many index leaves before returning the page. For
    // pages past the midpoint we sort ASC and read the tail — same N rows
    // but the scan is from the bottom (small-size end). Reverse the result
    // to restore the user's expected DESC order.
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
            'SELECT f.dir_id, n.name AS basename, e.ext, f.size '
            . 'FROM files f '
            . 'JOIN names n ON f.name_id = n.id '
            . 'JOIN exts e  ON f.ext_id  = e.id '
            . 'WHERE ' . $where_sql . ' ORDER BY f.size ' . $order . ' '
            . 'LIMIT ? OFFSET ?'
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

// Keyword search for files. PHP 5.4 + bundled SQLite 3.8.10 has no FTS5, so
// we use a substring LIKE scan against tm.names (small lookup table; ~50 ms
// cold, ~5 ms warm). The matching name_id set is then pushed into the files
// query via a subquery so SQLite uses ix_files_name_uid_size for the join.
function api_detail_file_rows_keyword($pdo, $uid, $offset, $limit, $filters,
                                       $needle, $where_sql, $bind) {
    $tokens = api_detail_keyword_tokens($needle);
    if (empty($tokens)) {
        return api_detail_file_rows($pdo, $uid, $offset, $limit,
            array('q' => '', 'ext' => $filters['ext'], 'min' => $filters['min'], 'max' => $filters['max']));
    }

    // Build the LIKE clauses inline so the subquery runs once per statement.
    $like_bind = array();
    $like_clause = api_keyword_like_clause('name', $tokens, $like_bind);
    if ($like_clause === '') {
        return api_detail_file_rows_keyword_fallback($pdo, $uid, $offset, $limit,
            $filters, $needle, $where_sql, $bind);
    }
    $name_subq = '(SELECT id FROM names WHERE ' . substr($like_clause, 1, -1) . ')';

    try {
        $approx = (int)param('approx_total', 0) === 1;
        $total = -1;
        $fetch_limit = (int)$limit;

        if (!$approx) {
            $count_sql = 'SELECT COUNT(*) FROM files f WHERE ' . $where_sql
                       . ' AND f.name_id IN ' . $name_subq;
            $stmt = $pdo->prepare($count_sql);
            $stmt->execute(array_merge($bind, $like_bind));
            $total = (int)$stmt->fetchColumn();
        } else {
            $fetch_limit = (int)$limit + 1;
        }

        $page_sql = 'SELECT f.dir_id, n.name AS basename, e.ext, f.size '
                  . 'FROM files f '
                  . 'JOIN names n ON f.name_id = n.id '
                  . 'JOIN exts e  ON f.ext_id  = e.id '
                  . 'WHERE ' . $where_sql
                  . ' AND f.name_id IN ' . $name_subq . ' '
                  . 'ORDER BY f.size DESC LIMIT ? OFFSET ?';
        $stmt = $pdo->prepare($page_sql);
        $bind_page = array_merge($bind, $like_bind);
        $bind_page[] = $fetch_limit;
        $bind_page[] = (int)$offset;
        $stmt->execute($bind_page);
        $page = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Exception $e) {
        return api_detail_file_rows_keyword_fallback($pdo, $uid, $offset, $limit,
            $filters, $needle, $where_sql, $bind);
    }

    $has_more = false;
    if ($approx && count($page) > $limit) {
        $has_more = true;
        $page = array_slice($page, 0, (int)$limit);
    }

    if (empty($page)) {
        return array('rows' => array(), 'total' => $approx ? -1 : $total, 'has_more' => $has_more);
    }
    $dir_ids = array();
    foreach ($page as $r) $dir_ids[] = (int)$r['dir_id'];
    api_detail_resolve_paths($pdo, $dir_ids);

    $rows = array();
    foreach ($page as $r) {
        $dir_id = (int)$r['dir_id'];
        $parent = api_detail_path_for($pdo, $dir_id);
        $base = (string)$r['basename'];
        $path = $parent === '/' ? '/' . $base : ($parent === '' ? $base : $parent . '/' . $base);
        $rows[] = array('path' => $path, 'size' => (int)$r['size'], 'xt' => (string)$r['ext']);
    }

    if (!$approx) {
        $has_more = ($offset + count($rows)) < $total;
    }
    return array('rows' => $rows, 'total' => $approx ? -1 : $total, 'has_more' => $has_more);
}

// Last-resort scan when FTS5 isn't usable (legacy DB, unsupported wildcard).
// Streams rows in size-DESC order, post-filters by full path.
function api_detail_file_rows_keyword_fallback($pdo, $uid, $offset, $limit, $filters,
                                                $needle, $where_sql, $bind) {
    try {
        $sql = 'SELECT f.dir_id, n.name AS basename, e.ext, f.size '
             . 'FROM files f '
             . 'JOIN names n ON f.name_id = n.id '
             . 'JOIN exts e  ON f.ext_id  = e.id '
             . 'WHERE ' . $where_sql . ' ORDER BY f.size DESC';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($bind);
    } catch (Exception $e) {
        return array('rows' => array(), 'total' => 0, 'has_more' => false);
    }

    $rows = array();
    $matched = 0;
    $batch = array();
    $batch_size = 512;

    $flush = function() use (&$batch, &$rows, &$matched, $needle, $offset, $limit, $pdo) {
        if (empty($batch)) return;
        $dir_ids = array();
        foreach ($batch as $r) $dir_ids[] = (int)$r['dir_id'];
        api_detail_resolve_paths($pdo, $dir_ids);
        foreach ($batch as $r) {
            $dir_id = (int)$r['dir_id'];
            $parent = api_detail_path_for($pdo, $dir_id);
            $base = (string)$r['basename'];
            $path = $parent === '/' ? '/' . $base : ($parent === '' ? $base : $parent . '/' . $base);
            if (!api_detail_keyword_match($path, $needle)) continue;
            $matched++;
            if ($matched <= $offset) continue;
            if (count($rows) < $limit) {
                $rows[] = array('path' => $path, 'size' => (int)$r['size'], 'xt' => (string)$r['ext']);
            }
        }
        $batch = array();
    };

    while (($r = $stmt->fetch(PDO::FETCH_ASSOC)) !== false) {
        $batch[] = $r;
        if (count($batch) >= $batch_size) $flush();
    }
    $flush();
    return array('rows' => $rows, 'total' => $matched, 'has_more' => $matched > ($offset + count($rows)));
}

// Format a SQL page (with raw dir_id + basename) into the JSON shape the API
// returns. Batches path resolution so the per-page cost is one IN-query.
function api_detail_format_files_page($pdo, $page, $offset, $total, $has_more_override = null) {
    if (empty($page)) {
        return array('rows' => array(), 'total' => $total, 'has_more' => false);
    }
    $dir_ids = array();
    foreach ($page as $r) $dir_ids[] = (int)$r['dir_id'];
    api_detail_resolve_paths($pdo, $dir_ids);
    $rows = array();
    foreach ($page as $r) {
        $parent = api_detail_path_for($pdo, (int)$r['dir_id']);
        $base = (string)$r['basename'];
        $path = $parent === '/' ? '/' . $base : ($parent === '' ? $base : $parent . '/' . $base);
        $rows[] = array('path' => $path, 'size' => (int)$r['size'], 'xt' => (string)$r['ext']);
    }
    $has_more = $has_more_override !== null ? $has_more_override : (($offset + count($rows)) < $total);
    return array('rows' => $rows, 'total' => $total, 'has_more' => $has_more);
}

// Resolve a comma-separated ext list (e.g. "json,log") to an array of ext_ids
// found in `exts`. Unknown exts are dropped. Empty/whitespace input → null.
function api_detail_resolve_ext_ids($pdo, $ext_csv) {
    static $cache = array();
    $oid = spl_object_hash($pdo);
    $key = $oid . ':' . strtolower(trim($ext_csv));
    if (isset($cache[$key])) return $cache[$key];

    $exts = array_values(array_filter(array_map('strtolower', array_map('trim', explode(',', $ext_csv))), 'strlen'));
    if (empty($exts)) return $cache[$key] = null;
    $place = implode(',', array_fill(0, count($exts), '?'));
    try {
        $stmt = $pdo->prepare('SELECT id FROM exts WHERE ext IN (' . $place . ')');
        $stmt->execute($exts);
        $ids = array();
        while (($v = $stmt->fetchColumn()) !== false) $ids[] = (int)$v;
    } catch (Exception $e) {
        $ids = array();
    }
    return $cache[$key] = $ids;
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
