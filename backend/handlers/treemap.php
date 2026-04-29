<?php

function api_treemap_find_index_file($disk_path) {
    $dh = @opendir($disk_path);
    $latest = false;
    $latest_date = -1;

    while ($dh && ($f = readdir($dh)) !== false) {
        if (substr($f, -5) !== '.json') continue;
        $fl = strtolower($f);
        if (strpos($fl, 'tree_map_report') === false && strpos($fl, 'treemap_report') === false) continue;

        $fp = $disk_path . DIRECTORY_SEPARATOR . $f;
        $d = (int)get_json_date($fp);
        if ($d > $latest_date) {
            $latest_date = $d;
            $latest = $fp;
        }
    }

    if ($dh) closedir($dh);
    return $latest;
}

function api_treemap_load_json_file($file_path) {
    $raw = @file_get_contents($file_path);
    if ($raw === false) return false;
    $json = @json_decode($raw, true);
    return is_array($json) ? $json : false;
}

/**
 * Normalize a shard item from compact Rust format to frontend-expected format.
 * Compact (new):  {id, name, size, owner, children_count}
 * Expected (old): {shard_id, name, value, type, owner, has_children, path}
 */
function api_treemap_normalize_item_fields(&$item) {
    if (!is_array($item)) return;
    if (!isset($item['value']))       $item['value']       = isset($item['size'])          ? (float)$item['size']          : 0.0;
    if (!isset($item['shard_id']))    $item['shard_id']    = isset($item['id'])            ? (string)$item['id']           : '';
    if (!isset($item['has_children']))$item['has_children']= isset($item['children_count'])? ($item['children_count'] > 0)  : false;
    if (!isset($item['type']))        $item['type']        = 'directory';
}


function api_treemap_item_value($item) {
    if (!is_array($item)) return 0.0;
    if (isset($item['value'])) return (float)$item['value'];
    if (isset($item['size'])) return (float)$item['size'];
    return 0.0;
}

function api_treemap_sort_items_by_size(&$items) {
    if (!is_array($items)) return;
    usort($items, function($a, $b) {
        $va = api_treemap_item_value($a);
        $vb = api_treemap_item_value($b);
        if ($va !== $vb) return ($va > $vb) ? -1 : 1;
        $na = strtolower(isset($a['name']) ? $a['name'] : (isset($a['path']) ? $a['path'] : ''));
        $nb = strtolower(isset($b['name']) ? $b['name'] : (isset($b['path']) ? $b['path'] : ''));
        return strcmp($na, $nb);
    });
}

function api_treemap_read_shard_from_db($db_path, $shard_id) {
    if (!class_exists('SQLite3')) return false;
    if (!is_file($db_path)) return false;

    $db = null;
    try {
        if (defined('SQLITE3_OPEN_READONLY')) {
            $db = new SQLite3($db_path, SQLITE3_OPEN_READONLY);
        } else {
            $db = new SQLite3($db_path);
        }

        $stmt = $db->prepare('SELECT path, data FROM shards WHERE id = :id LIMIT 1');
        if (!$stmt) {
            $db->close();
            return false;
        }

        if (defined('SQLITE3_TEXT')) {
            $stmt->bindValue(':id', $shard_id, SQLITE3_TEXT);
        } else {
            $stmt->bindValue(':id', $shard_id);
        }

        $res = $stmt->execute();
        if (!$res) {
            $db->close();
            return false;
        }

        $row = $res->fetchArray(SQLITE3_ASSOC);
        $res->finalize();
        $db->close();

        if (!$row || !isset($row['data'])) return false;

        // Decompress if BLOB (zlib magic byte 0x78), else use raw JSON.
        $raw = $row['data'];
        $json = (strlen($raw) > 0 && ord($raw[0]) === 0x78) ? @zlib_decode($raw) : $raw;
        if ($json === false) return false;

        $items = @json_decode($json, true);
        if (!is_array($items)) return false;

        // Reconstruct per-item 'path' from shard path + item name, then normalize fields.
        if (isset($row['path'])) {
            $base = rtrim($row['path'], '/');
            foreach ($items as &$item) {
                if (!isset($item['path'])) {
                    $t = isset($item['type']) ? $item['type'] : '';
                    $item['path'] = ($t === 'file_group')
                        ? $base . '/__files__'
                        : $base . '/' . (isset($item['name']) ? $item['name'] : '');
                }
                api_treemap_normalize_item_fields($item);
            }
            unset($item);
        } else {
            foreach ($items as &$item) { api_treemap_normalize_item_fields($item); }
            unset($item);
        }

        return $items;
    } catch (Exception $e) {
        if ($db) $db->close();
        return false;
    }
}

