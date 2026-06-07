<?php
// permissions.php — Disk-permission issues report.
//
// Two storage backends supported, in priority order:
//
//   1. SQLite `permission_issues.db` (preferred — produced by check_disk
//      Rust scanner v3+). Pagination + filtering done by SQL → constant
//      memory regardless of dataset size, no full-file scan per request.
//
//   2. JSON `permission_issues*.json` (legacy — produced by older scanner
//      versions). Streaming parser scans the whole file every request;
//      used as a fallback when the DB doesn't exist yet.
//
// Both backends return the same JSON shape so the frontend never needs
// to know which one served the request.

function api_perm_db_path($disk_path) {
    $p = $disk_path . DIRECTORY_SEPARATOR . DU_PERMISSION_DB_FILENAME;
    return is_file($p) ? $p : false;
}

function api_perm_open_db($disk_path) {
    static $cache = array();
    $key = (string)$disk_path;
    if (array_key_exists($key, $cache)) return $cache[$key];

    $db = api_perm_db_path($disk_path);
    if (!$db) return $cache[$key] = false;

    try {
        $pdo = new PDO('sqlite:' . $db);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        api_db_apply_read_pragmas($pdo);
    } catch (Exception $e) {
        return $cache[$key] = false;
    }
    return $cache[$key] = $pdo;
}

