<?php

function api_files_normalize_row($obj) {
    if (!is_array($obj)) return array('path' => '', 'size' => 0, 'xt' => '');
    $path = isset($obj['path']) ? $obj['path'] : (isset($obj['n']) ? $obj['n'] : '');
    $size = isset($obj['size']) ? $obj['size'] : (isset($obj['s']) ? $obj['s'] : 0);
    $xt = isset($obj['xt']) ? $obj['xt'] : pathinfo($path, PATHINFO_EXTENSION);
    $obj['path'] = $path;
    $obj['size'] = (int)$size;
    $obj['xt'] = strtolower((string)$xt);
    return $obj;
}

function api_files_db_like_from_wildcard($pattern) {
    $out = '';
    $len = strlen($pattern);
    for ($i = 0; $i < $len; $i++) {
        $ch = $pattern[$i];
        if ($ch === '*') $out .= '%';
        else $out .= strtolower($ch);
    }
    return $out;
}

function api_files_db_table_columns($db, $table) {
    $cols = array();
    $rs = @$db->query("PRAGMA table_info(" . $table . ")");
    while ($rs && ($row = $rs->fetchArray(SQLITE3_ASSOC)) !== false) {
        if (isset($row['name'])) $cols[$row['name']] = true;
    }
    if ($rs) $rs->finalize();
    return $cols;
}

function api_files_db_bind_all($stmt, $binds) {
    foreach ($binds as $k => $v) {
        $stmt->bindValue($k, $v[0], $v[1]);
    }
}

