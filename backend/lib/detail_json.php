<?php

function api_detail_json_load($path) {
    $raw = @file_get_contents($path);
    if ($raw === false) return false;
    $json = @json_decode($raw, true);
    return is_array($json) ? $json : false;
}

function api_detail_manifest_path($disk_path) {
    return $disk_path . DIRECTORY_SEPARATOR . 'detail_users' . DIRECTORY_SEPARATOR . 'data_detail.json';
}

function api_detail_empty_dir($who, $offset, $limit) {
    return array('date' => 0, 'user' => $who, 'total_dirs' => 0, 'total_used' => 0, 'offset' => $offset, 'limit' => $limit, 'has_more' => false, 'dirs' => array());
}

function api_detail_empty_file($who, $offset, $limit) {
    return array('date' => 0, 'user' => $who, 'total_files' => 0, 'total_used' => 0, 'offset' => $offset, 'limit' => $limit, 'has_more' => false, 'files' => array());
}

function api_detail_find_user_context($disk_path, $who) {
    $root_path = api_detail_manifest_path($disk_path);
    if (!is_file($root_path)) return false;
    $root = api_detail_json_load($root_path);
    if (!is_array($root) || !isset($root['users']) || !is_array($root['users'])) return false;

    $entry = false;
    foreach ($root['users'] as $u) {
        if (is_array($u) && isset($u['username']) && (string)$u['username'] === (string)$who) {
            $entry = $u;
            break;
        }
    }
    if (!$entry || empty($entry['manifest'])) return false;

    $detail_dir = dirname($root_path);
    $manifest_path = $detail_dir . DIRECTORY_SEPARATOR . str_replace(array('/', '\\'), DIRECTORY_SEPARATOR, $entry['manifest']);
    if (!is_file($manifest_path)) return false;
    $manifest = api_detail_json_load($manifest_path);
    if (!is_array($manifest)) return false;

    return array(
        'root_path' => $root_path,
        'root' => $root,
        'entry' => $entry,
        'manifest_path' => $manifest_path,
        'manifest' => $manifest,
        'user_dir' => dirname($manifest_path),
    );
}

function api_detail_date($ctx) {
    if (isset($ctx['manifest']['scan_date'])) return (int)$ctx['manifest']['scan_date'];
    if (isset($ctx['root']['scan']['timestamp'])) return (int)$ctx['root']['scan']['timestamp'];
    return 0;
}

function api_detail_summary_value($ctx, $key, $fallback_key, $default) {
    if (isset($ctx['manifest']['summary']) && is_array($ctx['manifest']['summary']) && isset($ctx['manifest']['summary'][$key])) {
        return (int)$ctx['manifest']['summary'][$key];
    }
    if (isset($ctx['entry'][$fallback_key])) return (int)$ctx['entry'][$fallback_key];
    // Support compact root manifest keys from current check_disk output:
    // entry.dirs / entry.files / entry.used
    if ($key === 'total_dirs' && isset($ctx['entry']['dirs'])) return (int)$ctx['entry']['dirs'];
    if ($key === 'total_files' && isset($ctx['entry']['files'])) return (int)$ctx['entry']['files'];
    if ($key === 'total_used' && isset($ctx['entry']['used'])) return (int)$ctx['entry']['used'];
    return $default;
}

function api_detail_normalize_dir($obj) {
    if (!is_array($obj)) return array('path' => '', 'used' => 0);
    $path = isset($obj['path'])
        ? $obj['path']
        : (isset($obj['p']) ? $obj['p'] : (isset($obj['n']) ? $obj['n'] : ''));
    $used = isset($obj['used']) ? $obj['used'] : (isset($obj['s']) ? $obj['s'] : 0);
    return array('path' => (string)$path, 'used' => (int)$used);
}

