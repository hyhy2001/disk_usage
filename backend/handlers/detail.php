<?php

function api_handle_detail($disk_path) {
    $who         = sanitize_name(get_b64_param('user', ''));
    $dir_offset  = get_int('dir_offset', 0, 0, PHP_INT_MAX);
    $file_offset = get_int('file_offset', 0, 0, PHP_INT_MAX);
    $limit       = get_int('limit', 500, 1, 5000);

    $manifest_path = api_detail_manifest_path($disk_path);
    if (!is_file($manifest_path)) {
        b64_success(array(
            'dir' => api_detail_empty_dir($who, $dir_offset, $limit),
            'file' => api_detail_empty_file($who, $file_offset, $limit),
        ));
    }

    $filter_q   = strtolower(trim(param('filter_query', '')));
    $filter_ext = strtolower(trim(param('filter_ext', '')));
    $filter_min = get_int('filter_min_size', 0, 0, PHP_INT_MAX);
    $filter_max = get_int('filter_max_size', 0, 0, PHP_INT_MAX);

    api_send_etag_cache($manifest_path, array(
        'detail',
        $who,
        $dir_offset,
        $file_offset,
        $limit,
        $filter_q,
        $filter_ext,
        $filter_min,
        $filter_max,
        @filemtime($manifest_path),
    ));

    $dir = api_detail_get_dir_payload($disk_path, $who, $dir_offset, $limit, $filter_q, $filter_min, $filter_max);
    $file = api_detail_get_file_payload($disk_path, $who, $file_offset, $limit, $filter_q, $filter_ext, $filter_min, $filter_max);

    b64_success(array('dir' => $dir, 'file' => $file));
}
