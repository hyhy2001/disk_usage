<?php

function api_handle_detail($disk_path) {
    $who         = sanitize_name(get_b64_param('user', ''));
    $dir_offset  = get_int('dir_offset', 0, 0, PHP_INT_MAX);
    $file_offset = get_int('file_offset', 0, 0, PHP_INT_MAX);
    $limit       = get_int('limit', 500, 1, 5000);

    $detail_dir = $disk_path . DIRECTORY_SEPARATOR . 'detail_users';
    $pattern = '/(?:.*_)?detail_report_files?_' . preg_quote($who, '/') . '\\.db$/i';
    $file_path = find_file_by_pattern($detail_dir, $pattern);

    if (!$file_path || !is_file($file_path)) {
        b64_success(array(
            'dir' => array('date' => 0, 'user' => $who, 'total_dirs' => 0, 'total_used' => 0, 'offset' => $dir_offset, 'limit' => $limit, 'has_more' => false, 'dirs' => array()),
            'file' => array('date' => 0, 'user' => $who, 'total_files' => 0, 'total_used' => 0, 'offset' => $file_offset, 'limit' => $limit, 'has_more' => false, 'files' => array()),
        ));
    }

    api_send_etag_cache($file_path, array(
        'detail',
        $who,
        $dir_offset,
        $file_offset,
        $limit,
        strtolower(trim(param('filter_query', ''))),
        strtolower(trim(param('filter_ext', ''))),
        get_int('filter_min_size', 0, 0, PHP_INT_MAX),
        get_int('filter_max_size', 0, 0, PHP_INT_MAX),
    ));

    if (!class_exists('SQLite3')) b64_error('SQLite3 extension is required for .db detail report.', 500);

    $filter_q   = strtolower(trim(param('filter_query', '')));
    $filter_ext = strtolower(trim(param('filter_ext', '')));
    $filter_min = get_int('filter_min_size', 0, 0, PHP_INT_MAX);
    $filter_max = get_int('filter_max_size', 0, 0, PHP_INT_MAX);

    $q_array = $filter_q !== '' ? array_values(array_filter(array_map('trim', explode(',', $filter_q)), 'strlen')) : array();
    $ext_array = $filter_ext !== '' ? array_values(array_filter(array_map('trim', explode(',', $filter_ext)), 'strlen')) : array();
    $ext_lookup = array();
    foreach ($ext_array as $ext) $ext_lookup[strtolower($ext)] = true;

    $has_filters_dir = (!empty($q_array) || $filter_min > 0 || $filter_max > 0);
    $has_filters_file = (!empty($q_array) || !empty($ext_lookup) || $filter_min > 0 || $filter_max > 0);

    try {
        $db = defined('SQLITE3_OPEN_READONLY') ? new SQLite3($file_path, SQLITE3_OPEN_READONLY) : new SQLite3($file_path);
    } catch (Exception $e) {
        b64_error('Unable to open SQLite detail report for user: ' . $who, 500);
    }

    $date = 0;
    $user_name = $who;
    $total_used = 0;
    $total_dirs_meta = 0;
    $total_files_meta = 0;

    $meta_dirs_rs = @$db->query('SELECT date, user, total_dirs AS total_items, total_used FROM meta_dirs LIMIT 1');
    $row = $meta_dirs_rs ? $meta_dirs_rs->fetchArray(SQLITE3_ASSOC) : false;
    if ($row) {
        $date = isset($row['date']) ? (int)$row['date'] : 0;
        $user_name = isset($row['user']) ? $row['user'] : $who;
        $total_dirs_meta = isset($row['total_items']) ? (int)$row['total_items'] : 0;
        $total_used = isset($row['total_used']) ? (int)$row['total_used'] : 0;
    }
    if ($meta_dirs_rs) $meta_dirs_rs->finalize();

    $meta_files_rs = @$db->query('SELECT total_files FROM meta_files LIMIT 1');
    $rowf = $meta_files_rs ? $meta_files_rs->fetchArray(SQLITE3_ASSOC) : false;
    if ($rowf && isset($rowf['total_files'])) $total_files_meta = (int)$rowf['total_files'];
    if ($meta_files_rs) $meta_files_rs->finalize();

    if ($total_dirs_meta === 0 || $date === 0) {
        $meta_rs = @$db->query('SELECT date, user, total_items, total_used FROM meta LIMIT 1');
        $mr = $meta_rs ? $meta_rs->fetchArray(SQLITE3_ASSOC) : false;
        if ($mr) {
            $date = isset($mr['date']) ? (int)$mr['date'] : $date;
            $user_name = isset($mr['user']) ? $mr['user'] : $user_name;
            if ($total_dirs_meta === 0 && isset($mr['total_items'])) $total_dirs_meta = (int)$mr['total_items'];
            if ($total_files_meta === 0 && isset($mr['total_items'])) $total_files_meta = (int)$mr['total_items'];
            if ($total_used === 0 && isset($mr['total_used'])) $total_used = (int)$mr['total_used'];
        }
        if ($meta_rs) $meta_rs->finalize();
    }

    $dir = _detail_query_dirs($db, $dir_offset, $limit, $filter_min, $filter_max, $q_array, $has_filters_dir, $total_dirs_meta);
    $file = _detail_query_files($db, $file_offset, $limit, $filter_min, $filter_max, $q_array, $ext_lookup, $has_filters_file, $total_files_meta);
    $db->close();

    b64_success(array(
        'dir' => array(
            'date' => $date, 'user' => $user_name, 'total_dirs' => $dir['total'], 'total_used' => $total_used,
            'offset' => $dir_offset, 'limit' => $limit, 'has_more' => $dir['has_more'], 'dirs' => $dir['rows'],
        ),
        'file' => array(
            'date' => $date, 'user' => $user_name, 'total_files' => $file['total'], 'total_used' => $total_used,
            'offset' => $file_offset, 'limit' => $limit, 'has_more' => $file['has_more'], 'files' => $file['rows'],
        ),
    ));
}

