<?php
// api.php - Disk Usage API (PHP 5.4+)
//
// All endpoints use ?id=<disk_id> (resolved server-side via disks.json).
// The relative path is never exposed to the browser.
//
// Endpoints:
//   ?id=<disk_id>                                       -> main disk reports (plain JSON)
//   ?id=<disk_id>&type=permissions                      -> paginated permission issues (base64 JSON)
//   ?id=<disk_id>&type=permissions&offset=0&limit=100  -> with pagination
//   ?id=<disk_id>&type=permissions&users=alice,bob      -> with user filter
//   ?id=<disk_id>&type=users                            -> list users with detail reports (base64 JSON)
//   ?id=<disk_id>&type=dirs&user=alice                  -> user directory report (base64 JSON)
//   ?id=<disk_id>&type=files&user=alice&offset=0&limit=500 -> paginated file report (base64 JSON)

// =============================================================================
// Helpers
// =============================================================================

function param($key, $default) {
    return isset($_GET[$key]) ? $_GET[$key] : $default;
}

function get_int($key, $default, $min, $max) {
    return min($max, max($min, (int)param($key, $default)));
}

function sanitize_name($raw) {
    return preg_replace('/[^a-zA-Z0-9_\-]/', '', $raw);
}

function b64_success($data) {
    echo base64_encode(json_encode(array('status' => 'success', 'data' => $data)));
    exit;
}

function b64_error($message, $code) {
    http_response_code($code);
    echo base64_encode(json_encode(array('status' => 'error', 'message' => $message)));
    exit;
}

function json_success($data) {
    echo json_encode($data);
    exit;
}

// =============================================================================
// Disk ID → Path resolution (via disks.json)
// =============================================================================

$req_id = sanitize_name(param('id', ''));

if ($req_id === '') {
    http_response_code(400);
    echo 'Missing disk id.';
    exit;
}

$disks_file = __DIR__ . DIRECTORY_SEPARATOR . 'disks.json';
$disks_raw  = @file_get_contents($disks_file);
$disks      = ($disks_raw !== false) ? json_decode($disks_raw, true) : array();

$disk_entry = null;
if (is_array($disks)) {
    foreach ($disks as $d) {
        if (isset($d['id']) && $d['id'] === $req_id) {
            $disk_entry = $d;
            break;
        }
    }
}

if (!$disk_entry || empty($disk_entry['path'])) {
    http_response_code(404);
    echo 'Disk not found.';
    exit;
}

$disk_path = __DIR__ . DIRECTORY_SEPARATOR . trim($disk_entry['path'], '/\\');

if (!is_dir($disk_path) && !is_link($disk_path)) {
    http_response_code(404);
    echo 'Disk directory not found.';
    exit;
}

header('Content-Type: text/plain; charset=utf-8');

$type = param('type', '');

