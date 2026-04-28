<?php

function api_dirs_normalize_row($obj) {
    if (!is_array($obj)) return array('path' => '', 'used' => 0);
    $path = isset($obj['path']) ? $obj['path'] : (isset($obj['n']) ? $obj['n'] : '');
    $used = isset($obj['used']) ? $obj['used'] : (isset($obj['s']) ? $obj['s'] : 0);
    $obj['path'] = $path;
    $obj['used'] = (int)$used;
    return $obj;
}

function api_dirs_db_like_from_wildcard($pattern) {
    $out = '';
    $len = strlen($pattern);
    for ($i = 0; $i < $len; $i++) {
        $ch = $pattern[$i];
        if ($ch === '*') $out .= '%';
        else $out .= strtolower($ch);
    }
    return $out;
}

function api_dirs_db_table_columns($db, $table) {
    $cols = array();
    $rs = @$db->query("PRAGMA table_info(" . $table . ")");
    while ($rs && ($row = $rs->fetchArray(SQLITE3_ASSOC)) !== false) {
        if (isset($row['name'])) $cols[$row['name']] = true;
    }
    if ($rs) $rs->finalize();
    return $cols;
}

function api_dirs_db_bind_all($stmt, $binds) {
    foreach ($binds as $k => $v) {
        $stmt->bindValue($k, $v[0], $v[1]);
    }
}

