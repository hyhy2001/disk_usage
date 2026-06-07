<?php

function api_admin_db_dir($root_dir) {
    return $root_dir . DIRECTORY_SEPARATOR . DU_ADMIN_DB_DIRNAME;
}

function api_admin_db_path($root_dir) {
    return api_admin_db_dir($root_dir) . DIRECTORY_SEPARATOR . DU_ADMIN_DB_FILENAME;
}

function api_admin_db_legacy_path($root_dir) {
    return api_admin_db_dir($root_dir) . DIRECTORY_SEPARATOR . DU_ADMIN_DB_LEGACY_FILE;
}

function api_admin_ensure_db($root_dir) {
    $dir = api_admin_db_dir($root_dir);
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }
    @chmod($dir, 0777);

    if (!is_writable($dir)) {
        b64_error('Admin database directory is not writable: ' . $dir, 500);
    }

    if (!class_exists('PDO')) {
        b64_error('PDO is not available on this server.', 500);
    }

    $db_path = api_admin_db_path($root_dir);
    $legacy_path = api_admin_db_legacy_path($root_dir);
    if (!is_file($db_path) && is_file($legacy_path)) {
        // Best effort migration from legacy name.
        if (@rename($legacy_path, $db_path) === false) {
            // If rename fails (permissions/cross-device), fallback to copy.
            if (@copy($legacy_path, $db_path) === false) {
                // Last fallback: keep using legacy file for compatibility.
                $db_path = $legacy_path;
            }
        }
    }

    try {
        $pdo = new PDO('sqlite:' . $db_path);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS admins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )'
        );
        // Rate-limit table for login throttling. One row per failed attempt;
        // success wipes the row set for that IP.
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS login_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ip TEXT NOT NULL,
                ts INTEGER NOT NULL
            )'
        );
        $pdo->exec('CREATE INDEX IF NOT EXISTS ix_login_attempts_ip ON login_attempts(ip, ts)');
        return $pdo;
    } catch (Exception $e) {
        // Don't leak SQLite/PDO error details to the client — log them
        // server-side and return a generic 500 instead.
        error_log('admin db open failed: ' . $e->getMessage());
        b64_error('Failed to open admin database.', 500);
    }
}

// Rate-limit constants. 5 failed attempts within 5 minutes locks an IP for
// the rest of the window. Successful login wipes that IP's attempt history.
function api_admin_rate_limit_config() {
    return array('window_seconds' => 300, 'max_attempts' => 5);
}

function api_admin_client_ip() {
    $ip = isset($_SERVER['REMOTE_ADDR']) ? trim((string)$_SERVER['REMOTE_ADDR']) : '';
    return $ip === '' ? 'unknown' : $ip;
}

// Returns array(allowed, attempts_in_window). Allowed = false → caller should 429.
function api_admin_rate_limit_check($pdo) {
    $cfg = api_admin_rate_limit_config();
    $ip = api_admin_client_ip();
    $cutoff = time() - (int)$cfg['window_seconds'];
    try {
        // Cheap janitor: drop expired rows for THIS IP only (avoids unbounded growth).
        $stmt = $pdo->prepare('DELETE FROM login_attempts WHERE ip = ? AND ts < ?');
        $stmt->execute(array($ip, $cutoff));

        $stmt = $pdo->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip = ?');
        $stmt->execute(array($ip));
        $count = (int)$stmt->fetchColumn();
    } catch (Exception $e) {
        error_log('rate_limit_check failed: ' . $e->getMessage());
        // Fail open on DB error — better than locking out the legitimate
        // admin from a stuck DB. The login itself still requires correct creds.
        return array(true, 0);
    }
    return array($count < $cfg['max_attempts'], $count);
}

function api_admin_rate_limit_record_failure($pdo) {
    $ip = api_admin_client_ip();
    try {
        $stmt = $pdo->prepare('INSERT INTO login_attempts(ip, ts) VALUES (?, ?)');
        $stmt->execute(array($ip, time()));
    } catch (Exception $e) {
        error_log('rate_limit_record_failure failed: ' . $e->getMessage());
    }
}

function api_admin_rate_limit_clear($pdo) {
    $ip = api_admin_client_ip();
    try {
        $stmt = $pdo->prepare('DELETE FROM login_attempts WHERE ip = ?');
        $stmt->execute(array($ip));
    } catch (Exception $e) {
        error_log('rate_limit_clear failed: ' . $e->getMessage());
    }
}

