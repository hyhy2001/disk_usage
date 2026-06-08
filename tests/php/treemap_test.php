<?php
// Tier 2 tests for backend/handlers/treemap.php (SQLite treemap.db backend).
// Seeds an in-memory DB with the real treemap schema (dirs + names + owners +
// meta) and exercises the two query functions directly — they RETURN their
// result arrays (the handler is what calls b64_success), so we can assert on
// items/total/has_more, ordering, the synthetic [files] pseudo-node, node_type
// filtering, owner resolution, and full-path reconstruction.
require_once DU_ROOT . '/backend/lib/path_resolver.php'; // api_path_resolve_batch/api_path_for
require_once DU_ROOT . '/backend/handlers/treemap.php';

function du_treemap_db() {
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    // path_resolver + treemap owner/meta caches are static arrays keyed by
    // spl_object_hash($pdo). PHP reuses an object hash once the old PDO is GC'd,
    // so a freed in-memory PDO would let the next test hit a stale cache. Pin
    // every PDO in a global registry so each keeps a distinct hash for the run.
    // (Production is unaffected: one PDO per request, never reused.)
    $GLOBALS['__tm_pdos'][] = $pdo;
    // dirs: full tree at all depths. parent_id NULL = root. name_id → names.
    $pdo->exec('CREATE TABLE dirs (id INTEGER PRIMARY KEY, parent_id INTEGER,
        name_id INTEGER, total_size INTEGER, file_count INTEGER,
        dir_count INTEGER, owner_uid INTEGER, has_files INTEGER)');
    $pdo->exec('CREATE TABLE names (id INTEGER PRIMARY KEY, name TEXT)');
    $pdo->exec('CREATE TABLE owners (uid INTEGER PRIMARY KEY, username TEXT)');
    $pdo->exec('CREATE TABLE meta (key TEXT, value TEXT)');
    return $pdo;
}

