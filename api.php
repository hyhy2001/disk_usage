<?php
ob_start('ob_gzhandler');
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

function get_b64_param($key, $default) {
    $b64_key = $key . '_b64';
    if (isset($_GET[$b64_key])) {
        return base64_decode($_GET[$b64_key]);
    }
    return param($key, $default);
}

function get_int($key, $default, $min, $max) {
    return min($max, max($min, (int)param($key, $default)));
}

function sanitize_name($raw) {
    $raw = str_replace(array('../', '..\\'), '', $raw);
    return preg_replace('/[^a-zA-Z0-9_\-\.\@\$\s]/', '', $raw);
}

function b64_success($data) {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array('status' => 'success', 'data' => $data));
    exit;
}

function b64_error($message, $code) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array('status' => 'error', 'message' => $message));
    exit;
}

function json_success($data) {
    echo json_encode($data);
    exit;
}

function get_json_date($fp) {
    if ($fh = @fopen($fp, 'r')) {
        $header = fread($fh, 8192);
        fclose($fh);
        if (preg_match('/"date"\s*:\s*(\d+)/', $header, $m)) {
            return (int)$m[1];
        }
    }
    return 0;
}

// =============================================================================
// Disk ID → Path resolution (via disks.json)
// =============================================================================

$req_id = sanitize_name(param('id', ''));
$type   = param('type', '');

// Handle type=disks (No disk id required)
// Returns nested structure without system path
if ($type === 'disks') {
    $disks_file = __DIR__ . DIRECTORY_SEPARATOR . 'disks.json';
    $disks_raw  = @file_get_contents($disks_file);
    $disks      = ($disks_raw !== false) ? json_decode($disks_raw, true) : array();
    
    $safe_disks = array();
    if (is_array($disks)) {
        foreach ($disks as $p_or_d) {
            if (isset($p_or_d['id'])) {
                // Legacy Flat Format fallback
                $safe_disks[] = array(
                    'id'   => $p_or_d['id'],
                    'name' => isset($p_or_d['name']) ? $p_or_d['name'] : ''
                );
                } elseif (isset($p_or_d['project'])) {
                    // Nested Format (Project Wrapped)
                    $proj = array('project' => $p_or_d['project']);
                    $safe_teams = array();
                    if (isset($p_or_d['teams']) && is_array($p_or_d['teams'])) {
                        foreach ($p_or_d['teams'] as $t) {
                            $team = array('name' => isset($t['name']) ? $t['name'] : 'Unknown');
                            $safe_disk_list = array();
                            if (isset($t['disks']) && is_array($t['disks'])) {
                                foreach ($t['disks'] as $d) {
                                    $safe_disk_list[] = array(
                                        'id'   => isset($d['id']) ? $d['id'] : '',
                                        'name' => isset($d['name']) ? $d['name'] : ''
                                    );
                                }
                            }
                            $team['disks'] = $safe_disk_list;
                            $safe_teams[] = $team;
                        }
                    }
                    $proj['teams'] = $safe_teams;
                    $safe_disks[] = $proj;
                } elseif (isset($p_or_d['name']) && isset($p_or_d['disks'])) {
                    // Standalone Team Format
                    $team = array('name' => $p_or_d['name']);
                    $safe_disk_list = array();
                    if (is_array($p_or_d['disks'])) {
                        foreach ($p_or_d['disks'] as $d) {
                            $safe_disk_list[] = array(
                                'id'   => isset($d['id']) ? $d['id'] : '',
                                'name' => isset($d['name']) ? $d['name'] : ''
                            );
                        }
                    }
                    $team['disks'] = $safe_disk_list;
                    $safe_disks[] = $team;
                }
        }
    }
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($safe_disks);
    exit;
}

