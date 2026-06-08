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

// --- CSRF (double-submit cookie) -------------------------------------------
// group_config is intentionally stateless (cookie identity, no PHP session),
// and the SPA calls action=get for every visitor at boot — starting a session
// here would spawn a session file per anonymous visitor. So instead of the
// admin synchronizer-token pattern (which needs $_SESSION), we use a
// double-submit cookie: issue a JS-READABLE `du_csrf` cookie, and require the
// client to echo it in an X-CSRF-Token header on writes. A cross-site attacker
// cannot read the victim's cookie (Same-Origin Policy) nor set it cross-site
// (SameSite=Lax), so cannot forge the matching header — even though the cookie
// auto-sends. The compare reuses the canonical constant-time api_admin_hash_equals.

// Issue the du_csrf cookie if absent, and return its value. Unlike du_uid this
// cookie is NOT HttpOnly — the JS client must read it to echo in the header.
function api_group_cfg_csrf_cookie() {
    if (isset($_COOKIE['du_csrf'])) {
        $tok = trim((string)$_COOKIE['du_csrf']);
        if (strlen($tok) === 32 && preg_match('/^[0-9a-f]{32}$/i', $tok)) {
            return $tok;
        }
    }
    $raw = function_exists('openssl_random_pseudo_bytes')
        ? openssl_random_pseudo_bytes(16)
        : pack('N4', mt_rand(), mt_rand(), mt_rand(), mt_rand());
    $tok = bin2hex($raw);

    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    $expires = time() + (365 * 24 * 60 * 60);
    if (PHP_VERSION_ID >= 70300) {
        @setcookie('du_csrf', $tok, array(
            'expires'  => $expires,
            'path'     => '/',
            'secure'   => $secure,
            'httponly' => false,
            'samesite' => 'Lax',
        ));
    } else {
        @setcookie('du_csrf', $tok, $expires, '/; SameSite=Lax', '', $secure, false);
    }
    $_COOKIE['du_csrf'] = $tok;
    return $tok;
}

// Pure predicate: does the client-sent token match the cookie token? Both must
// be present and well-formed; compare is constant-time. Kept side-effect-free
// so it's unit-testable without cookies/headers.
function api_group_cfg_csrf_ok($cookie_token, $sent_token) {
    $cookie_token = (string)$cookie_token;
    $sent_token = (string)$sent_token;
    if ($cookie_token === '' || $sent_token === '') return false;
    if (!preg_match('/^[0-9a-f]{32}$/i', $cookie_token)) return false;
    return api_admin_hash_equals($cookie_token, $sent_token);
}

// Enforce the double-submit check on a write; 403 + exit on mismatch.
function api_group_cfg_require_csrf() {
    $cookie = isset($_COOKIE['du_csrf']) ? (string)$_COOKIE['du_csrf'] : '';
    $sent = isset($_SERVER['HTTP_X_CSRF_TOKEN']) ? (string)$_SERVER['HTTP_X_CSRF_TOKEN'] : '';
    if ($sent === '') $sent = (string)param('csrf_token', '');
    if (!api_group_cfg_csrf_ok($cookie, $sent)) {
        b64_error('Invalid or missing CSRF token.', 403);
    }
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
        error_log('group_config: failed to write temp file ' . $tmp);
        b64_error('Failed to write server config.', 500);
    }
    if (@rename($tmp, $fp) === false) {
        @unlink($tmp);
        error_log('group_config: failed to rename ' . $tmp . ' -> ' . $fp);
        b64_error('Failed to write server config.', 500);
    }
    @chmod($fp, 0600);

    return $clean;
}

// ── Official (shared) config ───────────────────────────────────────────────
// New model: admins/owner save ONE official config the whole site reads as the
// default. Guests no longer write to the server (they keep a localStorage-only
// copy). Stored as a single file alongside the legacy per-user configs.
function api_group_cfg_official_path($root_dir) {
    return api_group_cfg_storage_dir($root_dir) . DIRECTORY_SEPARATOR . 'official.json';
}

function api_group_cfg_load_official($root_dir) {
    $fp = api_group_cfg_official_path($root_dir);
    if (!is_file($fp)) return null;
    $parsed = api_load_json_file($fp);
    if (!is_array($parsed)) return null;
    return api_group_cfg_sanitize($parsed);
}

function api_group_cfg_save_official($root_dir, $payload) {
    $dir = api_group_cfg_storage_dir($root_dir);
    if (!is_dir($dir) || !is_writable($dir)) {
        b64_error('Server config storage is not writable.', 500);
    }
    $clean = api_group_cfg_sanitize($payload);
    $fp = api_group_cfg_official_path($root_dir);
    $tmp = $fp . '.tmp.' . getmypid() . '.' . mt_rand(1000, 9999);
    $json = json_encode($clean);
    if ($json === false) b64_error('Failed to encode config payload.', 500);
    if (@file_put_contents($tmp, $json, LOCK_EX) === false) {
        @unlink($tmp);
        error_log('group_config: failed to write official temp file ' . $tmp);
        b64_error('Failed to write server config.', 500);
    }
    if (@rename($tmp, $fp) === false) {
        @unlink($tmp);
        error_log('group_config: failed to rename official ' . $tmp . ' -> ' . $fp);
        b64_error('Failed to write server config.', 500);
    }
    @chmod($fp, 0600);
    return $clean;
}

function api_handle_group_config($root_dir) {
    $action = trim((string)param('action', 'get'));

    if ($action === 'save') {
        // Saving the official config is an ADMIN action: it requires an admin
        // session + the admin CSRF token (not the guest double-submit cookie).
        // Guests can no longer write to the server — they save to localStorage.
        api_admin_require_auth();
        api_admin_require_csrf();

        $raw = get_b64_param('config', '');
        if (!is_string($raw) || trim($raw) === '') {
            b64_error('Missing config payload.', 400);
        }
        $parsed = @json_decode($raw, true);
        if (!is_array($parsed)) {
            b64_error('Invalid config JSON payload.', 400);
        }

        $saved = api_group_cfg_save_official($root_dir, $parsed);
        b64_success(array(
            'official' => $saved,
            'saved' => true,
        ));
    }

    // GET (anyone, no auth): return the official config (or null) plus whether
    // the current visitor is an admin and their role, so the client knows
    // whether to show "Save as official" vs guest localStorage-only behaviour.
    $official = api_group_cfg_load_official($root_dir);
    b64_success(array(
        'official' => $official,
        'is_admin' => api_admin_is_authenticated(),
        'role' => api_admin_current_role(),
    ));
}