function api_admin_session_start() {
    if (session_id() !== '') return;

    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    // SameSite=Lax on the session cookie mitigates CSRF against the
    // session-only admin endpoints (no CSRF token exists). PHP >= 7.3 takes an
    // options array; older PHP has no SameSite arg, so smuggle it via the path
    // field (same hack as group_config.php) — accepted by most browsers.
    if (PHP_VERSION_ID >= 70300) {
        @session_set_cookie_params(array(
            'lifetime' => 0,
            'path'     => '/',
            'secure'   => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ));
    } else {
        @session_set_cookie_params(0, '/; SameSite=Lax', '', $secure, true);
    }
    @session_start();
}

function api_admin_is_authenticated() {
    api_admin_session_start();
    return !empty($_SESSION['du_admin_auth']) && $_SESSION['du_admin_auth'] === true;
}

// --- CSRF (synchronizer token) ---------------------------------------------
// A per-session random token is handed to the client via the `status` action
// and required on state-changing actions. A cross-site attacker cannot read
// the token (Same-Origin Policy blocks reading the JSON response), so they
// cannot forge a matching request even with the session cookie auto-sent.
function api_admin_csrf_token() {
    api_admin_session_start();
    if (empty($_SESSION['du_csrf'])) {
        $raw = function_exists('openssl_random_pseudo_bytes')
            ? openssl_random_pseudo_bytes(32)
            : pack('N8', mt_rand(), mt_rand(), mt_rand(), mt_rand(),
                          mt_rand(), mt_rand(), mt_rand(), mt_rand());
        $_SESSION['du_csrf'] = bin2hex($raw);
    }
    return $_SESSION['du_csrf'];
}

function api_admin_require_csrf() {
    $expected = api_admin_csrf_token();
    $sent = isset($_SERVER['HTTP_X_CSRF_TOKEN']) ? (string)$_SERVER['HTTP_X_CSRF_TOKEN'] : '';
    if ($sent === '') $sent = (string)param('csrf_token', '');
    if ($sent === '' || !api_admin_hash_equals($expected, $sent)) {
        b64_error('Invalid or missing CSRF token.', 403);
    }
}

function api_admin_current_user() {
    api_admin_session_start();
    return isset($_SESSION['du_admin_user']) ? (string)$_SESSION['du_admin_user'] : '';
}

function api_admin_require_auth() {
    if (!api_admin_is_authenticated()) {
        b64_error('Unauthorized', 401);
    }
}

function api_admin_validate_username($username) {
    $username = trim((string)$username);
    if ($username === '') {
        b64_error('Username is required.', 422);
    }
    if (strlen($username) < 3 || strlen($username) > 64) {
        b64_error('Username must be between 3 and 64 characters.', 422);
    }
    if (!preg_match('/^[a-zA-Z0-9._-]+$/', $username)) {
        b64_error('Username may only contain letters, numbers, dot, underscore, and dash.', 422);
    }
    return $username;
}

function api_admin_validate_password($password) {
    $password = (string)$password;
    if (strlen($password) < 10) {
        b64_error('Password must be at least 10 characters.', 422);
    }
    return $password;
}

function api_admin_json_error_message() {
    if (function_exists('json_last_error_msg')) {
        return json_last_error_msg();
    }
    $code = json_last_error();
    $map = array(
        JSON_ERROR_NONE => 'No error',
        JSON_ERROR_DEPTH => 'Maximum stack depth exceeded',
        JSON_ERROR_STATE_MISMATCH => 'Underflow or modes mismatch',
        JSON_ERROR_CTRL_CHAR => 'Unexpected control character found',
        JSON_ERROR_SYNTAX => 'Syntax error, malformed JSON',
        JSON_ERROR_UTF8 => 'Malformed UTF-8 characters',
    );
    return isset($map[$code]) ? $map[$code] : ('JSON error code: ' . $code);
}

function api_admin_pbkdf2($password, $salt, $iterations, $length) {
    $hash_len = 32;
    $blocks = ceil($length / $hash_len);
    $output = '';

    for ($i = 1; $i <= $blocks; $i++) {
        $ib = $salt . pack('N', $i);
        $h = hash_hmac('sha256', $ib, $password, true);
        $result = $h;
        for ($j = 1; $j < $iterations; $j++) {
            $h = hash_hmac('sha256', $h, $password, true);
            $result = $result ^ $h;
        }
        $output .= $result;
    }

    return substr($output, 0, $length);
}