function api_treemap_read_shard_from_json($index_dir, $shard_id) {
    $shard_file = $index_dir . DIRECTORY_SEPARATOR . 'tree_map_shards' . DIRECTORY_SEPARATOR . $shard_id . '.json';
    if (!is_file($shard_file)) return false;

    $items = api_treemap_load_json_file($shard_file);
    return is_array($items) ? $items : false;
}

function api_treemap_match_query($node, $query_lc) {
    $name = '';
    $path = '';

    if (is_array($node)) {
        if (isset($node['name']) && is_string($node['name'])) $name = strtolower($node['name']);
        if (isset($node['path']) && is_string($node['path'])) $path = strtolower($node['path']);
    }

    return (strpos($name, $query_lc) !== false) || (strpos($path, $query_lc) !== false);
}

function api_treemap_push_search_hit(&$hits, $node, $source, $parent_shard_id) {
    // Support both old format (value/shard_id/has_children) and compact Rust format (size/id/children_count).
    $hits[] = array(
        'name'            => isset($node['name']) ? $node['name'] : '',
        'path'            => isset($node['path']) ? $node['path'] : '',
        'value'           => isset($node['value'])        ? (float)$node['value']  : (isset($node['size'])          ? (float)$node['size']          : 0),
        'type'            => isset($node['type'])         ? $node['type']          : 'directory',
        'owner'           => isset($node['owner'])        ? $node['owner']         : '',
        'has_children'    => isset($node['has_children']) ? !empty($node['has_children']) : (isset($node['children_count']) ? ($node['children_count'] > 0) : false),
        'shard_id'        => isset($node['shard_id'])     ? $node['shard_id']      : (isset($node['id']) ? (string)$node['id'] : ''),
        'parent_shard_id' => $parent_shard_id,
        'source'          => $source,
    );
}

function api_treemap_collect_search_hits($nodes, $query_lc, &$hits, $source, $parent_shard_id, &$seen) {
    if (!is_array($nodes)) return;

    foreach ($nodes as $node) {
        if (!is_array($node)) continue;
        if (!api_treemap_match_query($node, $query_lc)) continue;

        $k_path = isset($node['path']) ? $node['path'] : '';
        $k_type = isset($node['type']) ? $node['type'] : '';
        $dedupe_key = $k_path . '|' . $k_type;
        if (isset($seen[$dedupe_key])) continue;
        $seen[$dedupe_key] = 1;

        api_treemap_push_search_hit($hits, $node, $source, $parent_shard_id);
    }
}

