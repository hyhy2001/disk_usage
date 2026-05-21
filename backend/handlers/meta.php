<?php

function api_handle_meta($disk_path) {
    $info = api_get_latest_main_report_info($disk_path);
    $latest_file = isset($info['latest_file']) ? $info['latest_file'] : '';

    // Send ETag derived from the latest report file. Browser will get
    // 304 on repeat polls when nothing changed — meta is the most-polled
    // endpoint (3-5s cadence) so the savings compound.
    api_send_etag_cache($latest_file, array(), 30);

    $disk_mtime = @filemtime($disk_path);
    $cache_key = 'meta:' . $disk_path . ':' . (is_int($disk_mtime) ? $disk_mtime : 0);
    $data = api_cache_get($cache_key, 30);
    if ($data === null) {
        $data = array(
            'latest_date' => (int)$info['latest_date'],
            'report_files_count' => (int)$info['report_files_count'],
        );
        api_cache_set($cache_key, $data);
    }
    b64_success($data);
}
