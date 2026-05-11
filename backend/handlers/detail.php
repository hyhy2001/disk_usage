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

function api_detail_find_ctx($disk_path, $who) {
    $root_path = api_detail_manifest_path($disk_path);
    if (!is_file($root_path)) return false;
    $root = api_detail_json_load($root_path);
    if (!is_array($root) || !isset($root['users']) || !is_array($root['users'])) return false;

    $entry = false;
    foreach ($root['users'] as $u) {
        if (!is_array($u) || !isset($u['username'])) continue;
        if ((string)$u['username'] === (string)$who) { $entry = $u; break; }
    }
    if (!$entry || empty($entry['manifest'])) return false;

    $detail_dir = dirname($root_path);
    $manifest_path = $detail_dir . DIRECTORY_SEPARATOR . str_replace(array('/', '\\'), DIRECTORY_SEPARATOR, $entry['manifest']);
    if (!is_file($manifest_path)) return false;
    $manifest = api_detail_json_load($manifest_path);
    if (!is_array($manifest)) return false;

    return array(
        'root' => $root,
        'entry' => $entry,
        'manifest' => $manifest,
        'detail_dir' => $detail_dir,
        'user_dir' => dirname($manifest_path),
    );
}

function api_detail_ext($path) {
    return strtolower((string)pathinfo((string)$path, PATHINFO_EXTENSION));
}

function api_detail_path_dict($detail_dir) {
    static $cache = array();
    $key = (string)$detail_dir;
    if (isset($cache[$key])) return $cache[$key];

    $map = array();
    $path = $detail_dir . DIRECTORY_SEPARATOR . 'api' . DIRECTORY_SEPARATOR . 'path_dict.ndjson';
    $fh = @fopen($path, 'r');
    if ($fh) {
        while (($line = fgets($fh)) !== false) {
            $line = trim($line);
            if ($line === '') continue;
            $obj = @json_decode($line, true);
            if (!is_array($obj) || !isset($obj['gid']) || !isset($obj['p'])) continue;
            $map[(int)$obj['gid']] = (string)$obj['p'];
        }
        @fclose($fh);
    }

    $cache[$key] = $map;
    return $map;
}

function api_detail_filters($is_file) {
    return array(
        'q' => strtolower(trim(param('filter_query', ''))),
        'ext' => $is_file ? strtolower(trim(param('filter_ext', ''))) : '',
        'min' => get_int('filter_min_size', 0, 0, PHP_INT_MAX),
        'max' => get_int('filter_max_size', 0, 0, PHP_INT_MAX),
    );
}

function api_detail_match($row, $is_file, $filters) {
    $path = isset($row['path']) ? (string)$row['path'] : '';
    if ($path === '') return false;

    $size = $is_file
        ? (isset($row['size']) ? (int)$row['size'] : 0)
        : (isset($row['used']) ? (int)$row['used'] : 0);

    if ($filters['min'] > 0 && $size < $filters['min']) return false;
    if ($filters['max'] > 0 && $size > $filters['max']) return false;

    if ($filters['q'] !== '') {
        $tokens = array_values(array_filter(array_map('trim', explode(',', $filters['q'])), 'strlen'));
        if (!empty($tokens)) {
            $lc = strtolower($path);
            $ok = false;
            foreach ($tokens as $t) {
                if (strpos($t, '*') === false) {
                    if (strpos($lc, $t) !== false) { $ok = true; break; }
                } else {
                    $re = '/^' . str_replace('\\*', '.*', preg_quote($t, '/')) . '$/i';
                    if (@preg_match($re, $path)) { $ok = true; break; }
                }
            }
            if (!$ok) return false;
        }
    }

    if ($is_file && $filters['ext'] !== '') {
        $allow = array();
        foreach (array_values(array_filter(array_map('trim', explode(',', $filters['ext'])), 'strlen')) as $e) $allow[$e] = true;
        $xt = isset($row['xt']) ? strtolower((string)$row['xt']) : api_detail_ext($path);
        if (!isset($allow[$xt])) return false;
    }

    return true;
}