// =============================================================================
// type=permissions  — paginated permission issues
// =============================================================================
if ($type === 'permissions') {
    $offset      = get_int('offset', 0,   0,    PHP_INT_MAX);
    $limit       = get_int('limit',  100, 1,    5000);
    $users_raw   = trim(param('users', ''));
    $user_filter = ($users_raw !== '') ? explode(',', $users_raw) : array();
    $item_type   = trim(param('item_type', ''));   // 'file' | 'directory' | ''
    $path_query  = trim(param('path', ''));         // substring match on path

    // Find newest file matching *permission_issue*.json (singular or plural, any prefix/suffix)
    $perm_file  = null;
    $perm_mtime = 0;
    $dh = @opendir($disk_path);
    while ($dh && ($f = readdir($dh)) !== false) {
        if (substr($f, -5) !== '.json') continue;
        $fl = strtolower($f);
        // Match: permission_issue, permission_issues, or any *permission_issue*.json
        if (strpos($fl, 'permission_issue') !== false) {
            $fp = $disk_path . DIRECTORY_SEPARATOR . $f;
            $mt = @filemtime($fp);
            if ($mt > $perm_mtime) { $perm_file = $fp; $perm_mtime = $mt; }
        }
    }
    if ($dh) closedir($dh);

    if (!$perm_file) {
        b64_success(null);
    }

    $raw_json = @file_get_contents($perm_file);
    if ($raw_json === false) {
        b64_error('Cannot read permission file.', 500);
    }

    $doc = json_decode($raw_json, true);
    $iss = isset($doc['permission_issues']) ? $doc['permission_issues'] : array();

    // Normalize: support both flat (items[]) and old nested (users[].inaccessible_items[])
    if (isset($iss['items'])) {
        $items = $iss['items'];
    } else {
        $items = array();
        $users_list = isset($iss['users']) ? $iss['users'] : array();
        foreach ($users_list as $u) {
            $uname     = isset($u['name']) ? $u['name'] : '';
            $uinaccess = isset($u['inaccessible_items']) ? $u['inaccessible_items'] : array();
            foreach ($uinaccess as $it) {
                $items[] = array(
                    'user'  => $uname,
                    'path'  => isset($it['path'])  ? $it['path']  : '',
                    'type'  => isset($it['type'])  ? $it['type']  : '',
                    'error' => isset($it['error']) ? $it['error'] : '',
                );
            }
        }
        $unknown = isset($iss['unknown_items']) ? $iss['unknown_items'] : array();
        foreach ($unknown as $it) {
            $items[] = array(
                'user'  => '__unknown__',
                'path'  => isset($it['path'])  ? $it['path']  : '',
                'type'  => isset($it['type'])  ? $it['type']  : '',
                'error' => isset($it['error']) ? $it['error'] : '',
            );
        }
    }

    // Build user_summary and error_summary BEFORE filtering (always full totals)
    $user_summary  = array();
    $error_summary = array();
    foreach ($items as $it) {
        $u = isset($it['user'])  ? $it['user']  : '__unknown__';
        $e = isset($it['error']) ? $it['error'] : '';
        $user_summary[$u] = isset($user_summary[$u]) ? $user_summary[$u] + 1 : 1;
        if ($e !== '') {
            $error_summary[$e] = isset($error_summary[$e]) ? $error_summary[$e] + 1 : 1;
        }
    }

    // Apply user filter
    if (!empty($user_filter)) {
        $uf    = $user_filter;
        $items = array_values(array_filter($items, function ($it) use ($uf) {
            return in_array(isset($it['user']) ? $it['user'] : '', $uf);
        }));
    }

    // Apply item_type filter (file | directory)
    if ($item_type === 'file' || $item_type === 'directory') {
        $it_type = $item_type;
        $items   = array_values(array_filter($items, function ($it) use ($it_type) {
            return (isset($it['type']) ? $it['type'] : '') === $it_type;
        }));
    }

    // Apply path substring filter (case-insensitive)
    if ($path_query !== '') {
        $pq    = strtolower($path_query);
        $items = array_values(array_filter($items, function ($it) use ($pq) {
            return strpos(strtolower(isset($it['path']) ? $it['path'] : ''), $pq) !== false;
        }));
    }

    $total    = count($items);
    $page     = array_slice($items, $offset, $limit);
    $has_more = ($offset + count($page)) < $total;

    b64_success(array(
        'date'          => isset($doc['date'])      ? $doc['date']      : null,
        'directory'     => isset($doc['directory']) ? $doc['directory'] : null,
        'total'         => $total,
        'offset'        => $offset,
        'limit'         => $limit,
        'has_more'      => $has_more,
        'items'         => $page,
        'user_summary'  => $user_summary,
        'error_summary' => $error_summary,
    ));
}

// =============================================================================
// type=users  — list users with detail reports
// =============================================================================
if ($type === 'users') {
    $detail_dir = $disk_path . DIRECTORY_SEPARATOR . 'detail_users';
    $users = array();
    if (is_dir($detail_dir)) {
        $dh = @opendir($detail_dir);
        while ($dh && ($f = readdir($dh)) !== false) {
            if (preg_match('/^detail_report_dir_(.+)\.json$/', $f, $m)) {
                $users[] = $m[1];
            }
        }
        if ($dh) closedir($dh);
        sort($users);
    }
    b64_success(array('users' => $users));
}

// =============================================================================
// type=dirs  — full directory report for a user
// =============================================================================
if ($type === 'dirs') {
    $who       = sanitize_name(param('user', ''));
    $detail_dir = $disk_path . DIRECTORY_SEPARATOR . 'detail_users';
    $file_path  = $detail_dir . DIRECTORY_SEPARATOR . 'detail_report_dir_' . $who . '.json';

    if (!is_file($file_path)) {
        b64_error('No directory report for user: ' . $who, 404);
    }

    $c = file_get_contents($file_path);
    b64_success(array('dir' => ($c !== false) ? json_decode($c, true) : null));
}