function api_treemap_search_from_db($db_path, $query_lc, &$hits, &$seen) {
    if (!class_exists('SQLite3')) return false;
    if (!is_file($db_path)) return false;

    $db = null;
    try {
        if (defined('SQLITE3_OPEN_READONLY')) {
            $db = new SQLite3($db_path, SQLITE3_OPEN_READONLY);
        } else {
            $db = new SQLite3($db_path);
        }

        $res = $db->query('SELECT id, path, data FROM shards');
        if (!$res) {
            $db->close();
            return false;
        }

        while (($row = $res->fetchArray(SQLITE3_ASSOC)) !== false) {
            if (!isset($row['data'])) continue;

            // Decompress if zlib BLOB (first byte 0x78), else use raw JSON text.
            $raw = $row['data'];
            $json = (strlen($raw) > 0 && ord($raw[0]) === 0x78) ? @zlib_decode($raw) : $raw;
            if ($json === false || !is_string($json)) continue;

            // Cheap pre-filter on decompressed text before JSON decode.
            if (strpos(strtolower($json), $query_lc) === false) continue;

            $nodes = @json_decode($json, true);
            if (!is_array($nodes)) continue;

            // Reconstruct item paths from shard path, then normalize compact fields.
            $shard_path = isset($row['path']) ? $row['path'] : '';
            if ($shard_path !== '') {
                $base = rtrim($shard_path, '/');
                foreach ($nodes as &$node) {
                    if (!isset($node['path'])) {
                        $t = isset($node['type']) ? $node['type'] : '';
                        $node['path'] = ($t === 'file_group')
                            ? $base . '/__files__'
                            : $base . '/' . (isset($node['name']) ? $node['name'] : '');
                    }
                    api_treemap_normalize_item_fields($node);
                }
                unset($node);
            } else {
                foreach ($nodes as &$node) { api_treemap_normalize_item_fields($node); }
                unset($node);
            }

            $parent_shard_id = isset($row['id']) ? $row['id'] : '';
            api_treemap_collect_search_hits($nodes, $query_lc, $hits, 'sqlite_db', $parent_shard_id, $seen);
        }

        $res->finalize();
        $db->close();
        return true;
    } catch (Exception $e) {
        if ($db) $db->close();
        return false;
    }
}

function api_treemap_search_from_json($index, $index_dir, $query_lc, &$hits, &$seen) {
    if (is_array($index)) {
        api_treemap_collect_search_hits(array($index), $query_lc, $hits, 'index_root', '', $seen);
        if (isset($index['children']) && is_array($index['children'])) {
            api_treemap_collect_search_hits($index['children'], $query_lc, $hits, 'index_embedded', isset($index['shard_id']) ? $index['shard_id'] : '', $seen);
        }
    }

    $shard_dir = $index_dir . DIRECTORY_SEPARATOR . 'tree_map_shards';
    if (!is_dir($shard_dir)) return;

    $dh = @opendir($shard_dir);
    if (!$dh) return;

    while (($f = readdir($dh)) !== false) {
        if (substr($f, -5) !== '.json') continue;

        $shard_file = $shard_dir . DIRECTORY_SEPARATOR . $f;
        $nodes = api_treemap_load_json_file($shard_file);
        if (!is_array($nodes)) continue;

        $parent_shard_id = substr($f, 0, -5);
        api_treemap_collect_search_hits($nodes, $query_lc, $hits, 'json_shard', $parent_shard_id, $seen);
    }

    closedir($dh);
}

function api_treemap_search_type_rank($type) {
    if ($type === 'directory') return 0;
    if ($type === 'file_group') return 1;
    return 2;
}

function api_treemap_sort_search_hits(&$hits) {
    usort($hits, function($a, $b) {
        $ta = isset($a['type']) ? $a['type'] : '';
        $tb = isset($b['type']) ? $b['type'] : '';
        $ra = api_treemap_search_type_rank($ta);
        $rb = api_treemap_search_type_rank($tb);
        if ($ra !== $rb) return ($ra < $rb) ? -1 : 1;

        $va = isset($a['value']) ? (float)$a['value'] : 0;
        $vb = isset($b['value']) ? (float)$b['value'] : 0;
        if ($va !== $vb) return ($va > $vb) ? -1 : 1;

        $pa = strtolower(isset($a['path']) ? $a['path'] : '');
        $pb = strtolower(isset($b['path']) ? $b['path'] : '');
        $cp = strcmp($pa, $pb);
        if ($cp !== 0) return $cp;

        $na = strtolower(isset($a['name']) ? $a['name'] : '');
        $nb = strtolower(isset($b['name']) ? $b['name'] : '');
        return strcmp($na, $nb);
    });
}