function api_admin_hash_password($password) {
    if (function_exists('password_hash')) {
        $hash = password_hash($password, PASSWORD_DEFAULT);
        if ($hash !== false) return $hash;
    }

    $iterations = 120000;
    $salt_raw = function_exists('openssl_random_pseudo_bytes')
        ? openssl_random_pseudo_bytes(16)
        : substr(md5(uniqid(mt_rand(), true), true), 0, 16);
    $salt = bin2hex($salt_raw);
    $raw = api_admin_pbkdf2($password, hex2bin($salt), $iterations, 32);
    return 'pbkdf2$' . $iterations . '$' . $salt . '$' . bin2hex($raw);
}

function api_admin_hash_equals($a, $b) {
    if (function_exists('hash_equals')) {
        return hash_equals($a, $b);
    }
    if (!is_string($a) || !is_string($b)) return false;
    if (strlen($a) !== strlen($b)) return false;
    $diff = 0;
    for ($i = 0; $i < strlen($a); $i++) {
        $diff |= ord($a[$i]) ^ ord($b[$i]);
    }
    return $diff === 0;
}

function api_admin_verify_password($password, $stored_hash) {
    if (strpos($stored_hash, 'pbkdf2$') === 0) {
        $parts = explode('$', $stored_hash);
        if (count($parts) !== 4) return false;
        $iterations = (int)$parts[1];
        $salt_hex = $parts[2];
        $expected_hex = $parts[3];
        if ($iterations <= 0 || $salt_hex === '' || $expected_hex === '') return false;

        $calc = api_admin_pbkdf2($password, hex2bin($salt_hex), $iterations, 32);
        return api_admin_hash_equals($expected_hex, bin2hex($calc));
    }

    if (function_exists('password_verify')) {
        return password_verify($password, $stored_hash);
    }

    return false;
}

function api_admin_count($pdo) {
    $stmt = $pdo->query('SELECT COUNT(*) AS c FROM admins');
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return isset($row['c']) ? (int)$row['c'] : 0;
}

function api_admin_get_first_account($pdo) {
    $stmt = $pdo->query('SELECT id, username, password_hash FROM admins ORDER BY id ASC LIMIT 1');
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ? $row : null;
}

function api_admin_handle_status($root_dir) {
    $pdo = api_admin_ensure_db($root_dir);
    $has_admin = api_admin_count($pdo) > 0;
    b64_success(array(
        'has_admin' => $has_admin,
        'authenticated' => api_admin_is_authenticated(),
        'username' => api_admin_current_user(),
        'csrf_token' => api_admin_csrf_token(),
    ));
}

function api_admin_handle_setup($root_dir) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        b64_error('Method not allowed.', 405);
    }

    $pdo = api_admin_ensure_db($root_dir);
    if (api_admin_count($pdo) > 0) {
        b64_error('Admin account already exists. Setup is locked.', 409);
    }

    $username = api_admin_validate_username(param('username', ''));
    $password = api_admin_validate_password(get_b64_param('password', ''));

    $hash = api_admin_hash_password($password);
    $created_at = gmdate('c');

    try {
        $stmt = $pdo->prepare('INSERT INTO admins (username, password_hash, created_at) VALUES (:u, :p, :c)');
        $stmt->execute(array(':u' => $username, ':p' => $hash, ':c' => $created_at));
    } catch (Exception $e) {
        b64_error('Failed to create admin account.', 500);
    }

    api_admin_session_start();
    $_SESSION['du_admin_auth'] = true;
    $_SESSION['du_admin_user'] = $username;

    b64_success(array(
        'created' => true,
        'username' => $username,
    ));
}