// =============================================================================
// type=files  — paginated file report for a user (line-by-line streaming)
// =============================================================================
if ($type === 'files') {
    $who        = sanitize_name(param('user', ''));
    $offset     = get_int('offset', 0,   0,    PHP_INT_MAX);
    $limit      = get_int('limit',  500, 1,    2000);
    $detail_dir = $disk_path . DIRECTORY_SEPARATOR . 'detail_users';
    $file_path  = $detail_dir . DIRECTORY_SEPARATOR . 'detail_report_file_' . $who . '.json';

    if (!is_file($file_path)) {
        b64_error('No file report for user: ' . $who, 404);
    }

    $fh = @fopen($file_path, 'r');

    // Read header fields before the "files" array
    $date = 0; $user_name = $who; $total_files = 0; $total_used = 0;
    while ($fh && ($ln = fgets($fh)) !== false) {
        if      (preg_match('/"date"\s*:\s*(\d+)/',        $ln, $m)) $date        = (int)$m[1];
        elseif  (preg_match('/"user"\s*:\s*"([^"]+)"/',    $ln, $m)) $user_name   = $m[1];
        elseif  (preg_match('/"total_files"\s*:\s*(\d+)/', $ln, $m)) $total_files = (int)$m[1];
        elseif  (preg_match('/"total_used"\s*:\s*(\d+)/',  $ln, $m)) $total_used  = (int)$m[1];
        if (strpos($ln, '"files"') !== false && strpos($ln, '[') !== false) break;
    }

    // Stream items with brace-depth parser — O(page_size) RAM
    $idx = 0; $collected = array(); $buf = ''; $depth = 0;
    while ($fh && ($ln = fgets($fh)) !== false) {
        $trimmed = trim($ln);
        if ($trimmed === ']' || $trimmed === '];') break;
        if ($trimmed === '' || $trimmed === '[')   continue;

        $buf   .= $ln;
        $depth += substr_count($ln, '{') - substr_count($ln, '}');

        if ($depth <= 0 && ltrim($buf) !== '') {
            $obj = @json_decode(rtrim(trim($buf), ','), true);
            if ($obj !== null && is_array($obj)) {
                if ($idx >= $offset && count($collected) < $limit) {
                    $collected[] = $obj;
                }
                $idx++;
                if (count($collected) >= $limit && $idx >= $offset + $limit) break;
            }
            $buf = ''; $depth = 0;
        }
    }
    if ($fh) fclose($fh);

    b64_success(array('file' => array(
        'date'        => $date,
        'user'        => $user_name,
        'total_files' => $total_files,
        'total_used'  => $total_used,
        'offset'      => $offset,
        'limit'       => $limit,
        'has_more'    => count($collected) >= $limit,
        'files'       => $collected,
    )));
}

// =============================================================================
// Default  — aggregate all disk usage report JSON files (plain JSON)
// =============================================================================
$dh    = @opendir($disk_path);
$files = array();
while ($dh && ($f = readdir($dh)) !== false) {
    if (substr($f, -5) !== '.json') continue;
    $fl = strtolower($f);
    // Exclude non-report files
    if (strpos($fl, 'permission_issue') !== false) continue;
    if (strpos($fl, 'detail_report')    !== false) continue;
    // Match: *disk_usage_report*, *report_*, *usage_report* (wildcard-style)
    $is_report = strpos($fl, 'disk_usage_report') !== false
              || strpos($fl, 'usage_report')       !== false
              || strpos($f,  'report_') === 0  // legacy: report_YYYY-MM-DD.json
              || preg_match('/^report[_-]/i', $f); // report- prefix
    if ($is_report) {
        $files[] = $disk_path . DIRECTORY_SEPARATOR . $f;
    }
}
if ($dh) closedir($dh);
sort($files);

$agg = array();
foreach ($files as $file) {
    $c = file_get_contents($file);
    if ($c === false) continue;
    $j = json_decode($c, true);
    if ($j !== null) $agg[] = $j;
}

header('Cache-Control: public, max-age=60');
json_success(array(
    'status'      => 'success',
    'total_files' => count($agg),
    'data'        => $agg,
));