function api_handle_files_db($file_path, $who, $offset, $limit, $filter_min, $filter_max, $q_array, $ext_lookup, $has_filters) {
    if (!class_exists('SQLite3')) b64_error('SQLite3 extension is required for data_detail.db.', 500);

    try {
        $db = defined('SQLITE3_OPEN_READONLY') ? new SQLite3($file_path, SQLITE3_OPEN_READONLY) : new SQLite3($file_path);
    } catch (Exception $e) {
        b64_error('Unable to open data_detail.db for user: ' . $who, 500);
    }

    $stmt = @$db->prepare('SELECT user_id, scan_date AS date, username AS user, total_files, total_used FROM users WHERE username = :user LIMIT 1');
    if (!$stmt) {
        $db->close();
        b64_error('Invalid data_detail.db schema for file report.', 500);
    }
    $stmt->bindValue(':user', $who, SQLITE3_TEXT);
    $rs = @$stmt->execute();
    $meta = $rs ? $rs->fetchArray(SQLITE3_ASSOC) : false;
    if ($rs) $rs->finalize();
    $stmt->close();

    if (!is_array($meta)) {
        $db->close();
        b64_success(array('file' => array(
            'date' => 0, 'user' => $who, 'total_files' => 0, 'total_used' => 0,
            'offset' => $offset, 'limit' => $limit, 'has_more' => false, 'files' => array(),
        )));
    }

    $user_id = isset($meta['user_id']) ? (int)$meta['user_id'] : 0;
    $date = isset($meta['date']) ? (int)$meta['date'] : 0;
    $user_name = isset($meta['user']) ? $meta['user'] : $who;
    $total_files_meta = isset($meta['total_files']) ? (int)$meta['total_files'] : 0;
    $total_used = isset($meta['total_used']) ? (int)$meta['total_used'] : 0;

    if (!$has_filters && $total_files_meta > 0 && $offset >= $total_files_meta) {
        $db->close();
        b64_success(array('file' => array(
            'date' => $date, 'user' => $user_name, 'total_files' => $total_files_meta, 'total_used' => $total_used,
            'offset' => $offset, 'limit' => $limit, 'has_more' => false, 'files' => array(),
        )));
    }

    $path_expr = "LOWER(CASE WHEN di.path = '' THEN bi.basename ELSE di.path || '/' || bi.basename END)";
    $conds = array('fd.user_id = :uid');
    $binds = array(':uid' => array($user_id, SQLITE3_INTEGER));
    $qidx = 0;
    $eidx = 0;

    if ($filter_min > 0) { $conds[] = 'fd.size >= :min_size'; $binds[':min_size'] = array((int)$filter_min, SQLITE3_INTEGER); }
    if ($filter_max > 0) { $conds[] = 'fd.size <= :max_size'; $binds[':max_size'] = array((int)$filter_max, SQLITE3_INTEGER); }
    if (!empty($ext_lookup)) {
        $extConds = array();
        foreach ($ext_lookup as $ext => $_v) {
            $k = ':ext_' . $eidx++;
            $extConds[] = "LOWER(COALESCE(xi.ext, '')) = " . $k;
            $binds[$k] = array(strtolower($ext), SQLITE3_TEXT);
        }
        if (!empty($extConds)) $conds[] = '(' . implode(' OR ', $extConds) . ')';
    }
    if (!empty($q_array)) {
        $qConds = array();
        foreach ($q_array as $q) {
            $k = ':q_' . $qidx++;
            $q = trim($q);
            if ($q === '') continue;
            $qConds[] = $path_expr . ' LIKE ' . $k;
            $binds[$k] = array(strpos($q, '*') === false ? ('%' . strtolower($q) . '%') : api_files_db_like_from_wildcard($q), SQLITE3_TEXT);
        }
        if (!empty($qConds)) $conds[] = '(' . implode(' OR ', $qConds) . ')';
    }

    $where_sql = ' WHERE ' . implode(' AND ', $conds);
    $from_sql = ' FROM file_detail fd JOIN dirs_dict di ON fd.dir_id = di.dir_id JOIN basename_dict bi ON fd.basename_id = bi.basename_id JOIN ext_dict xi ON fd.ext_id = xi.ext_id';

    if (param('count_only', '0') === '1') {
        $cnt_stmt = @$db->prepare('SELECT COUNT(*)' . $from_sql . $where_sql);
        $n = 0;
        if ($cnt_stmt) {
            api_files_db_bind_all($cnt_stmt, $binds);
            $cnt_rs = $cnt_stmt->execute();
            if ($cnt_rs) {
                $cnt_row = $cnt_rs->fetchArray(SQLITE3_NUM);
                $n = $cnt_row ? (int)$cnt_row[0] : 0;
                $cnt_rs->finalize();
            }
            $cnt_stmt->close();
        }
        $db->close();
        b64_success(array('file_count' => $n));
    }

    $data_stmt = @$db->prepare("SELECT CASE WHEN di.path = '' THEN bi.basename ELSE di.path || '/' || bi.basename END AS path, fd.size AS size, COALESCE(xi.ext, '') AS xt" . $from_sql . $where_sql . ' ORDER BY fd.size DESC LIMIT :lim OFFSET :off');
    if (!$data_stmt) {
        $db->close();
        b64_error('Unable to prepare data query for file report.', 500);
    }
    api_files_db_bind_all($data_stmt, $binds);
    $data_stmt->bindValue(':lim', (int)($limit + 1), SQLITE3_INTEGER);
    $data_stmt->bindValue(':off', (int)$offset, SQLITE3_INTEGER);

    $all_rows = array();
    $data_rs = @$data_stmt->execute();
    while ($data_rs && ($row = $data_rs->fetchArray(SQLITE3_ASSOC)) !== false) $all_rows[] = api_files_normalize_row($row);
    if ($data_rs) $data_rs->finalize();
    $data_stmt->close();
    $db->close();

    $has_more = count($all_rows) > $limit;
    if ($has_more) array_pop($all_rows);
    $total_files = $has_filters ? ($offset + count($all_rows) + ($has_more ? 1 : 0)) : ($total_files_meta > 0 ? $total_files_meta : ($offset + count($all_rows)));

    b64_success(array('file' => array(
        'date' => $date, 'user' => $user_name, 'total_files' => $total_files, 'total_used' => $total_used,
        'offset' => $offset, 'limit' => $limit, 'has_more' => $has_more, 'files' => $all_rows,
    )));
}


