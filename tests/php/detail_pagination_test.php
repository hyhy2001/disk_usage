<?php
// Tier 2 tests for keyset cursor pagination in backend/handlers/detail.php.
// Uses an in-memory SQLite DB seeded with the real schema so we exercise the
// actual WHERE/ORDER BY keyset logic, including size ties (the case most
// likely to silently duplicate or drop rows at a page boundary).
require_once DU_ROOT . '/backend/lib/keyword.php';   // like_clause used by keyword paths
require_once DU_ROOT . '/backend/handlers/detail.php';

function du_detail_db() {
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec('CREATE TABLE users (uid INTEGER, username TEXT, team_id INTEGER,
        total_files INTEGER, total_dirs INTEGER, total_size INTEGER)');
    $pdo->exec('CREATE TABLE dirs (id INTEGER, uid INTEGER, parent_id INTEGER,
        path TEXT, owner_uid INTEGER, size INTEGER, files INTEGER)');
    $pdo->exec('CREATE TABLE file_names (id INTEGER PRIMARY KEY, name TEXT)');
    $pdo->exec('CREATE TABLE files (dir_id INTEGER, name_id INTEGER, ext TEXT,
        uid INTEGER, size INTEGER)');
    $pdo->exec("CREATE TABLE meta (key TEXT, value TEXT)");
    return $pdo;
}

// No-filter filter set (matches api_detail_filters output shape).
function du_nofilter() {
    return array('q' => '', 'ext' => '', 'min' => 0, 'max' => 0);
}

// Walk every page via the cursor and collect a flat ordered list of a field.
function du_page_all_dirs($pdo, $uid, $limit) {
    $out = array(); $cursor = null; $guard = 0;
    do {
        $r = api_detail_dir_rows($pdo, $uid, $cursor, $limit, du_nofilter());
        foreach ($r['rows'] as $row) $out[] = $row;
        $cursor = $r['has_more'] ? api_detail_decode_cursor($r['next_cursor']) : null;
        if (++$guard > 1000) break; // safety
    } while ($cursor !== null);
    return $out;
}
function du_page_all_files($pdo, $uid, $limit) {
    $out = array(); $cursor = null; $guard = 0;
    do {
        $r = api_detail_file_rows($pdo, $uid, $cursor, $limit, du_nofilter());
        foreach ($r['rows'] as $row) $out[] = $row;
        $cursor = $r['has_more'] ? api_detail_decode_cursor($r['next_cursor']) : null;
        if (++$guard > 1000) break;
    } while ($cursor !== null);
    return $out;
}

// --- dirs keyset: (size DESC, id ASC) ---
test('dir pagination is complete and ordered with size ties', function () {
    $pdo = du_detail_db();
    // Sizes chosen with ties (100 appears 3x) to exercise the id tie-break.
    $rows = array(
        array(1, 300), array(2, 100), array(3, 100),
        array(4, 200), array(5, 100), array(6, 50),
    );
    foreach ($rows as $r) {
        $pdo->exec("INSERT INTO dirs (id,uid,parent_id,path,owner_uid,size,files)
                    VALUES ({$r[0]},1,0,'/p/{$r[0]}',0,{$r[1]},1)");
    }
    // Page size 2 forces boundaries to fall inside the size=100 tie group.
    $all = du_page_all_dirs($pdo, 1, 2);
    // Expected order: 300, 200, then 100s by id asc (2,3,5), then 50.
    $paths = array();
    foreach ($all as $r) $paths[] = $r['path'];
    assert_eq(array('/p/1','/p/4','/p/2','/p/3','/p/5','/p/6'), $paths);
    assert_eq(6, count($all), 'no rows dropped or duplicated across pages');
});

test('dir pagination has_more=false on a single full page', function () {
    $pdo = du_detail_db();
    $pdo->exec("INSERT INTO dirs VALUES (1,1,0,'/a',0,10,1)");
    $pdo->exec("INSERT INTO dirs VALUES (2,1,0,'/b',0,5,1)");
    $r = api_detail_dir_rows($pdo, 1, null, 50, du_nofilter());
    assert_eq(2, count($r['rows']));
    assert_eq(false, $r['has_more']);
    assert_eq(null, $r['next_cursor']);
});

test('dir pagination limit=1 walks every row exactly once', function () {
    $pdo = du_detail_db();
    for ($i = 1; $i <= 5; $i++) {
        $pdo->exec("INSERT INTO dirs VALUES ($i,1,0,'/d$i',0,100,1)"); // all tied
    }
    $all = du_page_all_dirs($pdo, 1, 1);
    assert_eq(5, count($all));
});

test('dir min/max size filter narrows result set', function () {
    $pdo = du_detail_db();
    foreach (array(10,20,30,40,50) as $i => $s) {
        $id = $i + 1;
        $pdo->exec("INSERT INTO dirs VALUES ($id,1,0,'/d$id',0,$s,1)");
    }
    $r = api_detail_dir_rows($pdo, 1, null, 50, array('q'=>'','ext'=>'','min'=>20,'max'=>40));
    $sizes = array();
    foreach ($r['rows'] as $row) $sizes[] = $row['used'];
    assert_eq(array(40,30,20), $sizes);
});

// --- files keyset: (size DESC, dir_id ASC, name_id ASC) ---
test('file pagination is complete and ordered with full tie-break', function () {
    $pdo = du_detail_db();
    // name dictionary
    foreach (array(1=>'a.txt',2=>'b.txt',3=>'c.txt') as $id=>$n) {
        $pdo->exec("INSERT INTO file_names (id,name) VALUES ($id,'$n')");
    }
    // dirs for path resolution
    $pdo->exec("INSERT INTO dirs VALUES (10,1,0,'/d10',0,0,0)");
    $pdo->exec("INSERT INTO dirs VALUES (11,1,0,'/d11',0,0,0)");
    // files: size ties across dir_id and name_id to exercise 3-key cursor
    // (size, dir_id, name_id)
    $f = array(
        array(10,1,500), array(10,2,500), array(11,1,500), // size 500 tie group
        array(10,3,800),                                    // largest
        array(11,2,200),
    );
    foreach ($f as $r) {
        $pdo->exec("INSERT INTO files (dir_id,name_id,ext,uid,size)
                    VALUES ({$r[0]},{$r[1]},'txt',1,{$r[2]})");
    }
    $all = du_page_all_files($pdo, 1, 2); // page size 2 splits the 500-tie group
    $paths = array();
    foreach ($all as $r) $paths[] = $r['path'];
    // Order: 800 (d10/c), then 500s by dir_id then name_id:
    //   (10,1)=d10/a, (10,2)=d10/b, (11,1)=d11/a, then 200 (11,2)=d11/b
    assert_eq(array('/d10/c.txt','/d10/a.txt','/d10/b.txt','/d11/a.txt','/d11/b.txt'), $paths);
    assert_eq(5, count($all), 'no file rows dropped or duplicated');
});

test('file ext filter restricts to matching extensions', function () {
    $pdo = du_detail_db();
    $pdo->exec("INSERT INTO file_names (id,name) VALUES (1,'x.log'),(2,'y.txt')");
    $pdo->exec("INSERT INTO dirs VALUES (10,1,0,'/d',0,0,0)");
    $pdo->exec("INSERT INTO files VALUES (10,1,'log',1,100)");
    $pdo->exec("INSERT INTO files VALUES (10,2,'txt',1,200)");
    $r = api_detail_file_rows($pdo, 1, null, 50, array('q'=>'','ext'=>'log','min'=>0,'max'=>0));
    assert_eq(1, count($r['rows']));
    assert_eq('log', $r['rows'][0]['xt']);
});
