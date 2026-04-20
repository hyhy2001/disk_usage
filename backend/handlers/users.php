<?php

function api_handle_users($disk_path) {
    $detail_dir = $disk_path . DIRECTORY_SEPARATOR . 'detail_users';
    $dir_mtime = @filemtime($detail_dir);
    $cache_key = 'users:' . $disk_path . ':' . (is_int($dir_mtime) ? $dir_mtime : 0);
    $cached = api_cache_get($cache_key, 8);
    if (is_array($cached) && isset($cached['users']) && is_array($cached['users'])) {
        b64_success($cached);
    }

    $users = array();
    if (is_dir($detail_dir)) {
        $dh = @opendir($detail_dir);
        while ($dh && ($f = readdir($dh)) !== false) {
            if (preg_match('/(?:.*_)?detail_report_(?:dirs?|files?)_(.+)\.(?:json|ndjson)$/i', $f, $m)) {
                $users[] = $m[1];
            }
        }
        if ($dh) closedir($dh);

        $users = array_unique($users);
        sort($users);
    }
    $data = array('users' => $users);
    api_cache_set($cache_key, $data);
    b64_success($data);
}
