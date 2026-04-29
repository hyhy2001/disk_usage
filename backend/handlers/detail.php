<?php

function api_handle_detail($disk_path) {
    $who         = sanitize_name(get_b64_param('user', ''));
    $dir_offset  = get_int('dir_offset', 0, 0, PHP_INT_MAX);
    $file_offset = get_int('file_offset', 0, 0, PHP_INT_MAX);
    $limit       = get_int('limit', 500, 1, 5000);

    $file_path = $disk_path . DIRECTORY_SEPARATOR . 'detail_users' . DIRECTORY_SEPARATOR . 'data_detail.db';
    if (!is_file($file_path)) {
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

    if (!class_exists('SQLite3')) b64_error('SQLite3 extension is required for data_detail.db.', 500);

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
        b64_error('Unable to open data_detail.db for user: ' . $who, 500);
    }

    $user_id = _detail_get_user_id($db, $who);
    if ($user_id <= 0) {
        $db->close();
        b64_success(array(
            'dir' => array('date' => 0, 'user' => $who, 'total_dirs' => 0, 'total_used' => 0, 'offset' => $dir_offset, 'limit' => $limit, 'has_more' => false, 'dirs' => array()),
            'file' => array('date' => 0, 'user' => $who, 'total_files' => 0, 'total_used' => 0, 'offset' => $file_offset, 'limit' => $limit, 'has_more' => false, 'files' => array()),
        ));
    }

    $meta_stmt = @$db->prepare('SELECT scan_date AS date, username AS user, total_dirs, total_files, total_used FROM users WHERE user_id = :uid LIMIT 1');
    $meta_stmt->bindValue(':uid', (int)$user_id, SQLITE3_INTEGER);
    $meta_rs = @$meta_stmt->execute();
    $mr = $meta_rs ? $meta_rs->fetchArray(SQLITE3_ASSOC) : false;
    $date = $mr && isset($mr['date']) ? (int)$mr['date'] : 0;
    $user_name = $mr && isset($mr['user']) ? $mr['user'] : $who;
    $total_dirs_meta = $mr && isset($mr['total_dirs']) ? (int)$mr['total_dirs'] : 0;
    $total_files_meta = $mr && isset($mr['total_files']) ? (int)$mr['total_files'] : 0;
    $total_used = $mr && isset($mr['total_used']) ? (int)$mr['total_used'] : 0;
    if ($meta_rs) $meta_rs->finalize();
    $meta_stmt->close();

    $dir = _detail_query_dirs($db, $dir_offset, $limit, $filter_min, $filter_max, $q_array, $has_filters_dir, $total_dirs_meta, $user_id);
    $file = _detail_query_files($db, $file_offset, $limit, $filter_min, $filter_max, $q_array, $ext_lookup, $has_filters_file, $total_files_meta, $user_id);
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

function _detail_get_user_id($db, $username) {
    $stmt = @$db->prepare('SELECT user_id FROM users WHERE username = :username LIMIT 1');
    if (!$stmt) return 0;
    $stmt->bindValue(':username', $username, SQLITE3_TEXT);
    $rs = @$stmt->execute();
    $row = $rs ? $rs->fetchArray(SQLITE3_ASSOC) : false;
    if ($rs) $rs->finalize();
    $stmt->close();
    return ($row && isset($row['user_id'])) ? (int)$row['user_id'] : 0;
}

function _detail_bind_all($stmt, $binds) {
    foreach ($binds as $k => $v) $stmt->bindValue($k, $v[0], $v[1]);
}

function _detail_like_from_wildcard($pattern) {
    $out = '';
    $len = strlen($pattern);
    for ($i = 0; $i < $len; $i++) $out .= ($pattern[$i] === '*') ? '%' : strtolower($pattern[$i]);
    return $out;
}

function _detail_query_dirs($db, $offset, $limit, $filter_min, $filter_max, $q_array, $has_filters, $total_meta, $user_id) {
    $conds = array('dd.user_id = :uid');
    $binds = array(':uid' => array((int)$user_id, SQLITE3_INTEGER));

    if ($filter_min > 0) { $conds[] = 'dd.size >= :min_size'; $binds[':min_size'] = array((int)$filter_min, SQLITE3_INTEGER); }
    if ($filter_max > 0) { $conds[] = 'dd.size <= :max_size'; $binds[':max_size'] = array((int)$filter_max, SQLITE3_INTEGER); }
    if (!empty($q_array)) {
        $qConds = array(); $i = 0;
        foreach ($q_array as $q) {
            $k = ':q_' . $i++;
            $binds[$k] = array(strpos($q, '*') === false ? ('%' . strtolower($q) . '%') : _detail_like_from_wildcard($q), SQLITE3_TEXT);
            $qConds[] = 'LOWER(di.path) LIKE ' . $k;
        }
        if (!empty($qConds)) $conds[] = '(' . implode(' OR ', $qConds) . ')';
    }

    $where_sql = ' WHERE ' . implode(' AND ', $conds);
    $stmt = @$db->prepare('SELECT di.path AS path, dd.size AS used FROM dir_detail dd JOIN dirs_dict di ON dd.dir_id = di.dir_id' . $where_sql . ' ORDER BY dd.size DESC LIMIT :lim OFFSET :off');
    if (!$stmt) return array('rows' => array(), 'has_more' => false, 'total' => 0);
    _detail_bind_all($stmt, $binds);
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

function _detail_query_files($db, $offset, $limit, $filter_min, $filter_max, $q_array, $ext_lookup, $has_filters, $total_meta, $user_id) {
    $path_expr = "LOWER(CASE WHEN di.path = '' THEN bi.basename ELSE di.path || '/' || bi.basename END)";
    $conds = array('fd.user_id = :uid');
    $binds = array(':uid' => array((int)$user_id, SQLITE3_INTEGER));

    if ($filter_min > 0) { $conds[] = 'fd.size >= :min_size'; $binds[':min_size'] = array((int)$filter_min, SQLITE3_INTEGER); }
    if ($filter_max > 0) { $conds[] = 'fd.size <= :max_size'; $binds[':max_size'] = array((int)$filter_max, SQLITE3_INTEGER); }
    if (!empty($ext_lookup)) {
        $eConds = array(); $i = 0;
        foreach ($ext_lookup as $ext => $_v) {
            $k = ':e_' . $i++;
            $eConds[] = "LOWER(COALESCE(xi.ext, '')) = " . $k;
            $binds[$k] = array(strtolower($ext), SQLITE3_TEXT);
        }
        if (!empty($eConds)) $conds[] = '(' . implode(' OR ', $eConds) . ')';
    }
    if (!empty($q_array)) {
        $qConds = array(); $i = 0;
        foreach ($q_array as $q) {
            $k = ':q_' . $i++;
            $binds[$k] = array(strpos($q, '*') === false ? ('%' . strtolower($q) . '%') : _detail_like_from_wildcard($q), SQLITE3_TEXT);
            $qConds[] = $path_expr . ' LIKE ' . $k;
        }
        if (!empty($qConds)) $conds[] = '(' . implode(' OR ', $qConds) . ')';
    }

    $where_sql = ' WHERE ' . implode(' AND ', $conds);
    $stmt = @$db->prepare("SELECT CASE WHEN di.path = '' THEN bi.basename ELSE di.path || '/' || bi.basename END AS path, fd.size AS size, COALESCE(xi.ext, '') AS xt FROM file_detail fd JOIN dirs_dict di ON fd.dir_id = di.dir_id JOIN basename_dict bi ON fd.basename_id = bi.basename_id JOIN ext_dict xi ON fd.ext_id = xi.ext_id" . $where_sql . ' ORDER BY fd.size DESC LIMIT :lim OFFSET :off');
    if (!$stmt) return array('rows' => array(), 'has_more' => false, 'total' => 0);
    _detail_bind_all($stmt, $binds);
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
