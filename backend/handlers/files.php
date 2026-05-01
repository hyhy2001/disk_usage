<?php

function api_files_normalize_row($obj) {
    return api_detail_normalize_file($obj);
}

function api_files_csv_value($v) {
    $s = (string)$v;
    if (strpos($s, '"') !== false) $s = str_replace('"', '""', $s);
    if (strpos($s, ',') !== false || strpos($s, '"') !== false || strpos($s, "\n") !== false || strpos($s, "\r") !== false) $s = '"' . $s . '"';
    return $s;
}

function api_files_csv_line($cols) {
    $out = array();
    foreach ($cols as $c) $out[] = api_files_csv_value($c);
    return implode(',', $out) . "\r\n";
}

function api_handle_files_csv($disk_path) {
    $who        = sanitize_name(get_b64_param('user', ''));
    $filter_q   = strtolower(trim(param('filter_query', '')));
    $filter_ext = strtolower(trim(param('filter_ext', '')));
    $filter_min = get_int('filter_min_size', 0, 0, PHP_INT_MAX);
    $filter_max = get_int('filter_max_size', 0, 0, PHP_INT_MAX);

    $export_lock = api_export_acquire_slot($disk_path, 120);
    $ctx = api_detail_find_user_context($disk_path, $who);
    if (!$ctx) b64_error('User detail data not found.', 404);

    $rows = api_detail_file_rows($ctx, false);
    $filtered = api_detail_filter_sort_slice($rows, 'file', 0, PHP_INT_MAX, $filter_q, $filter_ext, $filter_min, $filter_max);

    while (ob_get_level() > 0) @ob_end_clean();
    $download_name = 'files_' . preg_replace('/[^A-Za-z0-9._-]+/', '_', $who) . '_' . date('Ymd_His') . '.csv.gz';
    header('Content-Type: application/gzip');
    header('Content-Disposition: attachment; filename="' . $download_name . '"');
    header('Cache-Control: no-cache, no-store, must-revalidate');

    $csv_buf = "\xEF\xBB\xBF";
    $csv_buf .= api_files_csv_line(array('User', 'Path', 'Size (bytes)', 'Extension'));
    $n = 0;
    foreach ($filtered['rows'] as $row) {
        $csv_buf .= api_files_csv_line(array(
            $who,
            isset($row['path']) ? $row['path'] : '',
            isset($row['size']) ? (int)$row['size'] : 0,
            isset($row['xt']) ? $row['xt'] : '',
        ));
        if ((++$n % 5000) === 0) { echo gzencode($csv_buf, 3); $csv_buf = ''; flush(); }
    }
    if ($csv_buf !== '') echo gzencode($csv_buf, 3);
    if (is_resource($export_lock)) flock($export_lock, LOCK_UN);
    exit;
}

function api_handle_files($disk_path) {
    $who        = sanitize_name(get_b64_param('user', ''));
    $offset     = get_int('offset', 0, 0, PHP_INT_MAX);
    $limit      = get_int('limit', 500, 1, 5000);
    $filter_q   = strtolower(trim(param('filter_query', '')));
    $filter_ext = strtolower(trim(param('filter_ext', '')));
    $filter_min = get_int('filter_min_size', 0, 0, PHP_INT_MAX);
    $filter_max = get_int('filter_max_size', 0, 0, PHP_INT_MAX);

    $manifest_path = api_detail_manifest_path($disk_path);
    if (!is_file($manifest_path)) {
        if (param('count_only', '0') === '1') b64_success(array('file_count' => 0));
        b64_success(array('file' => api_detail_empty_file($who, $offset, $limit)));
    }

    api_send_etag_cache($manifest_path, array('files', $who, $offset, $limit, $filter_q, $filter_ext, $filter_min, $filter_max, param('count_only', '0'), @filemtime($manifest_path)));

    $file = api_detail_get_file_payload($disk_path, $who, $offset, $limit, $filter_q, $filter_ext, $filter_min, $filter_max);
    if (param('count_only', '0') === '1') b64_success(array('file_count' => isset($file['total_files']) ? (int)$file['total_files'] : 0));
    b64_success(array('file' => $file));
}