function _detail_query_dirs($db, $offset, $limit, $filter_min, $filter_max, $q_array, $has_filters, $total_meta) {
    $is_split = false;
    $split_check = @$db->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dirs_data' LIMIT 1");
    $is_split = $split_check && ($split_check->fetchArray(SQLITE3_ASSOC) !== false);
    if ($split_check) $split_check->finalize();

    if ($is_split) {
        $from_clause = 'dirs_data dd JOIN dirs_index di ON dd.dir_id = di.id';
        $select_cols = 'di.path AS path, dd.used AS used';
        $order_clause = 'dd.used DESC';
        $where_used = 'dd.used';
        $path_expr = 'LOWER(di.path)';
    } else {
        $dirs_check = @$db->query("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name='dirs' LIMIT 1");
        $has_dirs = $dirs_check && ($dirs_check->fetchArray(SQLITE3_ASSOC) !== false);
        if ($dirs_check) $dirs_check->finalize();
        if (!$has_dirs) return array('rows' => array(), 'has_more' => false, 'total' => 0);

        $from_clause = 'dirs';
        $select_cols = 'path, used';
        $order_clause = 'used DESC';
        $where_used = 'used';
        $path_expr = 'LOWER(path)';
    }

    $conds = array();
    $binds = array();
    if ($filter_min > 0) { $conds[] = $where_used . ' >= :min_size'; $binds[':min_size'] = array((int)$filter_min, SQLITE3_INTEGER); }
    if ($filter_max > 0) { $conds[] = $where_used . ' <= :max_size'; $binds[':max_size'] = array((int)$filter_max, SQLITE3_INTEGER); }
    if (!empty($q_array)) {
        $has_glob = false;
        foreach ($q_array as $q) {
            if (strpos(trim($q), '*') !== false) { $has_glob = true; break; }
        }

        $fts4_match = '';
        if (!$has_glob && $is_split) {
            $fts_parts = array();
            foreach ($q_array as $q) {
                foreach (preg_split('/[\/\.\s_-]+/', strtolower(trim($q)), -1, PREG_SPLIT_NO_EMPTY) as $t) {
                    if ($t !== '') $fts_parts[] = $t . '*';
                }
            }
            if (!empty($fts_parts)) {
                $fts_ok = @$db->querySingle("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fts_dirs'");
                if ($fts_ok !== null) $fts4_match = implode(' ', $fts_parts);
            }
        }

        if ($fts4_match !== '') {
            $conds[] = 'dd.dir_id IN (SELECT docid FROM fts_dirs WHERE fts_dirs MATCH :fts_q)';
            $binds[':fts_q'] = array($fts4_match, SQLITE3_TEXT);
        } else {
            $qConds = array(); $i = 0;
            foreach ($q_array as $q) {
                $k = ':q_' . $i++;
                if (strpos($q, '*') === false) $binds[$k] = array('%' . strtolower($q) . '%', SQLITE3_TEXT);
                else $binds[$k] = array(api_dirs_db_like_from_wildcard($q), SQLITE3_TEXT);
                $qConds[] = $path_expr . ' LIKE ' . $k;
            }
            if (!empty($qConds)) $conds[] = '(' . implode(' OR ', $qConds) . ')';
        }
    }

    $where_sql = empty($conds) ? '' : (' WHERE ' . implode(' AND ', $conds));
    $stmt = @$db->prepare('SELECT ' . $select_cols . ' FROM ' . $from_clause . $where_sql . ' ORDER BY ' . $order_clause . ' LIMIT :lim OFFSET :off');
    if (!$stmt) return array('rows' => array(), 'has_more' => false, 'total' => 0);
    api_dirs_db_bind_all($stmt, $binds);
    $stmt->bindValue(':lim', (int)($limit + 1), SQLITE3_INTEGER);
    $stmt->bindValue(':off', (int)$offset, SQLITE3_INTEGER);
    $rs = @$stmt->execute();
    $rows = array();
    while ($rs && ($row = $rs->fetchArray(SQLITE3_ASSOC)) !== false) $rows[] = api_dirs_normalize_row($row);
    if ($rs) $rs->finalize();
    $stmt->close();

    $has_more = count($rows) > $limit;
    if ($has_more) array_pop($rows);
    $total = $has_filters ? ($offset + count($rows) + ($has_more ? 1 : 0)) : ($total_meta > 0 ? $total_meta : ($offset + count($rows)));
    return array('rows' => $rows, 'has_more' => $has_more, 'total' => $total);
}

