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
    if (!class_exists('SQLite3')) b64_error('SQLite3 extension is required for .db detail report.', 500);

    try {
        if (defined('SQLITE3_OPEN_READONLY')) {
            $db = new SQLite3($file_path, SQLITE3_OPEN_READONLY);
        } else {
            $db = new SQLite3($file_path);
        }
    } catch (Exception $e) {
        b64_error('Unable to open SQLite file report for user: ' . $who, 500);
    }

    $date = 0;
    $user_name = $who;
    $total_files_meta = 0;
    $total_used = 0;

    $meta_rs = @$db->query('SELECT date, user, total_items, total_used FROM meta LIMIT 1');
    if ($meta_rs) {
        $row = $meta_rs->fetchArray(SQLITE3_ASSOC);
        if (is_array($row)) {
            if (isset($row['date'])) $date = (int)$row['date'];
            if (isset($row['user'])) $user_name = $row['user'];
            if (isset($row['total_items'])) $total_files_meta = (int)$row['total_items'];
            if (isset($row['total_used'])) $total_used = (int)$row['total_used'];
        }
        $meta_rs->finalize();
    }

    // Detect schema: new split (files_data + dirs_index) vs classic (files table).
    $is_split = false;
    $files_exists = false;
    $files_chk = @$db->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='files' LIMIT 1");
    $files_exists = $files_chk && ($files_chk->fetchArray(SQLITE3_ASSOC) !== false);
    if ($files_chk) $files_chk->finalize();
    if (!$files_exists) {
        $split_chk = @$db->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='files_data' LIMIT 1");
        $is_split = $split_chk && ($split_chk->fetchArray(SQLITE3_ASSOC) !== false);
        if ($split_chk) $split_chk->finalize();
    }
    if (!$files_exists && !$is_split) {
        $db->close();
        b64_success(array('file' => array(
            'date' => $date, 'user' => $user_name, 'total_files' => 0, 'total_used' => $total_used,
            'offset' => $offset, 'limit' => $limit, 'has_more' => false, 'files' => array(),
        )));
    }
    // Build query parts based on schema: split JOIN vs classic files table.
    if ($is_split) {
        $from_clause  = 'files_data fd JOIN dirs_index di ON fd.dir_id = di.id';
        $select_cols  = "(di.path || '/' || fd.basename) AS path, fd.size AS size, fd.xt AS xt";
        $order_clause = 'fd.size DESC';
        $where_size   = 'fd.size';
        $path_expr    = "LOWER(di.path || '/' || fd.basename)";
        $name_expr    = 'LOWER(fd.basename)';
        $ext_expr     = 'fd.xt';
    } else {
        $cols = api_files_db_table_columns($db, 'files');
        $from_clause  = 'files';
        $select_cols  = 'path, size, xt';
        $order_clause = 'size DESC';
        $where_size   = 'size';
        $path_expr    = isset($cols['path_lc']) ? 'path_lc' : 'LOWER(path)';
        $name_expr    = isset($cols['name_lc']) ? 'name_lc' : 'LOWER(path)';
        // New slim .db stores `xt` already lowercased; legacy DB may still have `xt_lc`.
        $ext_expr     = isset($cols['xt_lc']) ? 'xt_lc' : 'xt';
    }

    if (!$has_filters) {
        if ($total_files_meta > 0 && $offset >= $total_files_meta) {
            $db->close();
            b64_success(array('file' => array(
                'date'        => $date,
                'user'        => $user_name,
                'total_files' => $total_files_meta,
                'total_used'  => $total_used,
                'offset'      => $offset,
                'limit'       => $limit,
                'has_more'    => false,
                'files'       => array(),
            )));
        }

        $collected = array();
        $sql = 'SELECT ' . $select_cols . ' FROM ' . $from_clause . ' ORDER BY ' . $order_clause . ' LIMIT ' . (int)$limit . ' OFFSET ' . (int)$offset;
        $rs = @$db->query($sql);
        while ($rs && ($row = $rs->fetchArray(SQLITE3_ASSOC)) !== false) {
            $collected[] = api_files_normalize_row($row);
        }
        if ($rs) $rs->finalize();

        $total_files = $total_files_meta > 0 ? $total_files_meta : ($offset + count($collected));
        $has_more = ($offset + count($collected) < $total_files);
        $db->close();

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

    $conds = array();
    $binds = array();
    $qidx = 0;
    $eidx = 0;

    if ($filter_min > 0) {
        $conds[] = $where_size . ' >= :min_size';
        $binds[':min_size'] = array((int)$filter_min, SQLITE3_INTEGER);
    }
    if ($filter_max > 0) {
        $conds[] = $where_size . ' <= :max_size';
        $binds[':max_size'] = array((int)$filter_max, SQLITE3_INTEGER);
    }
    if (!empty($ext_lookup)) {
        $extConds = array();
        foreach ($ext_lookup as $ext => $_v) {
            $k = ':ext_' . $eidx++;
            $extConds[] = $ext_expr . ' = ' . $k;
            $binds[$k] = array(strtolower($ext), SQLITE3_TEXT);
        }
        if (!empty($extConds)) $conds[] = '(' . implode(' OR ', $extConds) . ')';
    }
    if (!empty($q_array)) {
        // Prefer FTS4 for plain keyword searches (no glob wildcards).
        $has_glob = false;
        foreach ($q_array as $q) {
            if (strpos(trim($q), '*') !== false) { $has_glob = true; break; }
        }

        $fts4_match = '';
        if (!$has_glob && $is_split) {  // FTS4 uses fd.id alias — only valid for split schema
            $fts_parts = [];
            foreach ($q_array as $q) {
                foreach (preg_split('/[\/\.\s_-]+/', strtolower(trim($q)), -1, PREG_SPLIT_NO_EMPTY) as $t) {
                    if ($t !== '') $fts_parts[] = $t . '*';
                }
            }
            if (!empty($fts_parts)) {
                $fts_ok = @$db->querySingle(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='fts_files'"
                );
                if ($fts_ok !== null) {
                    $fts4_match = implode(' ', $fts_parts);
                }
            }
        }

        if ($fts4_match !== '') {
            // FTS4 fast path: fts_files stores fullpath (dir/basename), O(k) lookup.
            $conds[] = 'fd.id IN (SELECT docid FROM fts_files WHERE fts_files MATCH :fts_q)';
            $binds[':fts_q'] = array($fts4_match, SQLITE3_TEXT);
        } else {
            // LIKE fallback: glob wildcards used or fts_files table unavailable.
            $qConds = array();
            foreach ($q_array as $q) {
                $k = ':q_' . $qidx++;
                $q = trim($q);
                if ($q === '') continue;
                if (strpos($q, '*') === false) {
                    $qConds[] = '(' . $path_expr . ' LIKE ' . $k . ' OR ' . $name_expr . ' LIKE ' . $k . ')';
                    $binds[$k] = array('%' . strtolower($q) . '%', SQLITE3_TEXT);
                } else {
                    $qConds[] = '(' . $path_expr . ' LIKE ' . $k . ' OR ' . $name_expr . ' LIKE ' . $k . ')';
                    $binds[$k] = array(api_files_db_like_from_wildcard($q), SQLITE3_TEXT);
                }
            }
            if (!empty($qConds)) $conds[] = '(' . implode(' OR ', $qConds) . ')';
        }
    }

    $where_sql = empty($conds) ? '' : (' WHERE ' . implode(' AND ', $conds));

    // count_only=1: return just the filtered row count for lazy total computation.
    if (param('count_only', '0') === '1') {
        $cnt_sql  = 'SELECT COUNT(*) FROM ' . $from_clause . $where_sql;
        $cnt_stmt = @$db->prepare($cnt_sql);
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

    // Fetch limit+1 to detect has_more without a separate COUNT full-scan.
    // total_files is exact when all results fit (<=limit), else a lower-bound estimate.
    $data_stmt = @$db->prepare(
        'SELECT ' . $select_cols . ' FROM ' . $from_clause . $where_sql . ' ORDER BY ' . $order_clause . ' LIMIT :lim OFFSET :off'
    );
    if (!$data_stmt) {
        $db->close();
        b64_error('Unable to prepare data query for file report.', 500);
    }
    api_files_db_bind_all($data_stmt, $binds);
    $data_stmt->bindValue(':lim', (int)($limit + 1), SQLITE3_INTEGER);
    $data_stmt->bindValue(':off', (int)$offset, SQLITE3_INTEGER);

    $all_rows = array();
    $data_rs = @$data_stmt->execute();
    while ($data_rs && ($row = $data_rs->fetchArray(SQLITE3_ASSOC)) !== false) {
        $all_rows[] = api_files_normalize_row($row);
    }
    if ($data_rs) $data_rs->finalize();
    $data_stmt->close();
    $db->close();

    $has_more    = count($all_rows) > $limit;
    if ($has_more) array_pop($all_rows);
    $collected   = $all_rows;
    $total_files = $offset + count($collected) + ($has_more ? 1 : 0);

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

function api_handle_files_ndjson($file_path, $who, $offset, $limit, $filter_min, $filter_max, $path_matches, $ext_lookup, $has_filters) {
    $fh = @fopen($file_path, 'r');
    if (!$fh) b64_error('Unable to open NDJSON file report for user: ' . $who, 500);

    $date = 0;
    $user_name = $who;
    $total_files_meta = 0;
    $total_used = 0;
    $collected = array();
    $filtered_total = 0;

    while (($ln = fgets($fh)) !== false) {
        $ln = trim($ln);
        if ($ln === '') continue;

        $obj = @json_decode($ln, true);
        if (!is_array($obj)) continue;

        $meta = null;
        if (isset($obj['_meta']) && is_array($obj['_meta'])) $meta = $obj['_meta'];
        elseif (isset($obj['meta']) && is_array($obj['meta'])) $meta = $obj['meta'];
        elseif (isset($obj['type']) && $obj['type'] === 'meta') $meta = $obj;

        if (is_array($meta)) {
            if (isset($meta['date'])) $date = (int)$meta['date'];
            if (isset($meta['user'])) $user_name = $meta['user'];
            if (isset($meta['total_files'])) $total_files_meta = (int)$meta['total_files'];
            if (isset($meta['total_used'])) $total_used = (int)$meta['total_used'];
            if (!$has_filters && $total_files_meta > 0 && $offset >= $total_files_meta) {
                fclose($fh);
                b64_success(array('file' => array(
                    'date'        => $date,
                    'user'        => $user_name,
                    'total_files' => $total_files_meta,
                    'total_used'  => $total_used,
                    'offset'      => $offset,
                    'limit'       => $limit,
                    'has_more'    => false,
                    'files'       => array(),
                )));
            }
            continue;
        }

        $fileSize = isset($obj['size']) ? $obj['size'] : (isset($obj['s']) ? $obj['s'] : 0);
        $pathName = isset($obj['path']) ? $obj['path'] : (isset($obj['n']) ? $obj['n'] : '');
        $pathNameLc = strtolower($pathName);

        if ($filter_min > 0 && $fileSize < $filter_min) continue;
        if ($filter_max > 0 && $fileSize > $filter_max) continue;
        if (!$path_matches($pathName, $pathNameLc)) continue;
        if (!empty($ext_lookup)) {
            $ext = isset($obj['xt']) ? $obj['xt'] : pathinfo($pathName, PATHINFO_EXTENSION);
            if (!isset($ext_lookup[strtolower($ext)])) continue;
        }

        if ($filtered_total >= $offset && count($collected) < $limit) $collected[] = api_files_normalize_row($obj);
        $filtered_total++;

        if (!$has_filters && $total_files_meta > 0 && $filtered_total >= ($offset + $limit)) break;
    }
    fclose($fh);

    $total_files = $has_filters ? $filtered_total : ($total_files_meta > 0 ? $total_files_meta : $filtered_total);
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

function api_handle_files($disk_path) {
    $who        = sanitize_name(get_b64_param('user', ''));
    $offset     = get_int('offset', 0,   0,    PHP_INT_MAX);
    $limit      = get_int('limit',  500, 1,    50000);
    $filter_q   = strtolower(trim(param('filter_query', '')));
    $filter_ext = strtolower(trim(param('filter_ext', '')));
    $filter_min = get_int('filter_min_size', 0, 0, PHP_INT_MAX);
    $filter_max = get_int('filter_max_size', 0, 0, PHP_INT_MAX);
    $detail_dir = $disk_path . DIRECTORY_SEPARATOR . 'detail_users';

    $pattern = '/(?:.*_)?detail_report_files?_' . preg_quote($who, '/') . '\\.(?:db|json|ndjson)$/i';
    $file_path = find_file_by_pattern($detail_dir, $pattern);

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

    if (preg_match('/\\.ndjson$/i', $file_path)) {
        api_handle_files_ndjson($file_path, $who, $offset, $limit, $filter_min, $filter_max, $path_matches, $ext_lookup, $has_filters);
    }

    // Fast-path: decode whole JSON once (bounded by file size), then filter/paginate in memory.
    $fast_decode_max_bytes = 33554432; // 32 MiB
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