function api_detail_normalize_file($obj) {
    if (!is_array($obj)) return array('path' => '', 'size' => 0, 'xt' => '');
    $path = isset($obj['path'])
        ? $obj['path']
        : (isset($obj['p']) ? $obj['p'] : (isset($obj['n']) ? $obj['n'] : ''));
    $size = isset($obj['size']) ? $obj['size'] : (isset($obj['s']) ? $obj['s'] : 0);
    $xt = isset($obj['xt'])
        ? $obj['xt']
        : (isset($obj['x']) ? $obj['x'] : (isset($obj['ext']) ? $obj['ext'] : pathinfo($path, PATHINFO_EXTENSION)));
    return array('path' => (string)$path, 'size' => (int)$size, 'xt' => strtolower((string)$xt));
}

function api_detail_filter_matchers($filter_q) {
    $q_array = $filter_q !== '' ? array_values(array_filter(array_map('trim', explode(',', strtolower($filter_q))), 'strlen')) : array();
    $matchers = array();
    foreach ($q_array as $q) {
        if (strpos($q, '*') === false) $matchers[] = array('type' => 'contains', 'value' => $q);
        else $matchers[] = array('type' => 'regex', 'value' => '/^' . str_replace('\\*', '.*', preg_quote($q, '/')) . '$/i');
    }
    return $matchers;
}

function api_detail_path_matches($path, $matchers) {
    if (empty($matchers)) return true;
    $lc = strtolower($path);
    foreach ($matchers as $m) {
        if ($m['type'] === 'contains' && strpos($lc, $m['value']) !== false) return true;
        if ($m['type'] === 'regex' && preg_match($m['value'], $path)) return true;
    }
    return false;
}

function api_detail_ext_lookup($filter_ext) {
    $ext_array = $filter_ext !== '' ? array_values(array_filter(array_map('trim', explode(',', strtolower($filter_ext))), 'strlen')) : array();
    $lookup = array();
    foreach ($ext_array as $ext) $lookup[$ext] = true;
    return $lookup;
}

function api_detail_read_ndjson_rows($path, $normalizer) {
    $rows = array();
    $fh = @fopen($path, 'r');
    if (!$fh) return $rows;
    while (($line = fgets($fh)) !== false) {
        $line = trim($line);
        if ($line === '') continue;
        $obj = @json_decode($line, true);
        if (is_array($obj)) $rows[] = call_user_func($normalizer, $obj);
    }
    fclose($fh);
    return $rows;
}

function api_detail_dir_rows($ctx, $prefer_top) {
    $user_dir = $ctx['user_dir'];
    if ($prefer_top) {
        $top_rel = isset($ctx['manifest']['top_dirs']) ? $ctx['manifest']['top_dirs'] : 'top_dirs.json';
        $top_path = $user_dir . DIRECTORY_SEPARATOR . str_replace(array('/', '\\'), DIRECTORY_SEPARATOR, $top_rel);
        $top = api_detail_json_load($top_path);
        if (is_array($top)) {
            $out = array();
            foreach ($top as $row) $out[] = api_detail_normalize_dir($row);
            return $out;
        }
    }
    $dir_rel = 'dirs.ndjson';
    if (isset($ctx['manifest']['dirs']) && is_array($ctx['manifest']['dirs']) && !empty($ctx['manifest']['dirs']['path'])) {
        $dir_rel = $ctx['manifest']['dirs']['path'];
    }
    $dir_path = $user_dir . DIRECTORY_SEPARATOR . str_replace(array('/', '\\'), DIRECTORY_SEPARATOR, $dir_rel);
    return api_detail_read_ndjson_rows($dir_path, 'api_detail_normalize_dir');
}

function api_detail_file_rows($ctx, $prefer_top) {
    $user_dir = $ctx['user_dir'];
    if ($prefer_top) {
        $top_rel = isset($ctx['manifest']['top_files']) ? $ctx['manifest']['top_files'] : 'top_files.json';
        $top_path = $user_dir . DIRECTORY_SEPARATOR . str_replace(array('/', '\\'), DIRECTORY_SEPARATOR, $top_rel);
        $top = api_detail_json_load($top_path);
        if (is_array($top)) {
            $out = array();
            foreach ($top as $row) $out[] = api_detail_normalize_file($row);
            return $out;
        }
    }
    $rows = array();
    $parts = array();
    if (isset($ctx['manifest']['files']) && is_array($ctx['manifest']['files']) && isset($ctx['manifest']['files']['parts']) && is_array($ctx['manifest']['files']['parts'])) {
        $parts = $ctx['manifest']['files']['parts'];
    }
    foreach ($parts as $part) {
        if (!is_array($part) || empty($part['path'])) continue;
        $part_path = $user_dir . DIRECTORY_SEPARATOR . str_replace(array('/', '\\'), DIRECTORY_SEPARATOR, $part['path']);
        $part_rows = api_detail_read_ndjson_rows($part_path, 'api_detail_normalize_file');
        foreach ($part_rows as $r) $rows[] = $r;
    }
    return $rows;
}