function api_files_csv_value($v) {
    $s = (string)$v;
    if (strpos($s, '"') !== false) $s = str_replace('"', '""', $s);
    if (strpos($s, ',') !== false || strpos($s, '"') !== false || strpos($s, "\n") !== false || strpos($s, "\r") !== false) $s = '"' . $s . '"';
    return $s;
}

function api_files_csv_line($cols) {
    $out = array();
    foreach ($cols as $c) $out[] = api_files_csv_value($c);
    return implode(',', $out) . "\r\n";
}

function api_handle_files_csv($disk_path) {
    $who        = sanitize_name(get_b64_param('user', ''));
    $filter_q   = strtolower(trim(param('filter_query', '')));
    $filter_ext = strtolower(trim(param('filter_ext', '')));
    $filter_min = get_int('filter_min_size', 0, 0, PHP_INT_MAX);
    $filter_max = get_int('filter_max_size', 0, 0, PHP_INT_MAX);
    $db_path = $disk_path . DIRECTORY_SEPARATOR . 'detail_users' . DIRECTORY_SEPARATOR . 'data_detail.db';

    if (!class_exists('SQLite3')) b64_error('SQLite3 extension is required for data_detail.db.', 500);
    if (!is_file($db_path)) b64_error('data_detail.db not found.', 404);

    $export_lock = api_export_acquire_slot($disk_path, 120);

    try {
        $db = defined('SQLITE3_OPEN_READONLY') ? new SQLite3($db_path, SQLITE3_OPEN_READONLY) : new SQLite3($db_path);
    } catch (Exception $e) {
        b64_error('Unable to open data_detail.db for user: ' . $who, 500);
    }

    $user_stmt = @$db->prepare('SELECT user_id FROM users WHERE username = :user LIMIT 1');
    if (!$user_stmt) { $db->close(); b64_error('Invalid data_detail.db schema.', 500); }
    $user_stmt->bindValue(':user', $who, SQLITE3_TEXT);
    $user_rs = @$user_stmt->execute();
    $user_row = $user_rs ? $user_rs->fetchArray(SQLITE3_ASSOC) : false;
    if ($user_rs) $user_rs->finalize();
    $user_stmt->close();
    if (!is_array($user_row) || !isset($user_row['user_id'])) { $db->close(); b64_error('User not found.', 404); }
    $user_id = (int)$user_row['user_id'];

    $q_array = $filter_q !== '' ? array_values(array_filter(array_map('trim', explode(',', $filter_q)), 'strlen')) : array();
    $ext_array = $filter_ext !== '' ? array_values(array_filter(array_map('trim', explode(',', $filter_ext)), 'strlen')) : array();
    $conds = array('fd.user_id = :uid');
    $binds = array(':uid' => array($user_id, SQLITE3_INTEGER));
    $path_expr = "LOWER(CASE WHEN di.path = '' THEN bi.basename ELSE di.path || '/' || bi.basename END)";
    if ($filter_min > 0) { $conds[] = 'fd.size >= :min_size'; $binds[':min_size'] = array((int)$filter_min, SQLITE3_INTEGER); }
    if ($filter_max > 0) { $conds[] = 'fd.size <= :max_size'; $binds[':max_size'] = array((int)$filter_max, SQLITE3_INTEGER); }
    if (!empty($ext_array)) {
        $extConds = array(); $i = 0;
        foreach ($ext_array as $ext) {
            $k = ':ext_' . $i++;
            $extConds[] = "LOWER(COALESCE(xi.ext, '')) = " . $k;
            $binds[$k] = array(strtolower($ext), SQLITE3_TEXT);
        }
        if (!empty($extConds)) $conds[] = '(' . implode(' OR ', $extConds) . ')';
    }
    if (!empty($q_array)) {
        $qConds = array(); $i = 0;
        foreach ($q_array as $q) {
            $k = ':q_' . $i++;
            $qConds[] = $path_expr . ' LIKE ' . $k;
            $binds[$k] = array(strpos($q, '*') === false ? ('%' . strtolower($q) . '%') : api_files_db_like_from_wildcard($q), SQLITE3_TEXT);
        }
        if (!empty($qConds)) $conds[] = '(' . implode(' OR ', $qConds) . ')';
    }

    while (ob_get_level() > 0) @ob_end_clean();
    $download_name = 'files_' . preg_replace('/[^A-Za-z0-9._-]+/', '_', $who) . '_' . date('Ymd_His') . '.csv.gz';
    header('Content-Type: application/gzip');
    header('Content-Disposition: attachment; filename="' . $download_name . '"');
    header('Cache-Control: no-cache, no-store, must-revalidate');

    $csv_buf = "\xEF\xBB\xBF";
    $csv_buf .= api_files_csv_line(array('User', 'Path', 'Size (bytes)'));

    $from_sql = ' FROM file_detail fd JOIN dirs_dict di ON fd.dir_id = di.dir_id JOIN basename_dict bi ON fd.basename_id = bi.basename_id JOIN ext_dict xi ON fd.ext_id = xi.ext_id';
    $stmt = @$db->prepare("SELECT CASE WHEN di.path = '' THEN bi.basename ELSE di.path || '/' || bi.basename END AS path, fd.size AS size" . $from_sql . ' WHERE ' . implode(' AND ', $conds) . ' ORDER BY fd.size DESC');
    if (!$stmt) { $db->close(); b64_error('Unable to prepare CSV query.', 500); }
    api_files_db_bind_all($stmt, $binds);
    $rs = @$stmt->execute();
    $n = 0;
    while ($rs && ($row = $rs->fetchArray(SQLITE3_ASSOC)) !== false) {
        $csv_buf .= api_files_csv_line(array($who, isset($row['path']) ? $row['path'] : '', isset($row['size']) ? (int)$row['size'] : 0));
        if ((++$n % 5000) === 0) { echo gzencode($csv_buf, 3); $csv_buf = ''; flush(); }
    }
    if ($rs) $rs->finalize();
    if ($csv_buf !== '') echo gzencode($csv_buf, 3);
    $stmt->close();
    $db->close();
    exit;
}

