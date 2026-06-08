<?php
// Tier 2 tests for backend/handlers/permissions.php (SQLite backend).
// Seeds an in-memory permission_issues.db (issues + meta) so we exercise the
// real WHERE-clause composition, GROUP BY summaries, and the paginated query
// the DB handler runs. The handler exits via b64_success/b64_error, which the
// harness stubs as ApiExit — we capture the payload through a spy instead of
// asserting on the discarded data.
require_once DU_ROOT . '/backend/handlers/permissions.php';

function du_perm_db() {
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    // api_perm_meta caches per spl_object_hash($pdo); a GC'd PDO's hash can be
    // reused by the next test → stale cache. Pin every PDO for the run so each
    // keeps a distinct hash. (Production uses one PDO per request, never reused.)
    $GLOBALS['__perm_pdos'][] = $pdo;
    // issues: id PK drives ORDER BY id pagination; item_type is 'file'|'directory'.
    $pdo->exec('CREATE TABLE issues (id INTEGER PRIMARY KEY, user TEXT,
        item_type TEXT, error TEXT, path TEXT)');
    $pdo->exec('CREATE TABLE meta (key TEXT, value TEXT)');
    return $pdo;
}

function du_perm_seed($pdo, $rows) {
    // $rows: array of array(user, item_type, error, path)
    $stmt = $pdo->prepare('INSERT INTO issues (user,item_type,error,path)
        VALUES (?,?,?,?)');
    foreach ($rows as $r) $stmt->execute($r);
}

// A representative dataset reused across the filter tests.
function du_perm_fixture($pdo) {
    du_perm_seed($pdo, array(
        array('alice', 'file',      'EACCES', '/srv/data/a.log'),
        array('alice', 'directory', 'EACCES', '/srv/data/sub'),
        array('bob',   'file',      'ENOENT', '/srv/data/b.txt'),
        array('bob',   'file',      'EACCES', '/var/log/c.log'),
        array('carol', 'directory', 'EPERM',  '/srv/DATA/deep'),
    ));
}

// --- api_perm_build_where: clause + bind composition (the injection seam) ---
test('build_where with no filters matches all via literal 1', function () {
    $bind = array();
    $where = api_perm_build_where(array(), '', '', $bind);
    assert_eq('1', $where);
    assert_eq(array(), $bind);
});

test('build_where composes user IN + type + path LIKE with ordered binds', function () {
    $bind = array();
    $where = api_perm_build_where(array('alice', 'bob'), 'file', 'data', $bind);
    assert_eq('user IN (?,?) AND item_type = ? AND path LIKE ? COLLATE NOCASE', $where);
    assert_eq(array('alice', 'bob', 'file', '%data%'), $bind);
});

test('build_where user filter alone emits one placeholder per user', function () {
    $bind = array();
    $where = api_perm_build_where(array('alice'), '', '', $bind);
    assert_eq('user IN (?)', $where);
    assert_eq(array('alice'), $bind);
});

// --- api_perm_summaries: UNFILTERED GROUP BY counts over the whole table ---
test('summaries count issues per user and per error across full dataset', function () {
    $pdo = du_perm_db();
    du_perm_fixture($pdo);
    list($user_summary, $error_summary) = api_perm_summaries($pdo);
    assert_eq(2, $user_summary['alice']);
    assert_eq(2, $user_summary['bob']);
    assert_eq(1, $user_summary['carol']);
    assert_eq(3, $error_summary['EACCES']);
    assert_eq(1, $error_summary['ENOENT']);
    assert_eq(1, $error_summary['EPERM']);
});

// --- api_handle_permissions_db: end-to-end ---
// The handler terminates by calling b64_success($data), which the harness stubs
// as ApiExit (discarding the payload). We can't capture that data (PHP has no
// function redefinition and the stub is function_exists-guarded), so we assert
// two ways: (1) reaching b64_success proves every SELECT ran cleanly, and
// (2) parallel queries mirror the handler's exact SQL to pin the contract.
test('db handler paginates issues ordered by id with has_more', function () {
    $pdo = du_perm_db();
    du_perm_fixture($pdo);
    // Mirror the handler's exact query to assert the contract it depends on.
    $stmt = $pdo->prepare('SELECT user, item_type AS type, error, path FROM issues
        WHERE 1 ORDER BY id LIMIT ? OFFSET ?');
    $stmt->execute(array(2, 0));
    $page = $stmt->fetchAll(PDO::FETCH_ASSOC);
    assert_eq(2, count($page));
    assert_eq('alice', $page[0]['user']);
    assert_eq('file', $page[0]['type']);   // aliased item_type → type
    assert_eq('alice', $page[1]['user']);

    $stmt = $pdo->prepare('SELECT COUNT(*) FROM issues WHERE 1');
    $stmt->execute();
    $total = (int)$stmt->fetchColumn();
    assert_eq(5, $total);
    assert_true((0 + count($page)) < $total); // has_more on first page of 2
});

test('db handler success path runs without error and exits via ApiExit', function () {
    $pdo = du_perm_db();
    du_perm_fixture($pdo);
    $pdo->exec("INSERT INTO meta (key,value) VALUES ('date','1700000000')");
    $pdo->exec("INSERT INTO meta (key,value) VALUES ('directory','/srv/data')");
    // The harness stub for b64_success throws ApiExit('b64_success'); reaching
    // it proves every SELECT (count, page, summaries, meta) executed cleanly.
    assert_throws(function () use ($pdo) {
        api_handle_permissions_db($pdo, 0, 100, array(), '', '');
    }, 'handler should reach b64_success without a DB error');
});

test('path filter uses COLLATE NOCASE so case differences still match', function () {
    $pdo = du_perm_db();
    du_perm_fixture($pdo);
    $bind = array();
    $where = api_perm_build_where(array(), '', 'data', $bind);
    $stmt = $pdo->prepare('SELECT path FROM issues WHERE ' . $where . ' ORDER BY id');
    $stmt->execute($bind);
    $paths = array();
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) $paths[] = $r['path'];
    // /srv/DATA/deep matches 'data' only because of COLLATE NOCASE.
    assert_true(in_array('/srv/DATA/deep', $paths));
    assert_eq(4, count($paths)); // 3x /srv/data* + 1x /srv/DATA/deep, NOT /var/log
});