function api_admin_handle_login($root_dir) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        b64_error('Method not allowed.', 405);
    }

    $pdo = api_admin_ensure_db($root_dir);

    // Throttle before doing any password comparison — defense-in-depth
    // against brute force. Returns 429 with retry hint when limit hit.
    list($allowed, $attempts) = api_admin_rate_limit_check($pdo);
    if (!$allowed) {
        $cfg = api_admin_rate_limit_config();
        b64_error(
            'Too many failed login attempts. Please try again in '
                . (int)$cfg['window_seconds'] . ' seconds.',
            429
        );
    }

    $account = api_admin_get_first_account($pdo);
    if (!$account) {
        b64_error('Admin setup has not been completed yet.', 409);
    }

    $username = trim((string)param('username', ''));
    $password = (string)get_b64_param('password', '');

    if (!api_admin_hash_equals((string)$account['username'], $username)) {
        api_admin_rate_limit_record_failure($pdo);
        b64_error('Invalid username or password.', 401);
    }

    if (!api_admin_verify_password($password, (string)$account['password_hash'])) {
        api_admin_rate_limit_record_failure($pdo);
        b64_error('Invalid username or password.', 401);
    }

    // Successful login wipes attempt history for this IP.
    api_admin_rate_limit_clear($pdo);

    api_admin_session_start();
    $_SESSION['du_admin_auth'] = true;
    $_SESSION['du_admin_user'] = (string)$account['username'];

    b64_success(array(
        'authenticated' => true,
        'username' => (string)$account['username'],
    ));
}

function api_admin_handle_logout() {
    api_admin_require_csrf();
    api_admin_session_start();
    $_SESSION = array();
    if (session_id() !== '') {
        @session_destroy();
    }
    b64_success(array('ok' => true));
}

function api_admin_read_disks_json($root_dir) {
    api_admin_require_auth();
    $path = $root_dir . DIRECTORY_SEPARATOR . DU_DISKS_CONFIG_FILENAME;
    if (!is_file($path)) {
        b64_error(DU_DISKS_CONFIG_FILENAME . ' not found.', 404);
    }

    $content = @file_get_contents($path);
    if ($content === false) {
        b64_error('Unable to read ' . DU_DISKS_CONFIG_FILENAME . '.', 500);
    }

    $decoded = json_decode($content, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        b64_error(DU_DISKS_CONFIG_FILENAME . ' is not valid JSON: ' . api_admin_json_error_message(), 500);
    }

    b64_success(array(
        'path' => DU_DISKS_CONFIG_FILENAME,
        'content' => json_encode($decoded, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),
    ));
}

function api_admin_backup_dir($root_dir) {
    return api_admin_db_dir($root_dir) . DIRECTORY_SEPARATOR . DU_ADMIN_BACKUP_DIRNAME;
}

function api_admin_create_disks_backup($root_dir, $source_path) {
    if (!is_file($source_path)) return null;

    $backup_dir = api_admin_backup_dir($root_dir);
    if (!is_dir($backup_dir)) {
        @mkdir($backup_dir, 0777, true);
    }
    @chmod($backup_dir, 0777);

    if (!is_writable($backup_dir)) {
        // Backup is best-effort. Do not block saving if backup dir is not writable.
        return null;
    }

    $timestamp = gmdate('Ymd_His');
    $backup_filename = 'disks_backup_' . $timestamp . '_' . substr(md5(uniqid('', true)), 0, 8) . '.json';
    $backup_path = $backup_dir . DIRECTORY_SEPARATOR . $backup_filename;

    $raw = @file_get_contents($source_path);
    if ($raw === false) {
        return null;
    }

    $ok = @file_put_contents($backup_path, $raw, LOCK_EX);
    if ($ok === false) {
        return null;
    }

    // Keep only latest 50 backups.
    $items = glob($backup_dir . DIRECTORY_SEPARATOR . 'disks_backup_*.json');
    if (is_array($items) && count($items) > 50) {
        usort($items, function($a, $b) {
            return strcmp($b, $a);
        });
        for ($i = 50; $i < count($items); $i++) {
            @unlink($items[$i]);
        }
    }

    return 'database/backups/' . $backup_filename;
}

function api_admin_list_backups($root_dir) {
    api_admin_require_auth();
    $backup_dir = api_admin_backup_dir($root_dir);
    if (!is_dir($backup_dir)) {
        b64_success(array('items' => array()));
    }

    $items = glob($backup_dir . DIRECTORY_SEPARATOR . 'disks_backup_*.json');
    if (!is_array($items)) $items = array();

    usort($items, function($a, $b) {
        return strcmp($b, $a);
    });

    $result = array();
    foreach ($items as $path) {
        if (!is_file($path)) continue;
        $name = basename($path);
        $mtime = @filemtime($path);
        $size = @filesize($path);
        $result[] = array(
            'name' => $name,
            'path' => 'database/backups/' . $name,
            'mtime' => $mtime ? gmdate('c', $mtime) : null,
            'size' => $size !== false ? (int)$size : 0,
        );
        if (count($result) >= 100) break;
    }

    b64_success(array('items' => $result));
}