function api_handle_dirs_db($file_path, $who, $offset, $limit, $filter_min, $filter_max, $q_array, $has_filters) {
    if (!class_exists('SQLite3')) b64_error('SQLite3 extension is required for .db detail report.', 500);

    try {
        if (defined('SQLITE3_OPEN_READONLY')) {
            $db = new SQLite3($file_path, SQLITE3_OPEN_READONLY);
        } else {
            $db = new SQLite3($file_path);
        }
    } catch (Exception $e) {
        b64_error('Unable to open SQLite directory report for user: ' . $who, 500);
    }

    $date = 0;
    $user_name = $who;
    $total_dirs_meta = 0;
    $total_used = 0;

    $meta_rs = null;
    $row = false;

    // Prefer new split schema (dirs_data + dirs_index) — supports FTS4 and indexed ORDER BY.
    // Fall back to legacy 'dirs' view/table for old report formats.
    $split_check = @$db->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dirs_data' LIMIT 1");
    $is_split = $split_check && ($split_check->fetchArray(SQLITE3_ASSOC) !== false);
    if ($split_check) $split_check->finalize();

    $has_dirs_view = false;
    if (!$is_split) {
        $dirs_check = @$db->query("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name='dirs' LIMIT 1");
        $has_dirs_view = $dirs_check && ($dirs_check->fetchArray(SQLITE3_ASSOC) !== false);
        if ($dirs_check) $dirs_check->finalize();
    }
    if (!$is_split && !$has_dirs_view) {
        $db->close();
        b64_success(array('dir' => array(
            'date' => 0, 'user' => $who, 'total_dirs' => 0, 'total_used' => 0,
            'offset' => $offset, 'limit' => $limit, 'has_more' => false, 'dirs' => array(),
        )));
    }

    // Try meta_dirs (combined schema) first, fall back to meta (old standalone).
    $meta_rs = @$db->query('SELECT date, user, total_dirs AS total_items, total_used FROM meta_dirs LIMIT 1');
    $row = $meta_rs ? $meta_rs->fetchArray(SQLITE3_ASSOC) : false;
    if (!$row) {
        if ($meta_rs) $meta_rs->finalize();
        $meta_rs = @$db->query('SELECT date, user, total_items, total_used FROM meta LIMIT 1');
        $row = $meta_rs ? $meta_rs->fetchArray(SQLITE3_ASSOC) : false;
    }
    if (is_array($row)) {
        if (isset($row['date']))        $date           = (int)$row['date'];
        if (isset($row['user']))        $user_name      = $row['user'];
        if (isset($row['total_items'])) $total_dirs_meta = (int)$row['total_items'];
        if (isset($row['total_used']))  $total_used     = (int)$row['total_used'];
    }
    if ($meta_rs) $meta_rs->finalize();

    // Build query parts based on schema: new split (JOIN) vs classic 'dirs' table.
    if ($is_split) {
        $from_clause  = 'dirs_data dd JOIN dirs_index di ON dd.dir_id = di.id';
        $select_cols  = 'di.path AS path, dd.used AS used';
        $order_clause = 'dd.used DESC';
        $where_used   = 'dd.used';
        $path_expr    = 'LOWER(di.path)';
        $name_expr    = 'LOWER(di.path)';
    } else {
        $cols = api_dirs_db_table_columns($db, 'dirs');
        $from_clause  = 'dirs';
        $select_cols  = 'path, used';
        $order_clause = 'used DESC';
        $where_used   = 'used';
        $path_expr    = isset($cols['path_lc']) ? 'path_lc' : 'LOWER(path)';
        $name_expr    = isset($cols['name_lc']) ? 'name_lc' : 'LOWER(path)';
    }

    if (!$has_filters) {
        if ($total_dirs_meta > 0 && $offset >= $total_dirs_meta) {
            $db->close();
            b64_success(array('dir' => array(
                'date'        => $date,
                'user'        => $user_name,
                'total_dirs'  => $total_dirs_meta,
                'total_used'  => $total_used,
                'offset'      => $offset,
                'limit'       => $limit,
                'has_more'    => false,
                'dirs'        => array(),
            )));
        }

        $collected = array();
        $sql = 'SELECT ' . $select_cols . ' FROM ' . $from_clause . ' ORDER BY ' . $order_clause . ' LIMIT ' . (int)$limit . ' OFFSET ' . (int)$offset;
        $rs = @$db->query($sql);
        while ($rs && ($row = $rs->fetchArray(SQLITE3_ASSOC)) !== false) {
            $collected[] = api_dirs_normalize_row($row);
        }
        if ($rs) $rs->finalize();

        $total_dirs = $total_dirs_meta > 0 ? $total_dirs_meta : ($offset + count($collected));
        $has_more = ($offset + count($collected) < $total_dirs);
        $db->close();

        b64_success(array('dir' => array(
            'date'        => $date,
            'user'        => $user_name,
            'total_dirs'  => $total_dirs,
            'total_used'  => $total_used,
            'offset'      => $offset,
            'limit'       => $limit,
            'has_more'    => $has_more,
            'dirs'        => $collected,
        )));
    }

    $conds = array();
    $binds = array();
    $qidx = 0;

    if ($filter_min > 0) {
        $conds[] = $where_used . ' >= :min_size';
        $binds[':min_size'] = array((int)$filter_min, SQLITE3_INTEGER);
    }
    if ($filter_max > 0) {
        $conds[] = $where_used . ' <= :max_size';
        $binds[':max_size'] = array((int)$filter_max, SQLITE3_INTEGER);
    }
    if (!empty($q_array)) {
        // Prefer FTS4 for plain keyword searches (no glob wildcards).
        // Splits on path/ext separators and adds prefix wildcard to each token.
        $has_glob = false;
        foreach ($q_array as $q) {
            if (strpos(trim($q), '*') !== false) { $has_glob = true; break; }
        }

        $fts4_match = '';
        if (!$has_glob && $is_split) {  // FTS4 uses dd.dir_id alias — only valid for split schema
            $fts_parts = [];
            foreach ($q_array as $q) {
                foreach (preg_split('/[\/\.\s_-]+/', strtolower(trim($q)), -1, PREG_SPLIT_NO_EMPTY) as $t) {
                    if ($t !== '') $fts_parts[] = $t . '*';
                }
            }
            if (!empty($fts_parts)) {
                // Check fts_dirs exists (present only in new-schema DBs with FTS4).
                $fts_ok = @$db->querySingle(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='fts_dirs'"
                );
                if ($fts_ok !== null) {
                    $fts4_match = implode(' ', $fts_parts);
                }
            }
        }

        if ($fts4_match !== '') {
            // FTS4 fast path: sub-select matching docids, O(k) where k = match count.
            $conds[] = 'dd.dir_id IN (SELECT docid FROM fts_dirs WHERE fts_dirs MATCH :fts_q)';
            $binds[':fts_q'] = array($fts4_match, SQLITE3_TEXT);
        } else {
            // LIKE fallback: glob wildcards used or fts_dirs table unavailable.
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
                    $binds[$k] = array(api_dirs_db_like_from_wildcard($q), SQLITE3_TEXT);
                }
            }
            if (!empty($qConds)) $conds[] = '(' . implode(' OR ', $qConds) . ')';
        }
    }
    $where_sql = empty($conds) ? '' : (' WHERE ' . implode(' AND ', $conds));

    // count_only=1: return just the filtered row count for lazy total computation.
    // JS fires this in the background after initial page-1 render to get the accurate total.
    if (param('count_only', '0') === '1') {
        $cnt_sql  = 'SELECT COUNT(*) FROM ' . $from_clause . $where_sql;
        $cnt_stmt = @$db->prepare($cnt_sql);
        $n = 0;
        if ($cnt_stmt) {
            api_dirs_db_bind_all($cnt_stmt, $binds);
            $cnt_rs = $cnt_stmt->execute();
            if ($cnt_rs) {
                $cnt_row = $cnt_rs->fetchArray(SQLITE3_NUM);
                $n = $cnt_row ? (int)$cnt_row[0] : 0;
                $cnt_rs->finalize();
            }
            $cnt_stmt->close();
        }
        $db->close();
        b64_success(array('dir_count' => $n));
    }

    // Fetch limit+1 to detect has_more without a separate COUNT full-scan.
    // total_dirs is exact when all results fit (<=limit), else a lower-bound estimate.
    $data_stmt = @$db->prepare(
        'SELECT ' . $select_cols . ' FROM ' . $from_clause . $where_sql . ' ORDER BY ' . $order_clause . ' LIMIT :lim OFFSET :off'
    );
    if (!$data_stmt) {
        $db->close();
        b64_error('Unable to prepare data query for directory report.', 500);
    }
    api_dirs_db_bind_all($data_stmt, $binds);
    $data_stmt->bindValue(':lim', (int)($limit + 1), SQLITE3_INTEGER);
    $data_stmt->bindValue(':off', (int)$offset, SQLITE3_INTEGER);

    $all_rows = array();
    $data_rs = @$data_stmt->execute();
    while ($data_rs && ($row = $data_rs->fetchArray(SQLITE3_ASSOC)) !== false) {
        $all_rows[] = api_dirs_normalize_row($row);
    }
    if ($data_rs) $data_rs->finalize();
    $data_stmt->close();
    $db->close();

    $has_more   = count($all_rows) > $limit;
    if ($has_more) array_pop($all_rows);
    $collected  = $all_rows;
    $total_dirs = $offset + count($collected) + ($has_more ? 1 : 0);

    b64_success(array('dir' => array(
        'date'        => $date,
        'user'        => $user_name,
        'total_dirs'  => $total_dirs,
        'total_used'  => $total_used,
        'offset'      => $offset,
        'limit'       => $limit,
        'has_more'    => $has_more,
        'dirs'        => $collected,
    )));
}