function api_handle_files($disk_path) {
    $who        = sanitize_name(get_b64_param('user', ''));
    $offset     = get_int('offset', 0,   0,    PHP_INT_MAX);
    $limit      = get_int('limit',  500, 1,    5000);
    $filter_q   = strtolower(trim(param('filter_query', '')));
    $filter_ext = strtolower(trim(param('filter_ext', '')));
    $filter_min = get_int('filter_min_size', 0, 0, PHP_INT_MAX);
    $filter_max = get_int('filter_max_size', 0, 0, PHP_INT_MAX);
    $detail_dir = $disk_path . DIRECTORY_SEPARATOR . 'detail_users';

    $data_detail = $detail_dir . DIRECTORY_SEPARATOR . 'data_detail.db';
    if (is_file($data_detail)) {
        $file_path = $data_detail;
    } else {
        $pattern = '/(?:.*_)?detail_report_files?_' . preg_quote($who, '/') . '\\.json$/i';
        $file_path = find_file_by_pattern($detail_dir, $pattern);
    }

    if (!$file_path || !is_file($file_path)) {
        b64_success(array('file' => array(
            'date'        => 0,
            'user'        => $who,
            'total_files' => 0,
            'total_used'  => 0,
            'offset'      => $offset,
            'limit'       => $limit,
            'has_more'    => false,
            'files'       => array(),
        )));
    }

    // Cache by source file mtime/size + all params that affect the response.
    api_send_etag_cache($file_path, array(
        'files', $who, $offset, $limit, $filter_q, $filter_ext, $filter_min, $filter_max,
        param('count_only', '0'),
    ));

    $q_array = $filter_q !== '' ? array_values(array_filter(array_map('trim', explode(',', $filter_q)), 'strlen')) : array();
    $q_matchers = array();
    foreach ($q_array as $q) {
        if (strpos($q, '*') === false) {
            $q_matchers[] = array('type' => 'contains', 'value' => strtolower($q));
        } else {
            $q_matchers[] = array(
                'type' => 'regex',
                'value' => '/^' . str_replace('\\*', '.*', preg_quote($q, '/')) . '$/i'
            );
        }
    }

    $ext_array = $filter_ext !== '' ? array_values(array_filter(array_map('trim', explode(',', $filter_ext)), 'strlen')) : array();
    $ext_lookup = array();
    foreach ($ext_array as $ext) $ext_lookup[strtolower($ext)] = true;

    $has_filters = (!empty($q_matchers) || !empty($ext_lookup) || $filter_min > 0 || $filter_max > 0);

    $path_matches = function($pathName, $pathNameLc) use ($q_matchers) {
        if (empty($q_matchers)) return true;
        foreach ($q_matchers as $matcher) {
            if ($matcher['type'] === 'contains') {
                if (strpos($pathNameLc, $matcher['value']) !== false) return true;
            } else {
                if (preg_match($matcher['value'], $pathName)) return true;
            }
        }
        return false;
    };

    if (preg_match('/\\.db$/i', $file_path)) {
        api_handle_files_db($file_path, $who, $offset, $limit, $filter_min, $filter_max, $q_array, $ext_lookup, $has_filters);
    }


    // Fast-path: decode whole JSON once (bounded by file size), then filter/paginate in memory.
    $fast_decode_max_bytes = 16777216; // 16 MiB
    $file_size = @filesize($file_path);
    if ($has_filters && $file_size !== false && $file_size > 0 && $file_size <= $fast_decode_max_bytes) {
        $raw = @file_get_contents($file_path);
        if ($raw !== false) {
            $payload = @json_decode($raw, true);
            if (is_array($payload) && isset($payload['files']) && is_array($payload['files'])) {
                $date = isset($payload['date']) ? (int)$payload['date'] : 0;
                $user_name = isset($payload['user']) ? $payload['user'] : $who;
                $total_used = isset($payload['total_used']) ? (int)$payload['total_used'] : 0;
                $source = $payload['files'];

                $collected = array();
                if (!$has_filters) {
                    $total_files = isset($payload['total_files']) ? (int)$payload['total_files'] : count($source);
                    if ($total_files < count($source)) $total_files = count($source);
                    $slice = array_slice($source, $offset, $limit);
                    foreach ($slice as $obj) $collected[] = api_files_normalize_row($obj);
                } else {
                    $filtered_total = 0;
                    foreach ($source as $obj) {
                        if (!is_array($obj)) continue;

                        $fileSize = isset($obj['size']) ? $obj['size'] : (isset($obj['s']) ? $obj['s'] : 0);
                        if ($filter_min > 0 && $fileSize < $filter_min) continue;
                        if ($filter_max > 0 && $fileSize > $filter_max) continue;

                        $pathName = isset($obj['path']) ? $obj['path'] : (isset($obj['n']) ? $obj['n'] : '');
                        $pathNameLc = strtolower($pathName);
                        if (!$path_matches($pathName, $pathNameLc)) continue;

                        if (!empty($ext_lookup)) {
                            $ext = isset($obj['xt']) ? $obj['xt'] : pathinfo($pathName, PATHINFO_EXTENSION);
                            if (!isset($ext_lookup[strtolower($ext)])) continue;
                        }

                        if ($filtered_total >= $offset && count($collected) < $limit) {
                            $collected[] = api_files_normalize_row($obj);
                        }
                        $filtered_total++;
                    }
                    $total_files = $filtered_total;
                }

                $has_more = ($offset + count($collected) < $total_files);

                b64_success(array('file' => array(
                    'date'        => $date,
                    'user'        => $user_name,
                    'total_files' => $total_files,
                    'total_used'  => $total_used,
                    'offset'      => $offset,
                    'limit'       => $limit,
                    'has_more'    => $has_more,
                    'files'       => $collected,
                )));
            }
        }
    }

    // Streaming fallback for large files or malformed JSON.
    $fh = @fopen($file_path, 'r');

    $date = 0; $user_name = $who; $total_files = 0; $total_used = 0;
    while ($fh && ($ln = fgets($fh)) !== false) {
        if      (preg_match('/"date"\\s*:\\s*(\\d+)/',        $ln, $m)) $date        = (int)$m[1];
        elseif  (preg_match('/"user"\\s*:\\s*"([^"]+)"/',    $ln, $m)) $user_name   = $m[1];
        elseif  (preg_match('/"total_files"\\s*:\\s*(\\d+)/', $ln, $m)) $total_files = (int)$m[1];
        elseif  (preg_match('/"total_used"\\s*:\\s*(\\d+)/',  $ln, $m)) $total_used  = (int)$m[1];
        if (strpos($ln, '"files"') !== false && strpos($ln, '[') !== false) break;
    }

    if (!$has_filters && $total_files > 0 && $offset >= $total_files) {
        if ($fh) fclose($fh);
        b64_success(array('file' => array(
            'date'        => $date,
            'user'        => $user_name,
            'total_files' => $total_files,
            'total_used'  => $total_used,
            'offset'      => $offset,
            'limit'       => $limit,
            'has_more'    => false,
            'files'       => array(),
        )));
    }

    $idx = 0; $collected = array(); $buf = ''; $depth = 0;
    $filtered_total = 0;
    $skip_depth = 0;
    $skip_started = false;

    while ($fh && ($ln = fgets($fh)) !== false) {
        $trimmed = trim($ln);
        if ($trimmed === ']' || $trimmed === '];') break;
        if ($trimmed === '' || $trimmed === '[')   continue;

        if (!$has_filters && $idx < $offset) {
            $open_count = substr_count($ln, '{');
            $close_count = substr_count($ln, '}');
            if ($open_count > 0 || $skip_started) {
                $skip_started = true;
                $skip_depth += ($open_count - $close_count);
                if ($skip_depth <= 0) {
                    $idx++;
                    $skip_depth = 0;
                    $skip_started = false;
                }
            }
            continue;
        }

        $buf   .= $ln;
        $depth += substr_count($ln, '{') - substr_count($ln, '}');

        if ($depth <= 0 && ltrim($buf) !== '') {
            $obj = @json_decode(rtrim(trim($buf), ','), true);
            if ($obj !== null && is_array($obj)) {
                $pass = true;
                $fileSize = isset($obj['size']) ? $obj['size'] : (isset($obj['s']) ? $obj['s'] : 0);
                $pathName = isset($obj['path']) ? $obj['path'] : (isset($obj['n']) ? $obj['n'] : '');
                $pathNameLc = strtolower($pathName);

                if ($filter_min > 0 && $fileSize < $filter_min) $pass = false;
                if ($filter_max > 0 && $fileSize > $filter_max) $pass = false;
                if ($pass && !$path_matches($pathName, $pathNameLc)) $pass = false;
                if ($pass && !empty($ext_lookup)) {
                    $ext = isset($obj['xt']) ? $obj['xt'] : pathinfo($pathName, PATHINFO_EXTENSION);
                    if (!isset($ext_lookup[strtolower($ext)])) $pass = false;
                }

                if ($pass) {
                    if ($idx >= $offset && count($collected) < $limit) {
                        $collected[] = api_files_normalize_row($obj);
                    }
                    $idx++;
                    $filtered_total++;
                }
            }
            if (!$has_filters && count($collected) >= $limit) break;
            $buf = ''; $depth = 0;
        }
    }
    if ($fh) fclose($fh);

    if ($has_filters) $total_files = $filtered_total;
    $has_more = ($offset + count($collected) < $total_files);

    b64_success(array('file' => array(
        'date'        => $date,
        'user'        => $user_name,
        'total_files' => $total_files,
        'total_used'  => $total_used,
        'offset'      => $offset,
        'limit'       => $limit,
        'has_more'    => $has_more,
        'files'       => $collected,
    )));
}