function api_detail_filter_sort_slice($rows, $kind, $offset, $limit, $filter_q, $filter_ext, $filter_min, $filter_max) {
    $matchers = api_detail_filter_matchers($filter_q);
    $ext_lookup = $kind === 'file' ? api_detail_ext_lookup($filter_ext) : array();
    $filtered = array();
    foreach ($rows as $row) {
        $size = $kind === 'dir' ? (isset($row['used']) ? (int)$row['used'] : 0) : (isset($row['size']) ? (int)$row['size'] : 0);
        if ($filter_min > 0 && $size < $filter_min) continue;
        if ($filter_max > 0 && $size > $filter_max) continue;
        $path = isset($row['path']) ? (string)$row['path'] : '';
        if (!api_detail_path_matches($path, $matchers)) continue;
        if ($kind === 'file' && !empty($ext_lookup)) {
            $xt = isset($row['xt']) ? strtolower((string)$row['xt']) : strtolower(pathinfo($path, PATHINFO_EXTENSION));
            if (!isset($ext_lookup[$xt])) continue;
        }
        $filtered[] = $row;
    }
    usort($filtered, function($a, $b) use ($kind) {
        $ka = $kind === 'dir' ? (isset($a['used']) ? (int)$a['used'] : 0) : (isset($a['size']) ? (int)$a['size'] : 0);
        $kb = $kind === 'dir' ? (isset($b['used']) ? (int)$b['used'] : 0) : (isset($b['size']) ? (int)$b['size'] : 0);
        if ($ka === $kb) return strcmp(isset($a['path']) ? $a['path'] : '', isset($b['path']) ? $b['path'] : '');
        return ($ka > $kb) ? -1 : 1;
    });
    return array('total' => count($filtered), 'rows' => array_slice($filtered, $offset, $limit), 'has_more' => ($offset + $limit) < count($filtered));
}

function api_detail_get_dir_payload($disk_path, $who, $offset, $limit, $filter_q, $filter_min, $filter_max) {
    $ctx = api_detail_find_user_context($disk_path, $who);
    if (!$ctx) return api_detail_empty_dir($who, $offset, $limit);
    $has_filters = ($filter_q !== '' || $filter_min > 0 || $filter_max > 0);
    $rows = api_detail_dir_rows($ctx, !$has_filters && $offset === 0);
    $result = api_detail_filter_sort_slice($rows, 'dir', $offset, $limit, $filter_q, '', $filter_min, $filter_max);
    $total_meta = api_detail_summary_value($ctx, 'total_dirs', 'total_dirs', $result['total']);
    $total = $has_filters ? $result['total'] : max($total_meta, $result['total']);
    return array('date' => api_detail_date($ctx), 'user' => $who, 'total_dirs' => $total, 'total_used' => api_detail_summary_value($ctx, 'total_used', 'total_used', 0), 'offset' => $offset, 'limit' => $limit, 'has_more' => ($offset + count($result['rows'])) < $total, 'dirs' => $result['rows']);
}

function api_detail_file_parts($ctx) {
    $parts = array();
    if (isset($ctx['manifest']['files']) && is_array($ctx['manifest']['files']) && isset($ctx['manifest']['files']['parts']) && is_array($ctx['manifest']['files']['parts'])) {
        $parts = $ctx['manifest']['files']['parts'];
    }
    return $parts;
}