function api_handle_dirs_ndjson($file_path, $who, $offset, $limit, $filter_min, $filter_max, $path_matches, $has_filters) {
    $fh = @fopen($file_path, 'r');
    if (!$fh) b64_error('Unable to open NDJSON directory report for user: ' . $who, 500);

    $date = 0;
    $user_name = $who;
    $total_dirs_meta = 0;
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
            if (isset($meta['total_dirs'])) $total_dirs_meta = (int)$meta['total_dirs'];
            if (isset($meta['total_used'])) $total_used = (int)$meta['total_used'];
            if (!$has_filters && $total_dirs_meta > 0 && $offset >= $total_dirs_meta) {
                fclose($fh);
                b64_success(array('dir' => array(
                    'date'        => $date,
                    'user'        => $user_name,
                    'total_dirs'  => $total_dirs_meta,
                    'total_used'  => $total_used,
                    'offset'      => $offset,
                    'limit'       => $limit,
                    'has_more'    => false,
                    'dirs'        => array(),
                )));
            }
            continue;
        }

        $usedBytes = isset($obj['used']) ? $obj['used'] : (isset($obj['s']) ? $obj['s'] : 0);
        $pathName  = isset($obj['path']) ? $obj['path'] : (isset($obj['n']) ? $obj['n'] : '');
        $pathNameLc = strtolower($pathName);

        if ($filter_min > 0 && $usedBytes < $filter_min) continue;
        if ($filter_max > 0 && $usedBytes > $filter_max) continue;
        if (!$path_matches($pathName, $pathNameLc)) continue;

        if ($filtered_total >= $offset && count($collected) < $limit) $collected[] = api_dirs_normalize_row($obj);
        $filtered_total++;

        if (!$has_filters && $total_dirs_meta > 0 && $filtered_total >= ($offset + $limit)) break;
    }
    fclose($fh);

    $total_dirs = $has_filters ? $filtered_total : ($total_dirs_meta > 0 ? $total_dirs_meta : $filtered_total);
    $has_more = ($offset + count($collected) < $total_dirs);

    b64_success(array('dir' => array(
        'date'        => $date,
        'user'        => $user_name,
        'total_dirs'  => $total_dirs,
        'total_used'  => $total_used,
        'offset'      => $offset,
        'limit'       => $limit,
        'has_more'    => $has_more,
        'dirs'        => $collected,
    )));
}

