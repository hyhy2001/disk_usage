<?php

function api_group_cfg_storage_dir() {
    $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'disk_usage_group_config';
    if (!is_dir($dir)) @mkdir($dir, 0777, true);
    return $dir;
}

function api_group_cfg_user_identity() {
    $candidates = array(
        isset($_SERVER['REMOTE_USER']) ? $_SERVER['REMOTE_USER'] : '',
        isset($_SERVER['PHP_AUTH_USER']) ? $_SERVER['PHP_AUTH_USER'] : '',
        isset($_SERVER['AUTH_USER']) ? $_SERVER['AUTH_USER'] : '',
        isset($_SERVER['HTTP_X_FORWARDED_USER']) ? $_SERVER['HTTP_X_FORWARDED_USER'] : '',
    );

    foreach ($candidates as $v) {
        $v = trim((string)$v);
        if ($v !== '') return sanitize_name($v);
    }

    $ip = isset($_SERVER['REMOTE_ADDR']) ? trim((string)$_SERVER['REMOTE_ADDR']) : '';
    if ($ip !== '') return 'ip_' . sanitize_name($ip);
    return 'anonymous';
}

function api_group_cfg_path_for_user($user_key) {
    return api_group_cfg_storage_dir() . DIRECTORY_SEPARATOR . 'cfg_' . md5((string)$user_key) . '.json';
}

function api_group_cfg_sanitize($payload) {
    $out = array(
        'schema_version' => 3,
        'groups' => array(),
        'seeded_disks' => array(),
    );

    if (!is_array($payload)) return $out;

    $groups = isset($payload['groups']) && is_array($payload['groups']) ? $payload['groups'] : array();
    foreach ($groups as $idx => $g) {
        if (!is_array($g)) continue;
        $id = isset($g['id']) ? trim((string)$g['id']) : ('group_' . ($idx + 1));
        if ($id === '') $id = 'group_' . ($idx + 1);
        $name = isset($g['name']) ? trim((string)$g['name']) : ('Group ' . ($idx + 1));
        if ($name === '') $name = 'Group ' . ($idx + 1);

        $disk_users_out = array();
        if (isset($g['diskUsers']) && is_array($g['diskUsers'])) {
            foreach ($g['diskUsers'] as $disk_id => $users) {
                $disk_id = trim((string)$disk_id);
                if ($disk_id === '' || !is_array($users)) continue;
                $uniq = array();
                foreach ($users as $u) {
                    $u = trim((string)$u);
                    if ($u === '') continue;
                    $uniq[$u] = true;
                }
                $names = array_keys($uniq);
                sort($names);
                $disk_users_out[$disk_id] = $names;
            }
        }

        $out['groups'][] = array(
            'id' => $id,
            'name' => $name,
            'diskUsers' => $disk_users_out,
        );
    }

    if (isset($payload['seeded_disks']) && is_array($payload['seeded_disks'])) {
        foreach ($payload['seeded_disks'] as $disk_id => $seeded) {
            $disk_id = trim((string)$disk_id);
            if ($disk_id === '') continue;
            $out['seeded_disks'][$disk_id] = !!$seeded;
        }
    }

    $out['updated_at'] = gmdate('c');
    return $out;
}

function api_group_cfg_load($user_key) {
    $fp = api_group_cfg_path_for_user($user_key);
    if (!is_file($fp)) {
        return api_group_cfg_sanitize(array('groups' => array()));
    }

    $raw = @file_get_contents($fp);
    if ($raw === false || $raw === '') {
        return api_group_cfg_sanitize(array('groups' => array()));
    }

    $parsed = @json_decode($raw, true);
    return api_group_cfg_sanitize($parsed);
}

function api_group_cfg_save($user_key, $payload) {
    $dir = api_group_cfg_storage_dir();
    if (!is_dir($dir) || !is_writable($dir)) {
        b64_error('Server config storage is not writable.', 500);
    }

    $clean = api_group_cfg_sanitize($payload);
    $fp = api_group_cfg_path_for_user($user_key);
    $tmp = $fp . '.tmp.' . getmypid() . '.' . mt_rand(1000, 9999);
    $json = json_encode($clean);
    if ($json === false) b64_error('Failed to encode config payload.', 500);

    if (@file_put_contents($tmp, $json, LOCK_EX) === false) {
        @unlink($tmp);
        b64_error('Failed to write server config.', 500);
    }
    @rename($tmp, $fp);
    @chmod($fp, 0666);

    return $clean;
}

function api_handle_group_config($root_dir) {
    $user_key = api_group_cfg_user_identity();
    $action = trim((string)param('action', 'get'));

    if ($action === 'save') {
        $raw = get_b64_param('config', '');
        if (!is_string($raw) || trim($raw) === '') {
            b64_error('Missing config payload.', 400);
        }
        $parsed = @json_decode($raw, true);
        if (!is_array($parsed)) {
            b64_error('Invalid config JSON payload.', 400);
        }

        $saved = api_group_cfg_save($user_key, $parsed);
        b64_success(array(
            'user_key' => $user_key,
            'config' => $saved,
        ));
    }

    $loaded = api_group_cfg_load($user_key);
    b64_success(array(
        'user_key' => $user_key,
        'config' => $loaded,
    ));
}