function _detail_query_files($db, $offset, $limit, $filter_min, $filter_max, $q_array, $ext_lookup, $has_filters, $total_meta) {
    $is_split = false;
    $split_check = @$db->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='files_data' LIMIT 1");
    $is_split = $split_check && ($split_check->fetchArray(SQLITE3_ASSOC) !== false);
    if ($split_check) $split_check->finalize();

    if ($is_split) {
        $from_clause = 'files_data fd JOIN dirs_index di ON fd.dir_id = di.id';
        $select_cols = "(di.path || '/' || fd.basename) AS path, fd.size AS size, fd.xt AS xt";
        $order_clause = 'fd.size DESC';
        $where_size = 'fd.size';
        $path_expr = "LOWER(di.path || '/' || fd.basename)";
        $ext_expr = 'fd.xt';
    } else {
        $files_check = @$db->query("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name='files' LIMIT 1");
        $has_files = $files_check && ($files_check->fetchArray(SQLITE3_ASSOC) !== false);
        if ($files_check) $files_check->finalize();
        if (!$has_files) return array('rows' => array(), 'has_more' => false, 'total' => 0);

        $from_clause = 'files';
        $select_cols = 'path, size, xt';
        $order_clause = 'size DESC';
        $where_size = 'size';
        $path_expr = 'LOWER(path)';
        $ext_expr = 'xt';
    }

    $conds = array();
    $binds = array();
    if ($filter_min > 0) { $conds[] = $where_size . ' >= :min_size'; $binds[':min_size'] = array((int)$filter_min, SQLITE3_INTEGER); }
    if ($filter_max > 0) { $conds[] = $where_size . ' <= :max_size'; $binds[':max_size'] = array((int)$filter_max, SQLITE3_INTEGER); }
    if (!empty($ext_lookup)) {
        $eConds = array(); $i = 0;
        foreach ($ext_lookup as $ext => $_v) {
            $k = ':e_' . $i++;
            $eConds[] = $ext_expr . ' = ' . $k;
            $binds[$k] = array(strtolower($ext), SQLITE3_TEXT);
        }
        if (!empty($eConds)) $conds[] = '(' . implode(' OR ', $eConds) . ')';
    }
    if (!empty($q_array)) {
        $has_glob = false;
        foreach ($q_array as $q) {
            if (strpos(trim($q), '*') !== false) { $has_glob = true; break; }
        }

        $fts4_match = '';
        if (!$has_glob && $is_split) {
            $fts_parts = array();
            foreach ($q_array as $q) {
                foreach (preg_split('/[\/\.\s_-]+/', strtolower(trim($q)), -1, PREG_SPLIT_NO_EMPTY) as $t) {
                    if ($t !== '') $fts_parts[] = $t . '*';
                }
            }
            if (!empty($fts_parts)) {
                $fts_ok = @$db->querySingle("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fts_files'");
                if ($fts_ok !== null) $fts4_match = implode(' ', $fts_parts);
            }
        }

        if ($fts4_match !== '') {
            $conds[] = 'fd.id IN (SELECT docid FROM fts_files WHERE fts_files MATCH :fts_q)';
            $binds[':fts_q'] = array($fts4_match, SQLITE3_TEXT);
        } else {
            $qConds = array(); $i = 0;
            foreach ($q_array as $q) {
                $k = ':q_' . $i++;
                if (strpos($q, '*') === false) $binds[$k] = array('%' . strtolower($q) . '%', SQLITE3_TEXT);
                else $binds[$k] = array(api_files_db_like_from_wildcard($q), SQLITE3_TEXT);
                $qConds[] = $path_expr . ' LIKE ' . $k;
            }
            if (!empty($qConds)) $conds[] = '(' . implode(' OR ', $qConds) . ')';
        }
    }

    $where_sql = empty($conds) ? '' : (' WHERE ' . implode(' AND ', $conds));
    $stmt = @$db->prepare('SELECT ' . $select_cols . ' FROM ' . $from_clause . $where_sql . ' ORDER BY ' . $order_clause . ' LIMIT :lim OFFSET :off');
    if (!$stmt) return array('rows' => array(), 'has_more' => false, 'total' => 0);
    api_files_db_bind_all($stmt, $binds);
    $stmt->bindValue(':lim', (int)($limit + 1), SQLITE3_INTEGER);
    $stmt->bindValue(':off', (int)$offset, SQLITE3_INTEGER);
    $rs = @$stmt->execute();
    $rows = array();
    while ($rs && ($row = $rs->fetchArray(SQLITE3_ASSOC)) !== false) $rows[] = api_files_normalize_row($row);
    if ($rs) $rs->finalize();
    $stmt->close();

    $has_more = count($rows) > $limit;
    if ($has_more) array_pop($rows);
    $total = $has_filters ? ($offset + count($rows) + ($has_more ? 1 : 0)) : ($total_meta > 0 ? $total_meta : ($offset + count($rows)));
    return array('rows' => $rows, 'has_more' => $has_more, 'total' => $total);
}
