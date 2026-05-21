<?php
// lib/path_resolver.php — shared dir_id → full path resolution.
//
// Two consumers:
//   - detail.php (per-user file/dir detail) reads `tm.dirs` (ATTACH-ed).
//   - treemap.php (treemap UI) reads `dirs` (main DB).
//
// Same recursive-CTE pattern; only the schema prefix differs. Calling code
// passes `$prefix = ''` for treemap.db direct, `'tm.'` for detail.db ATTACH.
//
// Two access modes per resolver:
//   - api_path_for($pdo, $dir_id, $prefix='')         — single id, cached.
//   - api_path_resolve_batch($pdo, $dir_ids, $prefix) — batched lookup that
//       walks parent chain in passes via `WHERE id IN (...)`. Bounded RAM
//       (only paths actually referenced); avoids the 1.2 GB cost of
//       preloading every dir at 75M-file scale.
//
// Both share a per-PDO cache keyed by (object hash + prefix).

// Internal: per-PDO+prefix cache. Reused by single + batch lookup.
function &api_path_cache_ref($pdo, $prefix) {
    static $cache = array();
    $key = spl_object_hash($pdo) . '|' . $prefix;
    if (!isset($cache[$key])) $cache[$key] = array();
    return $cache[$key];
}

// Reconstruct full path for one dir_id via recursive CTE. Slow when called
// per-row; prefer api_path_resolve_batch() for many ids.
function api_path_for($pdo, $dir_id, $prefix = '') {
    $cache_ref = &api_path_cache_ref($pdo, $prefix);
    $key = (int)$dir_id;
    if (isset($cache_ref[$key])) return $cache_ref[$key];
    api_path_resolve_batch($pdo, array($key), $prefix);
    return isset($cache_ref[$key]) ? $cache_ref[$key] : '';
}

// Resolve a list of dir_ids → full paths in one batched walk.
//
// Walks parent chain in passes, fetching only dirs we haven't seen yet via
// `WHERE id IN (...)`. Each pass batches up to 500 ids. Results memoized in
// the per-(pdo, prefix) cache so repeat calls are O(1).
function api_path_resolve_batch($pdo, $dir_ids, $prefix = '') {
    $cache_ref = &api_path_cache_ref($pdo, $prefix);

    $unique = array();
    foreach ($dir_ids as $d) {
        $d = (int)$d;
        if (!isset($cache_ref[$d])) $unique[$d] = true;
    }
    if (empty($unique)) return;

    // Walk up in passes, batching ids we haven't seen in $known.
    $known = array();
    $queue = array_keys($unique);

    $dirs_table = $prefix . 'dirs';
    $names_table = $prefix . 'names';

    while (!empty($queue)) {
        $batch = array();
        foreach ($queue as $id) {
            if (!isset($known[$id]) && !isset($cache_ref[$id])) $batch[] = $id;
        }
        $queue = array();
        if (empty($batch)) break;

        $i = 0;
        $n = count($batch);
        while ($i < $n) {
            $chunk = array_slice($batch, $i, 500);
            $i += 500;
            $place = implode(',', array_fill(0, count($chunk), '?'));
            try {
                $stmt = $pdo->prepare(
                    'SELECT d.id, d.parent_id, n.name '
                    . 'FROM ' . $dirs_table . ' d '
                    . 'JOIN ' . $names_table . ' n ON d.name_id = n.id '
                    . 'WHERE d.id IN (' . $place . ')'
                );
                $stmt->execute($chunk);
            } catch (Exception $e) {
                continue;
            }
            while (($r = $stmt->fetch(PDO::FETCH_NUM)) !== false) {
                $id = (int)$r[0];
                $pid = $r[1] === null ? null : (int)$r[1];
                $name = (string)$r[2];
                $known[$id] = array($pid, $name);
                if ($pid !== null && !isset($cache_ref[$pid]) && !isset($known[$pid])) {
                    $queue[] = $pid;
                }
            }
        }
    }

    // Resolve from leaves; memoize each segment.
    $resolve = function($id) use (&$resolve, &$known, &$cache_ref) {
        if (isset($cache_ref[$id])) return $cache_ref[$id];
        if (!isset($known[$id])) return $cache_ref[$id] = '';
        list($pid, $name) = $known[$id];
        if ($pid === null) {
            $cache_ref[$id] = ($name === '' || $name === '/') ? '/' : $name;
        } else {
            $parent_path = $resolve($pid);
            if ($parent_path === '/') $cache_ref[$id] = '/' . $name;
            elseif ($parent_path === '') $cache_ref[$id] = $name;
            else $cache_ref[$id] = $parent_path . '/' . $name;
        }
        return $cache_ref[$id];
    };
    foreach (array_keys($unique) as $id) $resolve($id);
}
