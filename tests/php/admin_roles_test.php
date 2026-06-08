<?php
// Tier 1/2 tests for multi-admin roles + official group-config gating.
// Reuses the in-memory-SQLite + ApiExit pattern from the other suites.
require_once DU_ROOT . '/backend/lib/request.php';
require_once DU_ROOT . '/backend/lib/filesystem.php';   // api_load_json_file
require_once DU_ROOT . '/backend/handlers/admin.php';
require_once DU_ROOT . '/backend/handlers/group_config.php';

// Build an in-memory admins DB mirroring api_admin_ensure_db's schema INCLUDING
// the role column, so we can exercise role queries without touching disk.
function du_admin_db() {
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $GLOBALS['__admin_pdos'][] = $pdo; // pin so spl_object_hash stays unique
    $pdo->exec('CREATE TABLE admins (id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL, role TEXT NOT NULL DEFAULT \'admin\')');
    return $pdo;
}

// --- role migration: PRAGMA-guarded ALTER on a pre-role DB ---
test('role migration adds column to a legacy admins table', function () {
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $GLOBALS['__admin_pdos'][] = $pdo;
    // Legacy schema: NO role column.
    $pdo->exec('CREATE TABLE admins (id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL)');
    $pdo->exec("INSERT INTO admins (username,password_hash,created_at) VALUES ('old','h','t')");

    // Replicate the migration block from api_admin_ensure_db.
    $has_role = false;
    foreach ($pdo->query('PRAGMA table_info(admins)')->fetchAll(PDO::FETCH_ASSOC) as $col) {
        if (isset($col['name']) && $col['name'] === 'role') { $has_role = true; break; }
    }
    assert_eq(false, $has_role, 'legacy table starts without role');
    if (!$has_role) {
        $pdo->exec("ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
    }
    // After migration the existing row defaults to 'admin'.
    $row = $pdo->query("SELECT role FROM admins WHERE username='old'")->fetch(PDO::FETCH_ASSOC);
    assert_eq('admin', $row['role']);
});

// --- owner backfill: a roleless DB promotes its earliest account to owner ---
test('owner backfill promotes the earliest account when none is owner', function () {
    $pdo = du_admin_db(); // has role column, all default 'admin'
    $pdo->exec("INSERT INTO admins (username,password_hash,created_at,role)
                VALUES ('first','h','t1','admin'),('second','h','t2','admin')");
    // Replicate the backfill block from api_admin_ensure_db.
    $owner_cnt = (int)$pdo->query("SELECT COUNT(*) FROM admins WHERE role = 'owner'")->fetchColumn();
    assert_eq(0, $owner_cnt);
    if ($owner_cnt === 0) {
        $pdo->exec("UPDATE admins SET role = 'owner'
                    WHERE id = (SELECT id FROM admins ORDER BY id ASC LIMIT 1)");
    }
    $a = api_admin_get_by_username($pdo, 'first');
    $b = api_admin_get_by_username($pdo, 'second');
    assert_eq('owner', $a['role'], 'earliest account becomes owner');
    assert_eq('admin', $b['role'], 'later accounts stay admin');
});

test('owner backfill is a no-op when an owner already exists', function () {
    $pdo = du_admin_db();
    $pdo->exec("INSERT INTO admins (username,password_hash,created_at,role)
                VALUES ('a','h','t1','admin'),('theowner','h','t2','owner')");
    $owner_cnt = (int)$pdo->query("SELECT COUNT(*) FROM admins WHERE role = 'owner'")->fetchColumn();
    assert_eq(1, $owner_cnt);
    if ($owner_cnt === 0) {
        $pdo->exec("UPDATE admins SET role = 'owner'
                    WHERE id = (SELECT id FROM admins ORDER BY id ASC LIMIT 1)");
    }
    // 'a' must stay admin — backfill should not run.
    assert_eq('admin', api_admin_get_by_username($pdo, 'a')['role']);
    assert_eq('owner', api_admin_get_by_username($pdo, 'theowner')['role']);
});

// --- api_admin_get_by_username ---
test('get_by_username returns the matching account with role', function () {
    $pdo = du_admin_db();
    $pdo->exec("INSERT INTO admins (username,password_hash,created_at,role)
                VALUES ('owner1','h1','t','owner'),('admin2','h2','t','admin')");
    $a = api_admin_get_by_username($pdo, 'owner1');
    assert_eq('owner1', $a['username']);
    assert_eq('owner', $a['role']);
    $b = api_admin_get_by_username($pdo, 'admin2');
    assert_eq('admin', $b['role']);
    assert_eq(null, api_admin_get_by_username($pdo, 'ghost'));
});

// --- role gate helpers (session-driven) ---
test('require_owner allows owner, blocks admin', function () {
    @session_start();
    $_SESSION = array('du_admin_auth' => true, 'du_admin_role' => 'owner', 'du_admin_id' => 1);
    api_admin_require_owner(); // no throw
    assert_true(true);

    $_SESSION = array('du_admin_auth' => true, 'du_admin_role' => 'admin', 'du_admin_id' => 2);
    assert_throws(function () { api_admin_require_owner(); }, 'admin must be blocked from owner-only');
});

test('require_owner blocks unauthenticated', function () {
    $_SESSION = array();
    assert_throws(function () { api_admin_require_owner(); });
});

test('current_role / current_id read the session', function () {
    $_SESSION = array('du_admin_auth' => true, 'du_admin_role' => 'admin', 'du_admin_id' => 7);
    assert_eq('admin', api_admin_current_role());
    assert_eq(7, api_admin_current_id());
    $_SESSION = array();
    assert_eq('', api_admin_current_role());
    assert_eq(0, api_admin_current_id());
});

// --- official group-config save/load roundtrip (real temp dir) ---
test('official config save then load roundtrips through sanitize', function () {
    $root = sys_get_temp_dir() . '/du_gcfg_test_' . getmypid() . '_' . mt_rand(1000, 9999);
    @mkdir($root . '/database/group_config', 0700, true);
    $payload = array(
        'groups' => array(
            array('id' => 'g1', 'name' => 'Team A', 'diskUsers' => array('disk_x' => array('bob', 'alice', 'bob'))),
        ),
        'seeded_disks' => array('disk_x' => true),
    );
    $saved = api_group_cfg_save_official($root, $payload);
    assert_eq(3, $saved['schema_version']);
    assert_eq('Team A', $saved['groups'][0]['name']);
    // sanitize dedups + sorts users.
    assert_eq(array('alice', 'bob'), $saved['groups'][0]['diskUsers']['disk_x']);

    $loaded = api_group_cfg_load_official($root);
    assert_eq('g1', $loaded['groups'][0]['id']);
    assert_eq(true, $loaded['seeded_disks']['disk_x']);

    // cleanup
    @unlink(api_group_cfg_official_path($root));
    @rmdir($root . '/database/group_config');
    @rmdir($root . '/database');
    @rmdir($root);
});

test('load_official returns null when no official config exists', function () {
    $root = sys_get_temp_dir() . '/du_gcfg_none_' . getmypid() . '_' . mt_rand(1000, 9999);
    @mkdir($root . '/database/group_config', 0700, true);
    assert_eq(null, api_group_cfg_load_official($root));
    @rmdir($root . '/database/group_config');
    @rmdir($root . '/database');
    @rmdir($root);
});

// --- save gate: official save requires an authenticated admin ---
test('group_config save is blocked for unauthenticated visitors (401)', function () {
    $_SESSION = array(); // not logged in
    $_GET = array('action' => 'save'); $_POST = array();
    // api_handle_group_config calls api_admin_require_auth() first on save →
    // ApiExit(401) via the b64_error stub before any write happens.
    assert_throws(function () {
        api_handle_group_config(sys_get_temp_dir());
    }, 'guest save must be rejected');
});

// --- disk-mapping actions are owner-only (not just any admin) ---
test('disk-mapping handlers reject a non-owner admin (owner gate)', function () {
    @session_start();
    // A regular admin (authenticated, role=admin) must be blocked.
    $_SESSION = array('du_admin_auth' => true, 'du_admin_role' => 'admin', 'du_admin_id' => 5);
    $root = sys_get_temp_dir();
    assert_throws(function () use ($root) { api_admin_read_disks_json($root); }, 'get_disks owner-only');
    assert_throws(function () use ($root) { api_admin_list_backups($root); }, 'list_backups owner-only');
    assert_throws(function () use ($root) { api_admin_save_disks_json($root); }, 'save_disks owner-only');
    assert_throws(function () use ($root) { api_admin_restore_backup($root); }, 'restore_backup owner-only');
});

// --- auto-generated admin password ---
test('generate_password yields the requested length from a safe alphabet', function () {
    $pw = api_admin_generate_password(16);
    assert_eq(16, strlen($pw));
    // No ambiguous chars (0/O/1/l/I) — keeps it copy/read-safe.
    assert_eq(0, preg_match('/[0O1lI]/', $pw), 'must avoid ambiguous characters');
    // Alphanumeric only.
    assert_eq(1, preg_match('/^[A-Za-z2-9]+$/', $pw));
});

test('generate_password is non-deterministic across calls', function () {
    $a = api_admin_generate_password(20);
    $b = api_admin_generate_password(20);
    assert_eq(false, $a === $b, 'two generated passwords should differ');
});

// --- login captcha (session-backed, single-use) ---
test('captcha_ok matches the session answer then consumes it', function () {
    @session_start();
    $_SESSION['du_captcha'] = '42';
    assert_true(api_admin_captcha_ok('42'), 'correct answer passes');
    // Single-use: the same answer must fail the second time (now consumed).
    assert_eq(false, api_admin_captcha_ok('42'), 'captcha is single-use');
});

test('captcha_ok rejects a wrong answer and an empty session', function () {
    @session_start();
    $_SESSION['du_captcha'] = '15';
    assert_eq(false, api_admin_captcha_ok('14'), 'wrong answer fails');
    // Wrong attempt also consumed it, so a follow-up with no challenge fails.
    assert_eq(false, api_admin_captcha_ok('15'), 'no challenge in session fails');
});
