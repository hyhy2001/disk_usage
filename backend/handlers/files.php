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

    $pattern = '/(?:.*_)?detail_report_files?_' . preg_quote($who, '/') . '\\.(?:json|ndjson)$/i';
    $file_path = find_file_by_pattern($detail_dir, $pattern);

    if (!$file_path || !is_file($file_path)) {
        b64_error('No file report for user: ' . $who, 404);
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