// =============================================================================
// type=team - Aggregate the latest report for all disks in a team
// =============================================================================
if ($type === 'team') {
    $team_name = trim(param('name', ''));
    if ($team_name === '') b64_error('Missing team name', 400);

    $disks_file = __DIR__ . DIRECTORY_SEPARATOR . 'disks.json';
    $disks_raw  = @file_get_contents($disks_file);
    $disks      = ($disks_raw !== false) ? json_decode($disks_raw, true) : array();
    
    $team_disks = array();
    if (is_array($disks)) {
        foreach ($disks as $p_or_d) {
            if (isset($p_or_d['teams']) && is_array($p_or_d['teams'])) {
                foreach ($p_or_d['teams'] as $t) {
                    if (isset($t['name']) && $t['name'] === $team_name) {
                        if (isset($t['disks']) && is_array($t['disks'])) {
                            foreach ($t['disks'] as $d) {
                                $team_disks[] = $d;
                            }
                        }
                    }
                }
            }
            if (isset($p_or_d['name']) && $p_or_d['name'] === $team_name) {
                if (isset($p_or_d['disks']) && is_array($p_or_d['disks'])) {
                    foreach ($p_or_d['disks'] as $d) {
                        $team_disks[] = $d;
                    }
                }
            }
        }
    }
    
    if (empty($team_disks)) b64_error('Team not found or has no disks', 404);
    
    $result_data = array();
    
    foreach ($team_disks as $d) {
        if (empty($d['path'])) continue;
        $disk_path = __DIR__ . DIRECTORY_SEPARATOR . trim($d['path'], '/\\');
        if (!is_dir($disk_path)) continue;
        
        $dh    = @opendir($disk_path);
        $files = array();
        while ($dh && ($f = readdir($dh)) !== false) {
            if (substr($f, -5) !== '.json') continue;
            $fl = strtolower($f);
            if (strpos($fl, 'permission_issue') !== false) continue;
            if (strpos($fl, 'detail_report')    !== false) continue;
            
            $is_report = strpos($fl, 'disk_usage_report') !== false
                      || strpos($fl, 'usage_report')       !== false
                      || strpos($f,  'report_') === 0 
                      || preg_match('/^report[_-]/i', $f);
            if ($is_report) $files[] = $disk_path . DIRECTORY_SEPARATOR . $f;
        }
        if ($dh) closedir($dh);
        
        $latest = false;
        $max_date = -1;
        foreach ($files as $f) {
            $file_date = get_json_date($f);
            if ($file_date > $max_date) {
                $max_date = $file_date;
                $latest = $f;
            }
        }
        
        if ($latest) {
            $json = @file_get_contents($latest);
            $parsed = @json_decode($json, true);
            if ($parsed && is_array($parsed)) {
                $summary = array();
                $summary['_disk_id'] = isset($d['id']) ? $d['id'] : '';
                $summary['_disk_name'] = isset($d['name']) ? $d['name'] : 'Unknown Disk';
                $summary['_disk_path'] = '***';
                $summary['general_system'] = isset($parsed['general_system']) ? $parsed['general_system'] : array();
                $summary['team_usage'] = isset($parsed['team_usage']) ? $parsed['team_usage'] : array();
                $summary['date'] = isset($parsed['date']) ? $parsed['date'] : 0;
                $summary['directory'] = isset($parsed['directory']) ? $parsed['directory'] : '';
                $result_data[] = $summary;
            }
        }
    }
    
    header('Cache-Control: public, max-age=15'); // Short cache for team overview
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array('status' => 'success', 'team' => $team_name, 'data' => $result_data));
    exit;
}

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
    foreach ($disks as $p_or_d) {
        if (isset($p_or_d['id']) && $p_or_d['id'] === $req_id) {
            $disk_entry = $p_or_d; // Flat fallback
            break;
        }
        if (isset($p_or_d['teams']) && is_array($p_or_d['teams'])) {
            foreach ($p_or_d['teams'] as $t) {
                if (isset($t['disks']) && is_array($t['disks'])) {
                    foreach ($t['disks'] as $d) {
                        if (isset($d['id']) && $d['id'] === $req_id) {
                            $d['project'] = isset($p_or_d['project']) ? $p_or_d['project'] : '';
                            $d['team']    = isset($t['name']) ? $t['name'] : '';
                            $disk_entry = $d;
                            break 3; // Break out of all 3 loops
                        }
                    }
                }
            }
        }
        if (isset($p_or_d['disks']) && is_array($p_or_d['disks'])) {
            foreach ($p_or_d['disks'] as $d) {
                if (isset($d['id']) && $d['id'] === $req_id) {
                    $d['project'] = ''; // Standalone team has no project
                    $d['team']    = isset($p_or_d['name']) ? $p_or_d['name'] : '';
                    $disk_entry = $d;
                    break 2; // Break out of all 2 loops
                }
            }
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
            $d = get_json_date($fp);
            if ($d > $perm_mtime) { $perm_file = $fp; $perm_mtime = $d; }
        }
    }
    if ($dh) closedir($dh);

    if (!$perm_file) {
        b64_success(null);
    }

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

// =============================================================================
// type=users  — list users with detail reports
// =============================================================================
if ($type === 'users') {
    $detail_dir = $disk_path . DIRECTORY_SEPARATOR . 'detail_users';
    $users = array();
    if (is_dir($detail_dir)) {
        $dh = @opendir($detail_dir);
        while ($dh && ($f = readdir($dh)) !== false) {
            // Match detail_report_dir_*.json or detail_report_dirs_*.json, with optional prefix
            if (preg_match('/(?:.*_)?detail_report_dirs?_(.+)\.json$/', $f, $m)) {
                $users[] = $m[1];
            }
        }
        if ($dh) closedir($dh);
        
        // Deduplicate because multiple prefixes might generate same usernames
        $users = array_unique($users);
        sort($users);
    }
    b64_success(array('users' => $users));
}