function api_detail_collect_rows($ctx, $kind, $offset, $limit, $filters) {
    $is_file = ($kind === 'files');
    $t_start = microtime(true);

    $who = isset($ctx['entry']['username']) ? (string)$ctx['entry']['username'] : '';
    $has_glob = false;
    if (!empty($filters['q'])) {
        $tokens = array_values(array_filter(array_map('trim', explode(',', $filters['q'])), 'strlen'));
        foreach ($tokens as $t) {
            if (strpos($t, '*') !== false) { $has_glob = true; break; }
        }
    }

    if ($has_glob) {
        return array('rows' => array(), 'total' => 0, 'has_more' => false);
    }

    $cmd = array();
    $cmd[] = escapeshellarg(__DIR__ . '/../lib/query_cli');
    $cmd[] = escapeshellarg($ctx['detail_dir']);
    if ($who !== '') { $cmd[] = '--user'; $cmd[] = escapeshellarg($who); }
    $cmd[] = '--type';
    $cmd[] = $is_file ? 'file' : 'dir';
    if (!empty($filters['q'])) {
        $kw_cli = str_replace(',', '|', (string)$filters['q']);
        $cmd[] = '--kw';
        $cmd[] = escapeshellarg($kw_cli);
    }
    if ($is_file && !empty($filters['ext'])) { $cmd[] = '--ext'; $cmd[] = escapeshellarg($filters['ext']); }
    if (isset($filters['min']) && (int)$filters['min'] > 0) { $cmd[] = '--min'; $cmd[] = escapeshellarg((string)(int)$filters['min']); }
    if (isset($filters['max']) && (int)$filters['max'] > 0) { $cmd[] = '--max'; $cmd[] = escapeshellarg((string)(int)$filters['max']); }
    $cmd[] = '--offset'; $cmd[] = escapeshellarg((string)(int)$offset);
    $cmd[] = '--limit';  $cmd[] = escapeshellarg((string)(int)$limit);
    $cmd[] = '--sort';   $cmd[] = 'size_desc';
    $cmd[] = '--fields'; $cmd[] = $is_file ? 'path,size,ext' : 'path,size';
    $cmd[] = '--json';
    $cmd[] = '--docs';

    $t_exec = microtime(true);
    $raw = @shell_exec(implode(' ', $cmd) . ' 2>&1');
    $t_exec_done = microtime(true);

    $json = @json_decode((string)$raw, true);
    $t_decode_done = microtime(true);

    $raw_len = strlen((string)$raw);
    $exec_ms  = round(($t_exec_done  - $t_exec)  * 1000, 1);
    $dec_ms   = round(($t_decode_done - $t_exec_done) * 1000, 1);
    $total_ms = round(($t_decode_done - $t_start) * 1000, 1);
    error_log(sprintf(
        '[detail.php] kind=%s user=%s offset=%d limit=%d q=%s | exec=%.1fms decode=%.1fms total=%.1fms raw_bytes=%d ok=%s',
        $kind, $who, $offset, $limit,
        (!empty($filters['q']) ? $filters['q'] : ''),
        $exec_ms, $dec_ms, $total_ms, $raw_len,
        (is_array($json) && isset($json['docs'])) ? 'yes' : 'no'
    ));

    if (!is_array($json) || !isset($json['docs']) || !is_array($json['docs'])) {
        return array('rows' => array(), 'total' => 0, 'has_more' => false);
    }

    $rows = array();
    foreach ($json['docs'] as $doc) {
        if (!is_array($doc)) continue;
        if ($is_file) {
            $path = isset($doc['path']) ? (string)$doc['path'] : '';
            $rows[] = array(
                'path' => $path,
                'size' => isset($doc['size']) ? (int)$doc['size'] : 0,
                'xt'   => isset($doc['ext']) ? strtolower((string)$doc['ext']) : api_detail_ext($path),
            );
        } else {
            $rows[] = array(
                'path' => isset($doc['path']) ? (string)$doc['path'] : '',
                'used' => isset($doc['size']) ? (int)$doc['size'] : 0,
            );
        }
    }

    $total = isset($json['matched']) ? (int)$json['matched'] : count($rows);
    if ($total < 0) $total = 0;
    return array('rows' => $rows, 'total' => $total, 'has_more' => ($offset + count($rows)) < $total);
}

function api_detail_empty_dir($who, $offset, $limit) {
    return array('date' => 0, 'user' => $who, 'total_dirs' => 0, 'total_dirs_full' => 0, 'total_used' => 0, 'offset' => $offset, 'limit' => $limit, 'has_more' => false, 'dirs' => array());
}

function api_detail_empty_file($who, $offset, $limit) {
    return array('date' => 0, 'user' => $who, 'total_files' => 0, 'total_files_full' => 0, 'total_used' => 0, 'offset' => $offset, 'limit' => $limit, 'has_more' => false, 'files' => array());
}

function api_detail_date($ctx) {
    if (isset($ctx['manifest']['scan_date'])) return (int)$ctx['manifest']['scan_date'];
    if (isset($ctx['root']['scan']['timestamp'])) return (int)$ctx['root']['scan']['timestamp'];
    return 0;
}

function api_detail_total_used($ctx) {
    if (isset($ctx['manifest']['summary']) && is_array($ctx['manifest']['summary']) && isset($ctx['manifest']['summary']['used'])) return (int)$ctx['manifest']['summary']['used'];
    if (isset($ctx['entry']['used'])) return (int)$ctx['entry']['used'];
    return 0;
}