// Insert a dir row. $d = array(id, parent_id|null, name, total_size,
// file_count, dir_count, owner_uid, has_files). Creates the name row too.
function du_tm_dir($pdo, $id, $parent_id, $name, $size, $fc, $dc, $owner, $has_files) {
    $pdo->prepare('INSERT INTO names (id,name) VALUES (?,?)')->execute(array($id, $name));
    $pid = $parent_id === null ? null : (int)$parent_id;
    $stmt = $pdo->prepare('INSERT INTO dirs
        (id,parent_id,name_id,total_size,file_count,dir_count,owner_uid,has_files)
        VALUES (?,?,?,?,?,?,?,?)');
    $stmt->execute(array($id, $pid, $id, $size, $fc, $dc, $owner, $has_files));
}

// --- api_treemap_make_root: the parent_id IS NULL row ---
test('make_root returns the NULL-parent row with children scaffold', function () {
    $pdo = du_treemap_db();
    du_tm_dir($pdo, 1, null, '/', 1000, 0, 2, 0, 0);
    $pdo->exec("INSERT INTO owners (uid,username) VALUES (0,'root')");
    $root = api_treemap_make_root($pdo);
    assert_true($root !== null);
    assert_eq('1', $root['shard_id']);
    assert_eq('', $root['parent_shard_id']);
    assert_eq(1000.0, $root['value']);
    assert_eq(array(), $root['children']);
    assert_eq(true, $root['has_children']); // dir_count 2 > 0
});

test('make_root returns null when no root row exists', function () {
    $pdo = du_treemap_db();
    assert_eq(null, api_treemap_make_root($pdo));
});

// --- api_treemap_children: ordering by total_size DESC + pagination ---
test('children are ordered by total_size DESC and paginate via offset/limit', function () {
    $pdo = du_treemap_db();
    du_tm_dir($pdo, 1, null, '/', 600, 0, 3, 0, 0); // root, no own files
    du_tm_dir($pdo, 2, 1, 'big',   300, 0, 0, 0, 0);
    du_tm_dir($pdo, 3, 1, 'small', 100, 0, 0, 0, 0);
    du_tm_dir($pdo, 4, 1, 'mid',   200, 0, 0, 0, 0);

    // node_type 'dir' suppresses the synthetic [files] node entirely.
    $page1 = api_treemap_children($pdo, 1, 'dir', 0, 2);
    assert_eq(3, $page1['total']);
    assert_eq(true, $page1['has_more']);
    assert_eq('sqlite', $page1['source']);
    $names = array();
    foreach ($page1['items'] as $it) $names[] = $it['name'];
    assert_eq(array('big', 'mid'), $names); // 300, 200

    $page2 = api_treemap_children($pdo, 1, 'dir', 2, 2);
    assert_eq(false, $page2['has_more']);
    assert_eq(1, count($page2['items']));
    assert_eq('small', $page2['items'][0]['name']); // 100
});

// --- synthetic [files] pseudo-node: parent.total - sum(child dirs) ---
test('children inject a [files] node sized as parent minus child dirs', function () {
    $pdo = du_treemap_db();
    // parent total 1000, two child dirs summing 600 → [files] = 400.
    du_tm_dir($pdo, 1, null, '/', 1000, 5, 2, 0, 1); // has_files=1
    du_tm_dir($pdo, 2, 1, 'd1', 400, 0, 0, 0, 0);
    du_tm_dir($pdo, 3, 1, 'd2', 200, 0, 0, 0, 0);

    $res = api_treemap_children($pdo, 1, 'all', 0, 10);
    assert_eq(3, $res['total']); // 2 dirs + 1 synthetic
    // Ordered by size DESC: d1(400) ties with [files](400)? d1=400, files=400.
    // UNION ALL + ORDER BY size DESC — both 400; assert the [files] node exists
    // with the right size/type rather than its tie position.
    $files_node = null;
    foreach ($res['items'] as $it) {
        if ($it['type'] === 'file_group') { $files_node = $it; break; }
    }
    assert_true($files_node !== null);
    assert_eq(400, $files_node['value']);
    assert_eq('[files]', $files_node['name']);
    assert_eq('', $files_node['shard_id']);     // no real dir_id
    assert_eq(5, $files_node['file_count']);
    assert_eq(false, $files_node['has_children']);
});

test('node_type=dir omits the [files] node even when parent has files', function () {
    $pdo = du_treemap_db();
    du_tm_dir($pdo, 1, null, '/', 1000, 5, 1, 0, 1);
    du_tm_dir($pdo, 2, 1, 'd1', 400, 0, 0, 0, 0);
    $res = api_treemap_children($pdo, 1, 'dir', 0, 10);
    assert_eq(1, $res['total']); // only the real dir, no synthetic
    foreach ($res['items'] as $it) {
        assert_true($it['type'] !== 'file_group');
    }
});

test('node_type=file yields no dir items but still counts them in total', function () {
    $pdo = du_treemap_db();
    du_tm_dir($pdo, 1, null, '/', 1000, 5, 1, 0, 1);
    du_tm_dir($pdo, 2, 1, 'd1', 400, 0, 0, 0, 0);
    $res = api_treemap_children($pdo, 1, 'file', 0, 10);
    // node_type 'file' builds NO items (loop guarded by != 'file'), but total
    // still reflects dir count + the (would-be) files node.
    assert_eq(0, count($res['items']));
    assert_eq(2, $res['total']);
});

// --- path reconstruction + owner lookup through row_to_item ---
test('child items carry reconstructed full path and resolved owner name', function () {
    $pdo = du_treemap_db();
    $pdo->exec("INSERT INTO owners (uid,username) VALUES (0,'root'),(1000,'alice')");
    du_tm_dir($pdo, 1, null, '/',    900, 0, 1, 0, 0);
    du_tm_dir($pdo, 2, 1,    'srv',  900, 0, 1, 0, 0);
    du_tm_dir($pdo, 3, 2,    'data', 900, 0, 0, 1000, 0);

    $res = api_treemap_children($pdo, 2, 'dir', 0, 10);
    assert_eq(1, count($res['items']));
    $item = $res['items'][0];
    assert_eq('/srv/data', $item['path']);   // recursive CTE path build
    assert_eq('alice', $item['owner']);       // owner_uid 1000 → owners table
    assert_eq('data', $item['name']);
    assert_eq('2', $item['parent_shard_id']);
});

test('unknown owner_uid resolves to empty string, not a crash', function () {
    $pdo = du_treemap_db();
    du_tm_dir($pdo, 1, null, '/',   100, 0, 1, 0, 0);
    du_tm_dir($pdo, 2, 1,    'x',   100, 0, 0, 4242, 0); // uid not in owners
    $res = api_treemap_children($pdo, 1, 'dir', 0, 10);
    assert_eq('', $res['items'][0]['owner']);
});
