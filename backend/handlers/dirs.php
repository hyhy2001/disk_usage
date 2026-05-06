<?php

function api_dirs_csv_value($v) {
    $s = (string)$v;
    if (strpos($s, '"') !== false) $s = str_replace('"', '""', $s);
    if (strpos($s, ',') !== false || strpos($s, '"') !== false || strpos($s, "\n") !== false || strpos($s, "\r") !== false) $s = '"' . $s . '"';
    return $s;
}

function api_dirs_csv_line($cols) {
    $out = array();
    foreach ($cols as $c) $out[] = api_dirs_csv_value($c);
    return implode(',', $out) . "\r\n";
}

function api_handle_dirs_csv($disk_path) {
    $who = sanitize_name(get_b64_param('user', ''));
    $filter_q = strtolower(trim(param('filter_query', '')));
    $filter_ext = strtolower(trim(param('filter_ext', '')));
    $filter_min = get_int('filter_min_size', 0, 0, PHP_INT_MAX);
    $filter_max = get_int('filter_max_size', 0, 0, PHP_INT_MAX);

    $ctx = api_detail_find_user_context($disk_path, $who);
    if (!$ctx) b64_error('User detail data not found.', 404);

    $export_lock = api_export_acquire_slot($disk_path, 120);

    while (ob_get_level() > 0) @ob_end_clean();
    $download_name = 'dirs_' . preg_replace('/[^A-Za-z0-9._-]+/', '_', $who) . '_' . date('Ymd_His') . '.csv.gz';
    header('Content-Type: application/gzip');
    header('Content-Disposition: attachment; filename="' . $download_name . '"');
    header('Cache-Control: no-cache, no-store, must-revalidate');

    $csv_buf = "\xEF\xBB\xBF";
    $csv_buf .= api_dirs_csv_line(array('User', 'Path', 'Used (bytes)'));
    $n = 0;

    // Extension filter applies to files only; for dirs export return empty set.
    if ($filter_ext === '') {
        $offset = 0;
        $page_limit = 5000;
        while (true) {
            $payload = api_detail_get_dir_payload($disk_path, $who, $offset, $page_limit, $filter_q, $filter_min, $filter_max, false);
            $rows = (is_array($payload) && isset($payload['dirs']) && is_array($payload['dirs'])) ? $payload['dirs'] : array();
            if (empty($rows)) break;

            foreach ($rows as $row) {
                $csv_buf .= api_dirs_csv_line(array(
                    $who,
                    isset($row['path']) ? $row['path'] : '',
                    isset($row['used']) ? (int)$row['used'] : 0,
                ));
                if ((++$n % 5000) === 0) { echo gzencode($csv_buf, 3); $csv_buf = ''; flush(); }
            }

            $offset += count($rows);
            if (empty($payload['has_more'])) break;
        }
    }

    if ($csv_buf !== '') echo gzencode($csv_buf, 3);
    if (is_resource($export_lock)) flock($export_lock, LOCK_UN);
    exit;
}

function api_handle_dirs($disk_path) {
    $who = sanitize_name(get_b64_param('user', ''));
    $offset = get_int('offset', 0, 0, PHP_INT_MAX);
    $limit = get_int('limit', 500, 1, 5000);
    $filter_q = strtolower(trim(param('filter_query', '')));
    $filter_min = get_int('filter_min_size', 0, 0, PHP_INT_MAX);
    $filter_max = get_int('filter_max_size', 0, 0, PHP_INT_MAX);

    $manifest_path = api_detail_manifest_path($disk_path);
    if (!is_file($manifest_path)) {
        if (param('count_only', '0') === '1') b64_success(array('dir_count' => 0));
        b64_success(array('dir' => api_detail_empty_dir($who, $offset, $limit)));
    }

    $count_only = (param('count_only', '0') === '1');
    $has_filters = ($filter_q !== '' || $filter_min > 0 || $filter_max > 0);
    $export_stream = ($has_filters && !$count_only && param('export_stream', '0') === '1');
    if ($export_stream) {
        $limit = get_int('limit', 10000, 1, 50000);
    }
    $cursor = $export_stream ? get_int('cursor', 0, 0, PHP_INT_MAX) : 0;
    $skip_rows = $export_stream ? get_int('skip_rows', 0, 0, PHP_INT_MAX) : 0;

    // For filtered dirs, prefer approximate fast path by default.
    $approx_total = ($has_filters && !$count_only && !$export_stream);
    if (param('approx_total', '') !== '') {
        $approx_total = (param('approx_total', '0') === '1');
    }

    api_send_etag_cache($manifest_path, array('dirs', $who, $offset, $limit, $filter_q, $filter_min, $filter_max, $count_only ? '1' : '0', $export_stream ? '1' : '0', $approx_total ? '1' : '0', $export_stream ? (string)$cursor : '', $export_stream ? (string)$skip_rows : '', @filemtime($manifest_path)));

    if ($export_stream) {
        $ctx = api_detail_find_user_context($disk_path, $who);
        if (!$ctx) b64_error('User detail data not found.', 404);
        $dir = api_detail_stream_dir_cursor_payload($ctx, $who, $cursor, $limit, $filter_q, $filter_min, $filter_max, $skip_rows);
        b64_success(array('dir' => $dir));
    }

    $dir = api_detail_get_dir_payload($disk_path, $who, $offset, $limit, $filter_q, $filter_min, $filter_max, $approx_total);
    if ($count_only) b64_success(array('dir_count' => isset($dir['total_dirs']) ? (int)$dir['total_dirs'] : 0));
    b64_success(array('dir' => $dir));
}
