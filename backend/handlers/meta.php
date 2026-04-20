<?php

function api_handle_meta($disk_path) {
    $disk_mtime = @filemtime($disk_path);
    $cache_key = 'meta:' . $disk_path . ':' . (is_int($disk_mtime) ? $disk_mtime : 0);
    $data = api_cache_get($cache_key, 30);
    if ($data === null) {
        $info = api_get_latest_main_report_info($disk_path);
        $data = array(
            'latest_date' => (int)$info['latest_date'],
            'report_files_count' => (int)$info['report_files_count'],
        );
        api_cache_set($cache_key, $data);
    }
    b64_success($data);
}
