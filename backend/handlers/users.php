<?php

function api_users_normalize_list($users) {
    $out = array();
    if (!is_array($users)) return $out;
    foreach ($users as $u) {
        if (!is_string($u)) continue;
        $name = trim($u);
        if ($name === '') continue;
        $out[] = $name;
    }
    if (count($out) === 0) return $out;
    $out = array_values(array_unique($out));
    sort($out);
    return $out;
}

function api_users_from_latest_main_report($disk_path) {
    $info = api_get_latest_main_report_info($disk_path);
    $latest_file = isset($info['latest_file']) ? $info['latest_file'] : false;
    if (!$latest_file || !is_file($latest_file)) return array();

    $raw = @file_get_contents($latest_file);
    if ($raw === false) return array();
    $json = @json_decode($raw, true);
    if (!is_array($json) || !isset($json['user_usage']) || !is_array($json['user_usage'])) return array();

    $users = array();
    foreach ($json['user_usage'] as $u) {
        if (is_array($u) && isset($u['name']) && $u['name'] !== '') {
            $users[] = (string)$u['name'];
        }
    }
    return api_users_normalize_list($users);
}

function api_handle_users($disk_path) {
    $detail_dir = $disk_path . DIRECTORY_SEPARATOR . 'detail_users';
    $disk_mtime = @filemtime($disk_path);
    $dir_mtime = @filemtime($detail_dir);
    $cache_key = 'users:' . $disk_path . ':' . (is_int($disk_mtime) ? $disk_mtime : 0) . ':' . (is_int($dir_mtime) ? $dir_mtime : 0);
    $data = api_cache_get($cache_key, 30);
    if ($data === null) {
        $users = array();

        // Fast path: user list from latest disk usage report.
        $users = api_users_from_latest_main_report($disk_path);

        // Fallback #1: user list from inode usage report.
        if (count($users) === 0) {
            $inode_file = find_file_by_pattern($disk_path, '/.*inode_usage_report.*\.json$/i');
            if ($inode_file && is_file($inode_file)) {
                $raw = @file_get_contents($inode_file);
                if ($raw !== false) {
                    $inode = @json_decode($raw, true);
                    if (is_array($inode) && isset($inode['users']) && is_array($inode['users'])) {
                        foreach ($inode['users'] as $u) {
                            if (is_array($u) && isset($u['name']) && $u['name'] !== '') {
                                $users[] = (string)$u['name'];
                            }
                        }
                    }
                }
            }
        }

        // Fallback #2 (legacy): derive users from detail report filenames.
        if (count($users) === 0 && is_dir($detail_dir)) {
            $dh = @opendir($detail_dir);
            while ($dh && ($f = readdir($dh)) !== false) {
                if (preg_match('/(?:.*_)?detail_report_(?:dirs?|files?)_(.+)\.(?:json|ndjson)$/i', $f, $m)) {
                    $users[] = $m[1];
                }
            }
            if ($dh) closedir($dh);
        }

        $users = api_users_normalize_list($users);
        $data = array('users' => $users);
        api_cache_set($cache_key, $data);
    }
    b64_success($data);
}
