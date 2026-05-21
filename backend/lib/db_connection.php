<?php
// lib/db_connection.php — shared SQLite PDO open + PRAGMA helpers.
//
// Two distinct DB roles, both PHP 5.4 / SQLite 3.8 compatible:
//
//   detail.db (per-user file/dir breakdown)
//     - Path: <disk_path>/detail_users/data_detail.db
//     - When opened, treemap.db is ATTACHed as `tm` if present so consumers
//       can JOIN tm.dirs / tm.names for path reconstruction.
//
//   treemap.db (directory tree + dir-segment names)
//     - Path: <disk_path>/tree_map_data/treemap.db
//     - Standalone — no ATTACH.
//
// Both use the same read-only PRAGMA tuning (mmap, cache, query_only) so
// any caller gets identical performance characteristics. Cached per
// $disk_path so subsequent calls within one PHP request reuse the
// connection (avoids re-applying PRAGMAs ~7×/page-load).

function api_db_detail_paths($disk_path) {
    $detail = $disk_path . '/' . DU_DETAIL_DB_DIRNAME . '/' . DU_DETAIL_DB_FILENAME;
    $treemap = $disk_path . '/' . DU_TREEMAP_DB_DIRNAME . '/' . DU_TREEMAP_DB_FILENAME;
    if (!is_file($detail)) return false;
    return array(
        'detail' => $detail,
        'treemap' => is_file($treemap) ? $treemap : null,
    );
}

function api_db_treemap_path($disk_path) {
    $p = $disk_path . '/' . DU_TREEMAP_DB_DIRNAME . '/' . DU_TREEMAP_DB_FILENAME;
    return is_file($p) ? $p : false;
}

// Apply read-only PRAGMA bundle tuned for NFS-backed SQLite + tight RAM.
//
// SQLite officially is NOT designed for NFS, so we lean hard on tactics that
// bypass NFS-broken paths:
//
//   query_only=1
//     Reject writes early — defense-in-depth, also tells SQLite it never
//     needs to touch the rollback journal/WAL on disk.
//
//   journal_mode=OFF
//     No journal file = no NFS lock contention. Safe because the DB is
//     write-once (built by Rust scanner, then read-only). If a write WERE
//     attempted accidentally, query_only=1 blocks it first.
//
//   locking_mode=EXCLUSIVE
//     Take the file lock once on first read, hold for the lifetime of the
//     connection. NFS file locks are slow + fragile — by acquiring once we
//     pay the cost a single time per request instead of per query.
//
//   mmap_size=0
//     mmap on NFS is unreliable (kernel may invalidate it, or skip caching
//     entirely). Disable it; rely on SQLite's own page cache (cache_size)
//     which lives in PHP process RAM and is stable.
//
//   cache_size=-32768  (32 MB)
//     SQLite's in-process page cache. With mmap off this is the ONLY level
//     of caching between us and NFS. 32 MB is a deliberate compromise:
//     small enough to fit in 256 MB-RAM environments next to PHP-FPM, big
//     enough to hold a few thousand 8 KB index pages — the hot working
//     set for a typical dashboard request.
//
//   temp_store=MEMORY
//     Avoid spilling temp B-trees to disk when SQLite would otherwise need
//     them — even more important on NFS where temp file IO is expensive.
//
//   read_uncommitted=1
//     We're read-only and the writer is offline (Rust scanner runs
//     separately). No need to coordinate with hypothetical writers.
function api_db_apply_read_pragmas($pdo) {
    try {
        $pdo->exec('PRAGMA query_only=1');
        $pdo->exec('PRAGMA journal_mode=OFF');
        $pdo->exec('PRAGMA locking_mode=EXCLUSIVE');
        $pdo->exec('PRAGMA mmap_size=0');
        $pdo->exec('PRAGMA cache_size=-32768');
        $pdo->exec('PRAGMA temp_store=MEMORY');
        $pdo->exec('PRAGMA read_uncommitted=1');
    } catch (Exception $e) {
        // PRAGMA failures are non-fatal — connection is still usable.
    }
}

// Open detail.db (read-only) with treemap.db ATTACHed as `tm` when present.
// Cached per-disk_path. Returns PDO on success, false on failure.
function api_db_open_detail($disk_path) {
    static $cache = array();
    $key = (string)$disk_path;
    if (array_key_exists($key, $cache)) return $cache[$key];

    $paths = api_db_detail_paths($disk_path);
    if (!$paths) return $cache[$key] = false;

    try {
        $pdo = new PDO('sqlite:' . $paths['detail']);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        api_db_apply_read_pragmas($pdo);
        if (!empty($paths['treemap'])) {
            $stmt = $pdo->prepare('ATTACH DATABASE ? AS tm');
            $stmt->execute(array($paths['treemap']));
        }
    } catch (Exception $e) {
        return $cache[$key] = false;
    }
    return $cache[$key] = $pdo;
}

// Open treemap.db (read-only) standalone. Cached per-disk_path.
function api_db_open_treemap($disk_path) {
    static $cache = array();
    $key = (string)$disk_path;
    if (array_key_exists($key, $cache)) return $cache[$key];

    $db = api_db_treemap_path($disk_path);
    if (!$db) return $cache[$key] = false;
    try {
        $pdo = new PDO('sqlite:' . $db);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        api_db_apply_read_pragmas($pdo);
    } catch (Exception $e) {
        return $cache[$key] = false;
    }
    return $cache[$key] = $pdo;
}