function api_handle_treemap($disk_path) {
    $shard_id = sanitize_name(trim(param('shard_id', '')));
    $offset = get_int('offset', 0, 0, PHP_INT_MAX);
    $limit = get_int('limit', 120, 1, 500);

    $index_file = api_treemap_find_index_file($disk_path);
    if (!$index_file) {
        b64_success(array(
            'mode' => ($shard_id !== '' ? 'shard' : 'root'),
            'root' => null,
            'items' => array(),
            'source' => 'none',
        ));
    }

    $index = api_treemap_load_json_file($index_file);
    if (!is_array($index)) {
        b64_error('Invalid tree map report JSON.', 500);
    }

    $index_dir = dirname($index_file);
    $db_path = $index_dir . DIRECTORY_SEPARATOR . 'tree_map_data.db';

    if ($shard_id === '') {
        $root_payload = $index;
        $root_children_total = 0;
        if (isset($root_payload['children']) && is_array($root_payload['children'])) {
            $root_children_total = count($root_payload['children']);
            // Root response should stay lightweight; children are lazy-loaded via shard API.
            $root_payload['children'] = array();
            if (!isset($root_payload['has_children'])) {
                $root_payload['has_children'] = ($root_children_total > 0);
            }
        }

        b64_success(array(
            'mode' => 'root',
            'index_file' => basename($index_file),
            'index_date' => (int)get_json_date($index_file),
            'db_available' => is_file($db_path),
            'root_children_total' => $root_children_total,
            'root' => $root_payload,
        ));
    }

    $items = false;
    $source = 'none';

    if (isset($index['shard_id']) && $index['shard_id'] === $shard_id && isset($index['children']) && is_array($index['children'])) {
        $items = $index['children'];
        $source = 'index_embedded';
    }

    if ($items === false) {
        $items = api_treemap_read_shard_from_db($db_path, $shard_id);
        if ($items !== false) $source = 'sqlite_db';
    }

    if ($items === false) {
        $items = api_treemap_read_shard_from_json($index_dir, $shard_id);
        if ($items !== false) $source = 'json_shard';
    }

    if ($items === false) {
        $items = array();
    }

    api_treemap_sort_items_by_size($items);
    $total = count($items);
    $paged = array_slice($items, $offset, $limit);
    $has_more = ($offset + count($paged)) < $total;

    b64_success(array(
        'mode' => 'shard',
        'shard_id' => $shard_id,
        'items' => $paged,
        'offset' => $offset,
        'limit' => $limit,
        'total' => $total,
        'has_more' => $has_more,
        'source' => $source,
    ));
}

function api_handle_treemap_search($disk_path) {
    $q_raw = trim(param('q', ''));
    $offset = get_int('offset', 0, 0, PHP_INT_MAX);
    $limit = get_int('limit', 30, 1, 200);

    if ($q_raw === '') {
        b64_success(array(
            'mode' => 'search',
            'q' => '',
            'items' => array(),
            'offset' => $offset,
            'limit' => $limit,
            'total' => 0,
            'has_more' => false,
            'source' => 'none',
        ));
    }

    $index_file = api_treemap_find_index_file($disk_path);
    if (!$index_file) {
        b64_success(array(
            'mode' => 'search',
            'q' => $q_raw,
            'items' => array(),
            'offset' => $offset,
            'limit' => $limit,
            'total' => 0,
            'has_more' => false,
            'source' => 'none',
        ));
    }

    $index = api_treemap_load_json_file($index_file);
    if (!is_array($index)) {
        b64_error('Invalid tree map report JSON.', 500);
    }

    $query_lc = strtolower($q_raw);
    $index_dir = dirname($index_file);
    $db_path = $index_dir . DIRECTORY_SEPARATOR . 'tree_map_data.db';

    $all_hits = array();
    $seen = array();
    $source = 'json_fallback';

    $db_ok = api_treemap_search_from_db($db_path, $query_lc, $all_hits, $seen);
    if ($db_ok) {
        $source = 'sqlite_db';
    } else {
        api_treemap_search_from_json($index, $index_dir, $query_lc, $all_hits, $seen);
    }

    api_treemap_sort_search_hits($all_hits);

    $total = count($all_hits);
    $hits = array_slice($all_hits, $offset, $limit);

    b64_success(array(
        'mode' => 'search',
        'q' => $q_raw,
        'items' => $hits,
        'offset' => $offset,
        'limit' => $limit,
        'total' => $total,
        'has_more' => ($offset + count($hits)) < $total,
        'source' => $source,
    ));
}
