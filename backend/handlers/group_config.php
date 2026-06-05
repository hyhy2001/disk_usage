<?php

// Durable storage: lives beside admin.db under {root}/database/, NOT in the
// system temp dir. /tmp is wiped on reboot and by tmp-cleaners, which would
// silently destroy every user's group config (the only user-authored state in
// this otherwise read-only app). Owner-only perms (0700/0600) since each file
// is private per-identity.
function api_group_cfg_storage_dir($root_dir) {
    $dir = $root_dir . DIRECTORY_SEPARATOR . DU_ADMIN_DB_DIRNAME . DIRECTORY_SEPARATOR . 'group_config';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    return $dir;
}

// Pre-migration location. Kept only so existing configs are moved to the
// durable dir on first access; nothing new is ever written here.
function api_group_cfg_legacy_dir() {
    return sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'disk_usage_group_config';
}

function api_group_cfg_filename($user_key) {
    return 'cfg_' . md5((string)$user_key) . '.json';
}

// One-time best-effort move of a user's config from the legacy temp dir to the
// durable dir. Runs only when the durable copy does not exist yet, so it's a
// no-op on every request after the first.
function api_group_cfg_migrate_legacy($root_dir, $user_key) {
    $fp = api_group_cfg_path_for_user($root_dir, $user_key);
    if (is_file($fp)) return;
    $legacy = api_group_cfg_legacy_dir() . DIRECTORY_SEPARATOR . api_group_cfg_filename($user_key);
    if (!is_file($legacy)) return;
    // Ensure the durable dir exists before moving into it.
    api_group_cfg_storage_dir($root_dir);
    if (@rename($legacy, $fp) === false) {
        @copy($legacy, $fp);
    }
    @chmod($fp, 0600);
}

function api_group_cfg_user_identity() {
    // Priority 1: real HTTP auth identity (set by nginx/Apache, SSO proxies).
    // Each authenticated user gets their own config — secure default.
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

    // Priority 2: per-browser cookie. Persistent UUID stored in a cookie
    // on first visit. Survives across IP changes (laptop moving between
    // wifi/4G), and stays distinct between two users sharing one IP
    // (NAT/office). Cookie name `du_uid`.
    if (isset($_COOKIE['du_uid'])) {
        $uid = trim((string)$_COOKIE['du_uid']);
        // Only accept the cookie if it looks like one we issued — 32 hex
        // chars. Anything else is treated as missing and gets reissued.
        if (strlen($uid) === 32 && preg_match('/^[0-9a-f]{32}$/i', $uid)) {
            return 'cookie_' . $uid;
        }
    }

    // Issue a new cookie. Use openssl_random_pseudo_bytes if available,
    // fall back to mt_rand (still 128 bits combined).
    $raw = function_exists('openssl_random_pseudo_bytes')
        ? openssl_random_pseudo_bytes(16)
        : pack('N4', mt_rand(), mt_rand(), mt_rand(), mt_rand());
    $uid = bin2hex($raw);

    // 1-year cookie, HttpOnly so JS can't read it (defense in depth — the
    // value is only used server-side anyway), SameSite=Lax so it travels on
    // top-level navigations but not cross-site requests.
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    $expires = time() + (365 * 24 * 60 * 60);
    if (PHP_VERSION_ID >= 70300) {
        @setcookie('du_uid', $uid, array(
            'expires'  => $expires,
            'path'     => '/',
            'secure'   => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ));
    } else {
        // PHP 5.4–7.2 setcookie() signature without options array. Append
        // SameSite via the path field as a hack — works on most browsers.
        @setcookie('du_uid', $uid, $expires, '/; SameSite=Lax', '', $secure, true);
    }
    // Make the new value visible inside this same request too.
    $_COOKIE['du_uid'] = $uid;
    return 'cookie_' . $uid;
}

function api_group_cfg_path_for_user($root_dir, $user_key) {
    return api_group_cfg_storage_dir($root_dir) . DIRECTORY_SEPARATOR . api_group_cfg_filename($user_key);
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

function api_group_cfg_load($root_dir, $user_key) {
    $fp = api_group_cfg_path_for_user($root_dir, $user_key);
    $parsed = api_load_json_file($fp);
    return api_group_cfg_sanitize($parsed);
}

function api_group_cfg_save($root_dir, $user_key, $payload) {
    $dir = api_group_cfg_storage_dir($root_dir);
    if (!is_dir($dir) || !is_writable($dir)) {
        b64_error('Server config storage is not writable.', 500);
    }

    $clean = api_group_cfg_sanitize($payload);
    $fp = api_group_cfg_path_for_user($root_dir, $user_key);
    $tmp = $fp . '.tmp.' . getmypid() . '.' . mt_rand(1000, 9999);
    $json = json_encode($clean);
    if ($json === false) b64_error('Failed to encode config payload.', 500);

    if (@file_put_contents($tmp, $json, LOCK_EX) === false) {
        @unlink($tmp);
        b64_error('Failed to write server config.', 500);
    }
    @rename($tmp, $fp);
    @chmod($fp, 0600);

    return $clean;
}

function api_handle_group_config($root_dir) {
    $user_key = api_group_cfg_user_identity();
    api_group_cfg_migrate_legacy($root_dir, $user_key);
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

        $saved = api_group_cfg_save($root_dir, $user_key, $parsed);
        b64_success(array(
            'user_key' => $user_key,
            'config' => $saved,
        ));
    }

    $loaded = api_group_cfg_load($root_dir, $user_key);
    b64_success(array(
        'user_key' => $user_key,
        'config' => $loaded,
    ));
}