function api_admin_restore_backup($root_dir) {
    api_admin_require_auth();
    api_admin_require_csrf();
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        b64_error('Method not allowed.', 405);
    }

    $backup_name = trim((string)param('backup_name', ''));
    if ($backup_name === '') {
        b64_error('backup_name is required.', 422);
    }
    if (!preg_match('/^disks_backup_[a-zA-Z0-9_\-\.]+\.json$/', $backup_name)) {
        b64_error('Invalid backup file name.', 422);
    }

    $backup_path = api_admin_backup_dir($root_dir) . DIRECTORY_SEPARATOR . $backup_name;
    if (!is_file($backup_path)) {
        b64_error('Backup file not found.', 404);
    }

    $raw = @file_get_contents($backup_path);
    if ($raw === false) {
        b64_error('Unable to read backup file.', 500);
    }

    $decoded = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        b64_error('Backup JSON is invalid: ' . api_admin_json_error_message(), 500);
    }

    $normalized = json_encode($decoded, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if ($normalized === false) {
        b64_error('Unable to normalize backup JSON.', 500);
    }

    $disks_path = $root_dir . DIRECTORY_SEPARATOR . DU_DISKS_CONFIG_FILENAME;
    $pre_restore_backup = api_admin_create_disks_backup($root_dir, $disks_path);

    $ok = @file_put_contents($disks_path, $normalized . PHP_EOL, LOCK_EX);
    if ($ok === false) {
        error_log('admin restore_backup: failed to write ' . $disks_path . ' from ' . $backup_name);
        b64_error('Failed to restore ' . DU_DISKS_CONFIG_FILENAME . ' from backup.', 500);
    }

    b64_success(array(
        'restored' => true,
        'restored_from' => 'database/backups/' . $backup_name,
        'pre_restore_backup' => $pre_restore_backup,
    ));
}

function api_admin_save_disks_json($root_dir) {
    api_admin_require_auth();
    api_admin_require_csrf();
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        b64_error('Method not allowed.', 405);
    }

    $json_text = trim((string)get_b64_param('content', ''));
    if ($json_text === '') {
        b64_error('Content is required.', 422);
    }

    $decoded = json_decode($json_text, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        b64_error('Invalid JSON: ' . api_admin_json_error_message(), 422);
    }

    $normalized = json_encode($decoded, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if ($normalized === false) {
        b64_error('Unable to encode JSON content.', 500);
    }

    $path = $root_dir . DIRECTORY_SEPARATOR . DU_DISKS_CONFIG_FILENAME;
    if (is_file($path) && !is_writable($path)) {
        @chmod($path, 0666);
    }
    if (!is_file($path) && !is_writable(dirname($path))) {
        b64_error('Directory is not writable for ' . DU_DISKS_CONFIG_FILENAME . ': ' . dirname($path), 500);
    }

    $backup_file = api_admin_create_disks_backup($root_dir, $path);
    $ok = @file_put_contents($path, $normalized . PHP_EOL, LOCK_EX);
    if ($ok === false) {
        error_log('admin save_disks: failed to write ' . $path);
        b64_error('Failed to write ' . DU_DISKS_CONFIG_FILENAME . ' at: ' . $path . '. Check file permission.', 500);
    }

    b64_success(array(
        'saved' => true,
        'bytes' => strlen($normalized),
        'backup_file' => $backup_file,
    ));
}

function api_handle_admin($root_dir) {
    header('Content-Type: application/json; charset=utf-8');
    $action = param('action', 'status');

    if ($action === 'status') {
        api_admin_handle_status($root_dir);
    }
    if ($action === 'setup') {
        api_admin_handle_setup($root_dir);
    }
    if ($action === 'login') {
        api_admin_handle_login($root_dir);
    }
    if ($action === 'logout') {
        api_admin_handle_logout();
    }
    if ($action === 'get_disks') {
        api_admin_read_disks_json($root_dir);
    }
    if ($action === 'save_disks') {
        api_admin_save_disks_json($root_dir);
    }
    if ($action === 'list_backups') {
        api_admin_list_backups($root_dir);
    }
    if ($action === 'restore_backup') {
        api_admin_restore_backup($root_dir);
    }

    b64_error('Unknown admin action.', 400);
}