function api_handle_dirs($disk_path) {
    $who = sanitize_name(get_b64_param('user', ''));
    $offset = get_int('offset', 0, 0, PHP_INT_MAX);
    $limit = get_int('limit', 500, 1, 50000);
    $count_only = (param('count_only', '0') === '1');

    $ctx = api_detail_find_ctx($disk_path, $who);
    if (!$ctx) {
        if ($count_only) b64_success(array('dir_count' => 0));
        b64_success(array('dir' => api_detail_empty_dir($who, $offset, $limit)));
    }

    $result = api_detail_collect_rows($ctx, 'dirs', $offset, $limit, api_detail_filters(false));
    $payload = array(
        'date' => api_detail_date($ctx),
        'user' => $who,
        'total_dirs' => (int)$result['total'],
        'total_dirs_full' => isset($ctx['entry']['dirs']) ? (int)$ctx['entry']['dirs'] : (int)$result['total'],
        'total_used' => api_detail_total_used($ctx),
        'offset' => $offset,
        'limit' => $limit,
        'has_more' => !empty($result['has_more']),
        'dirs' => $result['rows'],
    );

    if ($count_only) b64_success(array('dir_count' => (int)$payload['total_dirs']));
    b64_success(array('dir' => $payload));
}

function api_handle_files($disk_path) {
    $who = sanitize_name(get_b64_param('user', ''));
    $offset = get_int('offset', 0, 0, PHP_INT_MAX);
    $limit = get_int('limit', 500, 1, 50000);
    $count_only = (param('count_only', '0') === '1');

    $ctx = api_detail_find_ctx($disk_path, $who);
    if (!$ctx) {
        if ($count_only) b64_success(array('file_count' => 0));
        b64_success(array('file' => api_detail_empty_file($who, $offset, $limit)));
    }

    $result = api_detail_collect_rows($ctx, 'files', $offset, $limit, api_detail_filters(true));
    $payload = array(
        'date' => api_detail_date($ctx),
        'user' => $who,
        'total_files' => (int)$result['total'],
        'total_files_full' => isset($ctx['entry']['files']) ? (int)$ctx['entry']['files'] : (int)$result['total'],
        'total_used' => api_detail_total_used($ctx),
        'offset' => $offset,
        'limit' => $limit,
        'has_more' => !empty($result['has_more']),
        'files' => $result['rows'],
    );

    if ($count_only) b64_success(array('file_count' => (int)$payload['total_files']));
    b64_success(array('file' => $payload));
}

function api_handle_detail($disk_path) {
    $who = sanitize_name(get_b64_param('user', ''));
    $dir_offset = get_int('dir_offset', 0, 0, PHP_INT_MAX);
    $file_offset = get_int('file_offset', 0, 0, PHP_INT_MAX);
    $limit = get_int('limit', 500, 1, 50000);
    $node_type = strtolower(trim(param('node_type', 'all')));
    if ($node_type !== 'dir' && $node_type !== 'file') $node_type = 'all';

    $ctx = api_detail_find_ctx($disk_path, $who);
    if (!$ctx) {
        b64_success(array(
            'dir' => api_detail_empty_dir($who, $dir_offset, $limit),
            'file' => api_detail_empty_file($who, $file_offset, $limit),
        ));
    }

    $dir = api_detail_empty_dir($who, $dir_offset, $limit);
    if ($node_type !== 'file') {
        $dr = api_detail_collect_rows($ctx, 'dirs', $dir_offset, $limit, api_detail_filters(false));
        $dir = array(
            'date' => api_detail_date($ctx),
            'user' => $who,
            'total_dirs' => (int)$dr['total'],
            'total_dirs_full' => isset($ctx['entry']['dirs']) ? (int)$ctx['entry']['dirs'] : (int)$dr['total'],
            'total_used' => api_detail_total_used($ctx),
            'offset' => $dir_offset,
            'limit' => $limit,
            'has_more' => !empty($dr['has_more']),
            'dirs' => $dr['rows'],
        );
    }

    $file = api_detail_empty_file($who, $file_offset, $limit);
    if ($node_type !== 'dir') {
        $fr = api_detail_collect_rows($ctx, 'files', $file_offset, $limit, api_detail_filters(true));
        $file = array(
            'date' => api_detail_date($ctx),
            'user' => $who,
            'total_files' => (int)$fr['total'],
            'total_files_full' => isset($ctx['entry']['files']) ? (int)$ctx['entry']['files'] : (int)$fr['total'],
            'total_used' => api_detail_total_used($ctx),
            'offset' => $file_offset,
            'limit' => $limit,
            'has_more' => !empty($fr['has_more']),
            'files' => $fr['rows'],
        );
    }

    b64_success(array('dir' => $dir, 'file' => $file));
}