function api_perm_meta($pdo, $key) {
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

// Build WHERE clause + bind values from request filters.
// $user_filter: array of usernames (empty = no filter)
// $item_type:   'file' | 'directory' | '' (empty = no filter)
// $path_query:  substring filter on path (case-insensitive)
function api_perm_build_where($user_filter, $item_type, $path_query, &$bind) {
    $clauses = array();
    if (!empty($user_filter)) {
        $place = implode(',', array_fill(0, count($user_filter), '?'));
        $clauses[] = 'user IN (' . $place . ')';
        foreach ($user_filter as $u) $bind[] = (string)$u;
    }
    if ($item_type !== '') {
        $clauses[] = 'item_type = ?';
        $bind[] = $item_type;
    }
    if ($path_query !== '') {
        $clauses[] = 'path LIKE ? COLLATE NOCASE';
        $bind[] = '%' . $path_query . '%';
    }
    return empty($clauses) ? '1' : implode(' AND ', $clauses);
}

// Aggregated user/error counts. UNFILTERED — these reflect the whole
// dataset so the sidebar always shows the true totals regardless of
// what the user has filtered down to in the main list.
function api_perm_summaries($pdo) {
    $user_summary = array();
    $error_summary = array();
    try {
        foreach ($pdo->query('SELECT user, COUNT(*) AS c FROM issues GROUP BY user')->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $user_summary[(string)$r['user']] = (int)$r['c'];
        }
        foreach ($pdo->query('SELECT error, COUNT(*) AS c FROM issues GROUP BY error')->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $error_summary[(string)$r['error']] = (int)$r['c'];
        }
    } catch (Exception $e) {}
    return array($user_summary, $error_summary);
}

function api_handle_permissions_db($pdo, $offset, $limit, $user_filter, $item_type, $path_query) {
    $bind = array();
    $where = api_perm_build_where($user_filter, $item_type, $path_query, $bind);

    try {
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM issues WHERE ' . $where);
        $stmt->execute($bind);
        $total = (int)$stmt->fetchColumn();

        $stmt = $pdo->prepare(
            'SELECT user, item_type AS type, error, path FROM issues '
            . 'WHERE ' . $where . ' ORDER BY id LIMIT ? OFFSET ?'
        );
        $bind2 = $bind;
        $bind2[] = (int)$limit;
        $bind2[] = (int)$offset;
        $stmt->execute($bind2);
        $page = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Exception $e) {
        // Log full error server-side; return generic message to client.
        error_log('permission DB query failed: ' . $e->getMessage());
        b64_error('Permission DB query failed.', 500);
    }

    list($user_summary, $error_summary) = api_perm_summaries($pdo);

    b64_success(array(
        'date'          => (int)api_perm_meta($pdo, 'date'),
        'directory'     => api_perm_meta($pdo, 'directory'),
        'total'         => $total,
        'offset'        => $offset,
        'limit'         => $limit,
        'has_more'      => ($offset + count($page)) < $total,
        'items'         => $page,
        'user_summary'  => $user_summary,
        'error_summary' => $error_summary,
    ));
}

// JSON fallback — kept for backward compatibility with older scanner output.
function api_handle_permissions_json($perm_file, $offset, $limit, $user_filter, $item_type, $path_query) {
    $fh = @fopen($perm_file, 'r');
    if (!$fh) {
        b64_error('Cannot read permission file.', 500);
    }

    $date          = null;
    $directory     = null;
    $current_user  = '__unknown__';
    $total         = 0;
    $user_summary  = array();
    $error_summary = array();
    $page          = array();

    $in_string = false;
    $escape    = false;
    $depth     = 0;

    $obj_depth = 0;
    $obj_buf   = '';
    $recording = false;
    $window    = '';

    while (($ln = fgets($fh)) !== false) {
        if ($date === null && preg_match('/"date"\s*:\s*(\d+)/', $ln, $m)) $date = (int)$m[1];
        if ($directory === null && preg_match('/"directory"\s*:\s*"([^"]+)"/', $ln, $m)) $directory = $m[1];

        $len = strlen($ln);
        for ($i = 0; $i < $len; $i++) {
            $c = $ln[$i];

            $window .= $c;
            if (strlen($window) > 200) $window = substr($window, -100);

            if ($escape) {
                $escape = false;
            } elseif ($c === '\\') {
                $escape = true;
            } elseif ($c === '"') {
                $in_string = !$in_string;
            }

            if (!$in_string) {
                if ($c === '{') {
                    $depth++;
                    $recording = true;
                    $obj_depth = $depth;
                    $obj_buf   = '{';
                    continue;
                } elseif ($c === '}') {
                    if ($recording && $depth === $obj_depth) {
                        $obj_buf .= '}';
                        $recording = false;

                        if (strpos($obj_buf, '"error"') !== false && strpos($obj_buf, '"path"') !== false) {
                            $e = ''; $t = ''; $p = ''; $u = $current_user;
                            if (preg_match('/"error"\s*:\s*"((?:[^"\\\\]|\\\\.)*)"/', $obj_buf, $m)) $e = @json_decode('"' . $m[1] . '"');
                            if (preg_match('/"type"\s*:\s*"((?:[^"\\\\]|\\\\.)*)"/', $obj_buf, $m)) $t = @json_decode('"' . $m[1] . '"');
                            if (preg_match('/"path"\s*:\s*"((?:[^"\\\\]|\\\\.)*)"/', $obj_buf, $m)) $p = @json_decode('"' . $m[1] . '"');
                            if (preg_match('/"user"\s*:\s*"((?:[^"\\\\]|\\\\.)*)"/', $obj_buf, $m)) $u = @json_decode('"' . $m[1] . '"');

                            if ($p !== '' && $e !== '') {
                                $user_summary[$u] = isset($user_summary[$u]) ? $user_summary[$u] + 1 : 1;
                                $error_summary[$e] = isset($error_summary[$e]) ? $error_summary[$e] + 1 : 1;

                                $pass_user = empty($user_filter) || in_array($u, $user_filter);
                                $pass_type = ($item_type === '' || $t === $item_type);
                                $pass_path = ($path_query === '' || stripos($p, $path_query) !== false);

                                if ($pass_user && $pass_type && $pass_path) {
                                    if ($total >= $offset && count($page) < $limit) {
                                        $item = @json_decode($obj_buf, true);
                                        if (is_array($item)) {
                                            $item['user'] = $u;
                                            $page[] = $item;
                                        }
                                    }
                                    $total++;
                                }
                            }
                        }
                        $obj_buf = '';
                    }
                    $depth--;
                    continue;
                }
            }

            if ($recording) {
                $obj_buf .= $c;
            }

            if ($c === '"' && preg_match('/"name"\s*:\s*"([^"]+)"$/', $window, $m)) {
                $current_user = $m[1];
            } elseif ($c === '[' && preg_match('/"unknown_items"\s*:\s*\[$/', $window)) {
                $current_user = '__unknown__';
            }
        }
    }
    if ($fh) fclose($fh);

    $has_more = ($offset + count($page)) < $total;

    b64_success(array(
        'date'          => $date,
        'directory'     => $directory,
        'total'         => $total,
        'offset'        => $offset,
        'limit'         => $limit,
        'has_more'      => $has_more,
        'items'         => $page,
        'user_summary'  => $user_summary,
        'error_summary' => $error_summary,
    ));
}

function api_handle_permissions($disk_path) {
    $offset      = get_int('offset', 0,   0,    PHP_INT_MAX);
    $limit       = get_int('limit',  100, 1,    5000);
    $users_raw   = trim(param('users', ''));
    $user_filter = ($users_raw !== '') ? explode(',', $users_raw) : array();
    $item_type   = trim(param('item_type', ''));
    $path_query  = trim(param('path', ''));

    // Prefer SQLite when available — constant memory + indexed filters.
    $pdo = api_perm_open_db($disk_path);
    if ($pdo) {
        api_handle_permissions_db($pdo, $offset, $limit, $user_filter, $item_type, $path_query);
        return;
    }

    // Fallback to streaming JSON parser.
    $perm_file = find_file_by_pattern($disk_path, DU_PERMISSION_REPORT_PATTERN);
    if (!$perm_file) {
        b64_success(null);
    }
    api_handle_permissions_json($perm_file, $offset, $limit, $user_filter, $item_type, $path_query);
}
