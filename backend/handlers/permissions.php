<?php

function api_handle_permissions($disk_path) {
    $offset      = get_int('offset', 0,   0,    PHP_INT_MAX);
    $limit       = get_int('limit',  100, 1,    5000);
    $users_raw   = trim(param('users', ''));
    $user_filter = ($users_raw !== '') ? explode(',', $users_raw) : array();
    $item_type   = trim(param('item_type', ''));
    $path_query  = trim(param('path', ''));

    $perm_file  = null;
    $perm_mtime = 0;
    $dh = @opendir($disk_path);
    while ($dh && ($f = readdir($dh)) !== false) {
        if (substr($f, -5) !== '.json') continue;
        $fl = strtolower($f);
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