function api_handle_dirs($disk_path) {
    $who        = sanitize_name(get_b64_param('user', ''));
    $offset     = get_int('offset', 0,   0,    PHP_INT_MAX);
    $limit      = get_int('limit',  500, 1,    5000);
    $filter_q   = strtolower(trim(param('filter_query', '')));
    $filter_min = get_int('filter_min_size', 0, 0, PHP_INT_MAX);
    $filter_max = get_int('filter_max_size', 0, 0, PHP_INT_MAX);
    $detail_dir = $disk_path . DIRECTORY_SEPARATOR . 'detail_users';

    $pattern = '/(?:.*_)?detail_report_dirs?_' . preg_quote($who, '/') . '\\.(?:db|json|ndjson)$/i';
    $file_path = find_file_by_pattern($detail_dir, $pattern);
    // Fallback: combined file_db — new format has VIEW dirs appended inside it.
    if (!$file_path || !is_file($file_path)) {
        $combined_pattern = '/(?:.*_)?detail_report_files?_' . preg_quote($who, '/') . '\\.db$/i';
        $file_path = find_file_by_pattern($detail_dir, $combined_pattern);
    }

    if (!$file_path || !is_file($file_path)) {
        b64_success(array('dir' => array(
            'date'        => 0,
            'user'        => $who,
            'total_dirs'  => 0,
            'total_used'  => 0,
            'offset'      => $offset,
            'limit'       => $limit,
            'has_more'    => false,
            'dirs'        => array(),
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
    $has_filters = (!empty($q_matchers) || $filter_min > 0 || $filter_max > 0);

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
        api_handle_dirs_db($file_path, $who, $offset, $limit, $filter_min, $filter_max, $q_array, $has_filters);
    }

    if (preg_match('/\\.ndjson$/i', $file_path)) {
        api_handle_dirs_ndjson($file_path, $who, $offset, $limit, $filter_min, $filter_max, $path_matches, $has_filters);
    }

    // Fast-path: decode whole JSON once (bounded by file size), then filter/paginate in memory.
    $fast_decode_max_bytes = 16777216; // 16 MiB
    $file_size = @filesize($file_path);
    if ($has_filters && $file_size !== false && $file_size > 0 && $file_size <= $fast_decode_max_bytes) {
        $raw = @file_get_contents($file_path);
        if ($raw !== false) {
            $payload = @json_decode($raw, true);
            if (is_array($payload) && isset($payload['dirs']) && is_array($payload['dirs'])) {
                $date = isset($payload['date']) ? (int)$payload['date'] : 0;
                $user_name = isset($payload['user']) ? $payload['user'] : $who;
                $total_used = isset($payload['total_used']) ? (int)$payload['total_used'] : 0;
                $source = $payload['dirs'];

                $collected = array();
                if (!$has_filters) {
                    $total_dirs = isset($payload['total_dirs']) ? (int)$payload['total_dirs'] : count($source);
                    if ($total_dirs < count($source)) $total_dirs = count($source);
                    $slice = array_slice($source, $offset, $limit);
                    foreach ($slice as $obj) $collected[] = api_dirs_normalize_row($obj);
                } else {
                    $filtered_total = 0;
                    foreach ($source as $obj) {
                        if (!is_array($obj)) continue;

                        $usedBytes = isset($obj['used']) ? $obj['used'] : (isset($obj['s']) ? $obj['s'] : 0);
                        if ($filter_min > 0 && $usedBytes < $filter_min) continue;
                        if ($filter_max > 0 && $usedBytes > $filter_max) continue;

                        $pathName = isset($obj['path']) ? $obj['path'] : (isset($obj['n']) ? $obj['n'] : '');
                        $pathNameLc = strtolower($pathName);
                        if (!$path_matches($pathName, $pathNameLc)) continue;

                        if ($filtered_total >= $offset && count($collected) < $limit) {
                            $collected[] = api_dirs_normalize_row($obj);
                        }
                        $filtered_total++;
                    }
                    $total_dirs = $filtered_total;
                }

                $has_more = ($offset + count($collected) < $total_dirs);

                b64_success(array('dir' => array(
                    'date'        => $date,
                    'user'        => $user_name,
                    'total_dirs'  => $total_dirs,
                    'total_used'  => $total_used,
                    'offset'      => $offset,
                    'limit'       => $limit,
                    'has_more'    => $has_more,
                    'dirs'        => $collected,
                )));
            }
        }
    }

    // Streaming fallback for large files or malformed JSON.
    $fh = @fopen($file_path, 'r');

    $date = 0; $user_name = $who; $total_dirs = 0; $total_used = 0;
    while ($fh && ($ln = fgets($fh)) !== false) {
        if      (preg_match('/"date"\\s*:\\s*(\\d+)/',        $ln, $m)) $date        = (int)$m[1];
        elseif  (preg_match('/"user"\\s*:\\s*"([^"]+)"/',    $ln, $m)) $user_name   = $m[1];
        elseif  (preg_match('/"total_dirs"\\s*:\\s*(\\d+)/',  $ln, $m)) $total_dirs  = (int)$m[1];
        elseif  (preg_match('/"total_used"\\s*:\\s*(\\d+)/',  $ln, $m)) $total_used  = (int)$m[1];
        if (strpos($ln, '"dirs"') !== false && strpos($ln, '[') !== false) break;
    }

    if (!$has_filters && $total_dirs > 0 && $offset >= $total_dirs) {
        if ($fh) fclose($fh);
        b64_success(array('dir' => array(
            'date'        => $date,
            'user'        => $user_name,
            'total_dirs'  => $total_dirs,
            'total_used'  => $total_used,
            'offset'      => $offset,
            'limit'       => $limit,
            'has_more'    => false,
            'dirs'        => array(),
        )));
    }

    if ($total_dirs === 0 && $fh) {
        $pos = ftell($fh);
        while (($ln = fgets($fh)) !== false) {
            $total_dirs += substr_count($ln, '{');
        }
        fseek($fh, $pos);
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
                $usedBytes = isset($obj['used']) ? $obj['used'] : (isset($obj['s']) ? $obj['s'] : 0);
                $pathName  = isset($obj['path']) ? $obj['path'] : (isset($obj['n']) ? $obj['n'] : '');
                $pathNameLc = strtolower($pathName);

                if ($filter_min > 0 && $usedBytes < $filter_min) $pass = false;
                if ($filter_max > 0 && $usedBytes > $filter_max) $pass = false;
                if ($pass && !$path_matches($pathName, $pathNameLc)) $pass = false;

                if ($pass) {
                    if ($idx >= $offset && count($collected) < $limit) {
                        $collected[] = api_dirs_normalize_row($obj);
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

    if ($has_filters) $total_dirs = $filtered_total;
    $has_more = ($offset + count($collected) < $total_dirs);

    b64_success(array('dir' => array(
        'date'        => $date,
        'user'        => $user_name,
        'total_dirs'  => $total_dirs,
        'total_used'  => $total_used,
        'offset'      => $offset,
        'limit'       => $limit,
        'has_more'    => $has_more,
        'dirs'        => $collected,
    )));
}
