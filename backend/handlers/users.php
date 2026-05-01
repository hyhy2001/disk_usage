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


function api_users_from_detail_manifest($disk_path) {
    $manifest_path = $disk_path . DIRECTORY_SEPARATOR . 'detail_users' . DIRECTORY_SEPARATOR . 'data_detail.json';
    if (!is_file($manifest_path)) return array();
    $raw = @file_get_contents($manifest_path);
    if ($raw === false) return array();
    $json = @json_decode($raw, true);
    if (!is_array($json) || !isset($json['users']) || !is_array($json['users'])) return array();

    $users = array();
    foreach ($json['users'] as $u) {
        if (!is_array($u) || !isset($u['username'])) continue;
        $name = trim((string)$u['username']);
        if ($name === '') continue;
        $users[] = $name;
    }
    return api_users_normalize_list($users);
}

function api_users_from_latest_main_report($disk_path) {
    $info = api_get_latest_main_report_info($disk_path);
    $latest_file = isset($info['latest_file']) ? $info['latest_file'] : false;
    if (!$latest_file || !is_file($latest_file)) return array();

    $raw = @file_get_contents($latest_file);
    if ($raw === false) return array();
    $json = @json_decode($raw, true);
    if (!is_array($json)) return array();

    $users = array();
    if (isset($json['user_usage']) && is_array($json['user_usage'])) {
        foreach ($json['user_usage'] as $u) {
            if (is_array($u) && isset($u['name']) && $u['name'] !== '') {
                $users[] = (string)$u['name'];
            }
        }
    }

    // Include "other_usage" users too so Group User UI can count/show "Other" correctly.
    if (isset($json['other_usage']) && is_array($json['other_usage'])) {
        foreach ($json['other_usage'] as $u) {
            if (is_array($u) && isset($u['name']) && $u['name'] !== '') {
                $users[] = (string)$u['name'];
            }
        }
    }

    return api_users_normalize_list($users);
}

function api_users_system_groups_from_latest_main_report($disk_path) {
    $info = api_get_latest_main_report_info($disk_path);
    $latest_file = isset($info['latest_file']) ? $info['latest_file'] : false;
    if (!$latest_file || !is_file($latest_file)) return array();

    $raw = @file_get_contents($latest_file);
    if ($raw === false) return array();
    $json = @json_decode($raw, true);
    if (!is_array($json)) return array();

    $team_name_by_id = array();
    if (isset($json['team_usage']) && is_array($json['team_usage'])) {
        foreach ($json['team_usage'] as $t) {
            if (!is_array($t)) continue;
            if (!isset($t['team_id'])) continue;
            $tid = trim((string)$t['team_id']);
            if ($tid === '') continue;
            $tname = isset($t['name']) ? trim((string)$t['name']) : '';
            if ($tname === '') $tname = 'Team ' . $tid;
            $team_name_by_id[$tid] = $tname;
        }
    }

    $groups = array();
    if (isset($json['user_usage']) && is_array($json['user_usage'])) {
        foreach ($json['user_usage'] as $u) {
            if (!is_array($u) || !isset($u['name'])) continue;
            $uname = trim((string)$u['name']);
            if ($uname === '') continue;

            $team_id = isset($u['team_id']) ? trim((string)$u['team_id']) : '';
            $group_name = '';
            if ($team_id !== '' && isset($team_name_by_id[$team_id])) {
                $group_name = $team_name_by_id[$team_id];
            } elseif ($team_id !== '') {
                $group_name = 'Team ' . $team_id;
            } else {
                $group_name = 'Ungrouped';
            }

            if (!isset($groups[$group_name])) $groups[$group_name] = array();
            $groups[$group_name][$uname] = true;
        }
    }

    $out = array();
    $names = array_keys($groups);
    sort($names, SORT_NATURAL | SORT_FLAG_CASE);
    foreach ($names as $name) {
        $users = array_keys($groups[$name]);
        sort($users);
        $out[] = array(
            'name' => $name,
            'users' => $users,
            'count' => count($users),
        );
    }
    return $out;
}

function api_handle_users($disk_path) {
    $detail_dir = $disk_path . DIRECTORY_SEPARATOR . 'detail_users';
    $manifest_path = $detail_dir . DIRECTORY_SEPARATOR . 'data_detail.json';
    $disk_mtime = @filemtime($disk_path);
    $dir_mtime = @filemtime($detail_dir);
    $manifest_mtime = @filemtime($manifest_path);
    $cache_key = 'users:' . $disk_path . ':' . (is_int($disk_mtime) ? $disk_mtime : 0) . ':' . (is_int($dir_mtime) ? $dir_mtime : 0) . ':' . (is_int($manifest_mtime) ? $manifest_mtime : 0);
    $data = api_cache_get($cache_key, 30);
    if ($data === null) {
        $users = array();

        // Fast path: user list from detail manifest (current pipeline source-of-truth).
        $users = api_users_from_detail_manifest($disk_path);

        // Fallback #1: user list from latest disk usage report.
        if (count($users) === 0) {
            $users = api_users_from_latest_main_report($disk_path);
        }

        // Fallback #2: user list from inode usage report.
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

        // Fallback #2: user list from detail manifest.
        if (count($users) === 0 && is_file($manifest_path)) {
            $manifest = api_detail_json_load($manifest_path);
            if (is_array($manifest) && isset($manifest['users']) && is_array($manifest['users'])) {
                foreach ($manifest['users'] as $u) {
                    if (is_array($u) && isset($u['username']) && $u['username'] !== '') $users[] = (string)$u['username'];
                }
            }
        }

        $users = api_users_normalize_list($users);
        $system_groups = api_users_system_groups_from_latest_main_report($disk_path);
        $data = array(
            'users' => $users,
            'system_groups' => $system_groups,
        );
        api_cache_set($cache_key, $data);
    }
    b64_success($data);
}