// Helper to find a file by pattern in a directory (latest by date field)
function find_file_by_pattern($dir, $pattern) {
    if (!is_dir($dir)) return false;
    $dh = @opendir($dir);
    $found = false;
    $max_date = -1;
    while ($dh && ($f = readdir($dh)) !== false) {
        if (preg_match($pattern, $f)) {
            $fp = $dir . DIRECTORY_SEPARATOR . $f;
            $d = get_json_date($fp);
            if ($d > $max_date) {
                $max_date = $d;
                $found = $fp;
            }
        }
    }
    if ($dh) closedir($dh);
    return $found;
}

// =============================================================================
// type=dirs  — full directory report for a user
// =============================================================================
if ($type === 'dirs') {
    $who        = sanitize_name(get_b64_param('user', ''));
    $offset     = get_int('offset', 0,   0,    PHP_INT_MAX);
    $limit      = get_int('limit',  500, 1,    2000000);
    $detail_dir = $disk_path . DIRECTORY_SEPARATOR . 'detail_users';
    
    // Look for file ending in detail_report_dir_{user}.json or detail_report_dirs_{user}.json, prefixed optionally
    $pattern = '/(?:.*_)?detail_report_dirs?_' . preg_quote($who, '/') . '\.json$/';
    $file_path = find_file_by_pattern($detail_dir, $pattern);

    if (!$file_path || !is_file($file_path)) {
        b64_error('No directory report for user: ' . $who, 404);
    }

    $fh = @fopen($file_path, 'r');

    // Read header fields before the "dirs" array
    $date = 0; $user_name = $who; $total_dirs = 0; $total_used = 0;
    while ($fh && ($ln = fgets($fh)) !== false) {
        if      (preg_match('/"date"\s*:\s*(\d+)/',        $ln, $m)) $date        = (int)$m[1];
        elseif  (preg_match('/"user"\s*:\s*"([^"]+)"/',    $ln, $m)) $user_name   = $m[1];
        elseif  (preg_match('/"total_dirs"\s*:\s*(\d+)/',  $ln, $m)) $total_dirs  = (int)$m[1];
        elseif  (preg_match('/"total_used"\s*:\s*(\d+)/',  $ln, $m)) $total_used  = (int)$m[1];
        if (strpos($ln, '"dirs"') !== false && strpos($ln, '[') !== false) break;
    }

    // Fast O(1) RAM scan to count entries if total_dirs is missing from header
    if ($total_dirs === 0 && $fh) {
        $pos = ftell($fh);
        while (($ln = fgets($fh)) !== false) {
            $total_dirs += substr_count($ln, '{');
        }
        fseek($fh, $pos);
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
            if ($idx >= $offset && count($collected) < $limit) {
                $obj = @json_decode(rtrim(trim($buf), ','), true);
                if ($obj !== null && is_array($obj)) {
                    $collected[] = $obj;
                }
            }
            $idx++;
            if (count($collected) >= $limit) break;
            $buf = ''; $depth = 0;
        }
    }
    if ($fh) fclose($fh);

    b64_success(array('dir' => array(
        'date'        => $date,
        'user'        => $user_name,
        'total_dirs'  => $total_dirs,
        'total_used'  => $total_used,
        'offset'      => $offset,
        'limit'       => $limit,
        'has_more'    => count($collected) >= $limit,
        'dirs'        => $collected,
    )));
}

// =============================================================================
// type=files  — paginated file report for a user (line-by-line streaming)
// =============================================================================
if ($type === 'files') {
    $who        = sanitize_name(get_b64_param('user', ''));
    $offset     = get_int('offset', 0,   0,    PHP_INT_MAX);
    $limit      = get_int('limit',  500, 1,    2000000);
    $detail_dir = $disk_path . DIRECTORY_SEPARATOR . 'detail_users';
    
    // Look for file ending in detail_report_file_{user}.json or detail_report_files_{user}.json, prefixed optionally
    $pattern = '/(?:.*_)?detail_report_files?_' . preg_quote($who, '/') . '\.json$/';
    $file_path = find_file_by_pattern($detail_dir, $pattern);

    if (!$file_path || !is_file($file_path)) {
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
            if ($idx >= $offset && count($collected) < $limit) {
                $obj = @json_decode(rtrim(trim($buf), ','), true);
                if ($obj !== null && is_array($obj)) {
                    $collected[] = $obj;
                }
            }
            $idx++;
            if (count($collected) >= $limit) break;
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

$file_dates = array();
foreach ($files as $f) {
    $file_dates[$f] = get_json_date($f);
}
usort($files, function($a, $b) use ($file_dates) {
    return $file_dates[$a] - $file_dates[$b];
});

header('Cache-Control: public, max-age=60');
header('Content-Type: application/json; charset=utf-8');

echo '{"status":"success","total_files":' . count($files) . ',"data":[';
$first = true;
foreach ($files as $file) {
    // Dump the raw JSON file text directly into the array structure
    $raw_json = @file_get_contents($file);
    if ($raw_json) {
        if (!$first) echo ',';
        echo $raw_json;
        $first = false;
    }
}
echo ']}';
exit;