function api_detail_sort_rows(&$rows, $kind) {
    usort($rows, function($a, $b) use ($kind) {
        $ka = $kind === 'dir' ? (isset($a['used']) ? (int)$a['used'] : 0) : (isset($a['size']) ? (int)$a['size'] : 0);
        $kb = $kind === 'dir' ? (isset($b['used']) ? (int)$b['used'] : 0) : (isset($b['size']) ? (int)$b['size'] : 0);
        if ($ka === $kb) return strcmp(isset($a['path']) ? $a['path'] : '', isset($b['path']) ? $b['path'] : '');
        return ($ka > $kb) ? -1 : 1;
    });
}

function api_detail_stream_file_payload($ctx, $who, $offset, $limit, $filter_q, $filter_ext, $filter_min, $filter_max) {
    $matchers = api_detail_filter_matchers($filter_q);
    $ext_lookup = api_detail_ext_lookup($filter_ext);
    $keep = max(1, $offset + $limit);
    $best = array();
    $total = 0;
    $user_dir = $ctx['user_dir'];

    foreach (api_detail_file_parts($ctx) as $part) {
        if (!is_array($part) || empty($part['path'])) continue;
        $part_path = $user_dir . DIRECTORY_SEPARATOR . str_replace(array('/', '\\'), DIRECTORY_SEPARATOR, $part['path']);
        $fh = @fopen($part_path, 'r');
        if (!$fh) continue;
        while (($line = fgets($fh)) !== false) {
            $line = trim($line);
            if ($line === '') continue;
            $obj = @json_decode($line, true);
            if (!is_array($obj)) continue;
            $row = api_detail_normalize_file($obj);
            $size = isset($row['size']) ? (int)$row['size'] : 0;
            if ($filter_min > 0 && $size < $filter_min) continue;
            if ($filter_max > 0 && $size > $filter_max) continue;
            $path = isset($row['path']) ? (string)$row['path'] : '';
            if (!api_detail_path_matches($path, $matchers)) continue;
            if (!empty($ext_lookup)) {
                $xt = isset($row['xt']) ? strtolower((string)$row['xt']) : strtolower(pathinfo($path, PATHINFO_EXTENSION));
                if (!isset($ext_lookup[$xt])) continue;
            }
            $total++;
            $best[] = $row;
            if (count($best) > ($keep * 2)) {
                api_detail_sort_rows($best, 'file');
                $best = array_slice($best, 0, $keep);
            }
        }
        fclose($fh);
    }

    api_detail_sort_rows($best, 'file');
    $rows = array_slice($best, $offset, $limit);
    return array('date' => api_detail_date($ctx), 'user' => $who, 'total_files' => $total, 'total_used' => api_detail_summary_value($ctx, 'total_used', 'total_used', 0), 'offset' => $offset, 'limit' => $limit, 'has_more' => ($offset + count($rows)) < $total, 'files' => $rows);
}

function api_detail_get_file_payload($disk_path, $who, $offset, $limit, $filter_q, $filter_ext, $filter_min, $filter_max) {
    $ctx = api_detail_find_user_context($disk_path, $who);
    if (!$ctx) return api_detail_empty_file($who, $offset, $limit);
    $has_filters = ($filter_q !== '' || $filter_ext !== '' || $filter_min > 0 || $filter_max > 0);
    if ($has_filters) return api_detail_stream_file_payload($ctx, $who, $offset, $limit, $filter_q, $filter_ext, $filter_min, $filter_max);
    $rows = api_detail_file_rows($ctx, $offset === 0);
    $result = api_detail_filter_sort_slice($rows, 'file', $offset, $limit, $filter_q, $filter_ext, $filter_min, $filter_max);
    $total_meta = api_detail_summary_value($ctx, 'total_files', 'total_files', $result['total']);
    $total = max($total_meta, $result['total']);
    return array('date' => api_detail_date($ctx), 'user' => $who, 'total_files' => $total, 'total_used' => api_detail_summary_value($ctx, 'total_used', 'total_used', 0), 'offset' => $offset, 'limit' => $limit, 'has_more' => ($offset + count($result['rows'])) < $total, 'files' => $result['rows']);
}
