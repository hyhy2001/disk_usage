<?php

function api_dirs_normalize_row($obj) {
    if (!is_array($obj)) return array('path' => '', 'used' => 0);
    $path = isset($obj['path']) ? $obj['path'] : (isset($obj['n']) ? $obj['n'] : '');
    $used = isset($obj['used']) ? $obj['used'] : (isset($obj['s']) ? $obj['s'] : 0);
    $obj['path'] = $path;
    $obj['used'] = (int)$used;
    return $obj;
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
    $limit      = get_int('limit',  500, 1,    50000);
    $filter_q   = strtolower(trim(param('filter_query', '')));
    $filter_min = get_int('filter_min_size', 0, 0, PHP_INT_MAX);
    $filter_max = get_int('filter_max_size', 0, 0, PHP_INT_MAX);
    $detail_dir = $disk_path . DIRECTORY_SEPARATOR . 'detail_users';

    $pattern = '/(?:.*_)?detail_report_dirs?_' . preg_quote($who, '/') . '\\.(?:json|ndjson)$/i';
    $file_path = find_file_by_pattern($detail_dir, $pattern);

    if (!$file_path || !is_file($file_path)) {
        b64_error('No directory report for user: ' . $who, 404);
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

    if (preg_match('/\\.ndjson$/i', $file_path)) {
        api_handle_dirs_ndjson($file_path, $who, $offset, $limit, $filter_min, $filter_max, $path_matches, $has_filters);
    }

    // Fast-path: decode whole JSON once (bounded by file size), then filter/paginate in memory.
    $fast_decode_max_bytes = 33554432; // 32 MiB
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
