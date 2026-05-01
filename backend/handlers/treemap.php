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

function api_treemap_data_dir($index_dir) {
    return $index_dir . DIRECTORY_SEPARATOR . 'tree_map_data';
}

function api_treemap_manifest_path($index_dir) {
    return api_treemap_data_dir($index_dir) . DIRECTORY_SEPARATOR . 'manifest.json';
}

function api_treemap_shard_path($index_dir, $shard_id) {
    $prefix = substr((string)$shard_id, 0, 2);
    return api_treemap_data_dir($index_dir) . DIRECTORY_SEPARATOR . 'shards' . DIRECTORY_SEPARATOR . $prefix . DIRECTORY_SEPARATOR . $shard_id . '.json';
}

function api_treemap_normalize_item_fields(&$item) {
    if (!is_array($item)) return;
    if (!isset($item['value'])) $item['value'] = isset($item['size']) ? (float)$item['size'] : 0.0;
    if (!isset($item['shard_id'])) $item['shard_id'] = isset($item['id']) ? (string)$item['id'] : '';
    if (!isset($item['has_children'])) $item['has_children'] = isset($item['children_count']) ? ($item['children_count'] > 0) : false;
    if (!isset($item['type'])) $item['type'] = 'directory';
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


function api_treemap_read_bucket_children_by_path($index_dir, $path) {
    if ($path === '' || $path === null) return false;
    static $bucket_cache = array();

    $shards_root = api_treemap_data_dir($index_dir) . DIRECTORY_SEPARATOR . 'shards';
    if (!is_dir($shards_root)) return false;

    if (!isset($bucket_cache[$index_dir])) $bucket_cache[$index_dir] = array();

    $dirs = @scandir($shards_root);
    if (!is_array($dirs)) return false;
    foreach ($dirs as $prefix) {
        if ($prefix === '.' || $prefix === '..') continue;
        $bucket_path = $shards_root . DIRECTORY_SEPARATOR . $prefix . DIRECTORY_SEPARATOR . 'bucket.json';
        if (!is_file($bucket_path)) continue;
        if (!isset($bucket_cache[$index_dir][$bucket_path])) {
            $bucket_cache[$index_dir][$bucket_path] = api_treemap_load_json_file($bucket_path);
        }
        $bucket = $bucket_cache[$index_dir][$bucket_path];
        if (!is_array($bucket) || !isset($bucket[$path]) || !is_array($bucket[$path])) continue;
        $items = $bucket[$path];
        foreach ($items as &$item) api_treemap_normalize_item_fields($item);
        unset($item);
        return $items;
    }
    return false;
}


function api_treemap_read_bucket_children_by_shard_id_scan($index_dir, $target_shard_id) {
    $shards_root = api_treemap_data_dir($index_dir) . DIRECTORY_SEPARATOR . 'shards';
    if (!is_dir($shards_root)) return false;
    $dirs = @scandir($shards_root);
    if (!is_array($dirs)) return false;
    $target_path = '';

    foreach ($dirs as $prefix) {
        if ($prefix === '.' || $prefix === '..') continue;
        $bucket_path = $shards_root . DIRECTORY_SEPARATOR . $prefix . DIRECTORY_SEPARATOR . 'bucket.json';
        if (!is_file($bucket_path)) continue;
        $bucket = api_treemap_load_json_file($bucket_path);
        if (!is_array($bucket)) continue;
        foreach ($bucket as $parent_path => $children) {
            if (!is_array($children)) continue;
            foreach ($children as $child) {
                if (!is_array($child)) continue;
                $sid = isset($child['shard_id']) ? (string)$child['shard_id'] : (isset($child['id']) ? (string)$child['id'] : '');
                if ($sid !== (string)$target_shard_id) continue;
                $target_path = isset($child['path']) ? (string)$child['path'] : '';
                break 3;
            }
        }
    }

    if ($target_path === '') return false;
    return api_treemap_read_bucket_children_by_path($index_dir, $target_path);
}

function api_treemap_read_shard_from_json($index_dir, $shard_id) {
    $data_dir = api_treemap_data_dir($index_dir);
    $manifest_path = api_treemap_manifest_path($index_dir);

    // v2 bucketed shards: shards/<prefix>/bucket.json with map[path] => [children]
    if (is_file($manifest_path)) {
        $manifest = api_treemap_load_json_file($manifest_path);
        if (is_array($manifest) && isset($manifest['shard_path_template']) && strpos((string)$manifest['shard_path_template'], 'bucket.json') !== false) {
            $prefix = substr((string)$shard_id, 0, 2);
            $bucket_path = $data_dir . DIRECTORY_SEPARATOR . 'shards' . DIRECTORY_SEPARATOR . $prefix . DIRECTORY_SEPARATOR . 'bucket.json';
            $bucket = api_treemap_load_json_file($bucket_path);
            if (is_array($bucket)) {
                foreach ($bucket as $parent_path => $children) {
                    if (!is_array($children)) continue;
                    foreach ($children as $child) {
                        if (!is_array($child)) continue;
                        $cid = isset($child['shard_id']) ? (string)$child['shard_id'] : (isset($child['id']) ? (string)$child['id'] : '');
                        if ($cid !== (string)$shard_id) continue;
                        $items = $children;
                        foreach ($items as &$item) api_treemap_normalize_item_fields($item);
                        unset($item);
                        return $items;
                    }
                }
            }
            $scan_items = api_treemap_read_bucket_children_by_shard_id_scan($index_dir, $shard_id);
            if ($scan_items !== false) return $scan_items;
            return false;
        }
    }

    // legacy shards: shards/<prefix>/<shard_id>.json
    $shard_file = api_treemap_shard_path($index_dir, $shard_id);
    if (!is_file($shard_file)) return false;

    $items = api_treemap_load_json_file($shard_file);
    if (!is_array($items)) return false;
    foreach ($items as &$item) api_treemap_normalize_item_fields($item);
    unset($item);
    return $items;
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
    $hits[] = array(
        'name' => isset($node['name']) ? $node['name'] : '',
        'path' => isset($node['path']) ? $node['path'] : '',
        'value' => isset($node['value']) ? (float)$node['value'] : (isset($node['size']) ? (float)$node['size'] : 0),
        'type' => isset($node['type']) ? $node['type'] : 'directory',
        'owner' => isset($node['owner']) ? $node['owner'] : '',
        'has_children' => isset($node['has_children']) ? !empty($node['has_children']) : (isset($node['children_count']) ? ($node['children_count'] > 0) : false),
        'shard_id' => isset($node['shard_id']) ? $node['shard_id'] : (isset($node['id']) ? (string)$node['id'] : ''),
        'parent_shard_id' => $parent_shard_id,
        'source' => $source,
    );
}

function api_treemap_collect_search_hits($nodes, $query_lc, &$hits, $source, $parent_shard_id, &$seen) {
    if (!is_array($nodes)) return;
    foreach ($nodes as $node) {
        if (!is_array($node)) continue;
        api_treemap_normalize_item_fields($node);
        if (!api_treemap_match_query($node, $query_lc)) continue;
        $k_path = isset($node['path']) ? $node['path'] : '';
        $k_type = isset($node['type']) ? $node['type'] : '';
        $dedupe_key = $k_path . '|' . $k_type;
        if (isset($seen[$dedupe_key])) continue;
        $seen[$dedupe_key] = 1;
        api_treemap_push_search_hit($hits, $node, $source, $parent_shard_id);
    }
}

function api_treemap_search_from_json($index, $index_dir, $query_lc, &$hits, &$seen) {
    if (is_array($index)) {
        api_treemap_collect_search_hits(array($index), $query_lc, $hits, 'index_root', '', $seen);
        if (isset($index['children']) && is_array($index['children'])) {
            api_treemap_collect_search_hits($index['children'], $query_lc, $hits, 'index_embedded', isset($index['shard_id']) ? $index['shard_id'] : '', $seen);
        }
    }

    $shard_root = api_treemap_data_dir($index_dir) . DIRECTORY_SEPARATOR . 'shards';
    if (!is_dir($shard_root)) return;

    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($shard_root, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $file) {
        if (!$file->isFile()) continue;
        $path = $file->getPathname();
        if (substr($path, -5) !== '.json') continue;
        $raw = @file_get_contents($path);
        if ($raw === false) continue;
        if (strpos(strtolower($raw), $query_lc) === false) continue;
        $nodes = @json_decode($raw, true);
        if (!is_array($nodes)) continue;
        $parent_shard_id = basename($path, '.json');
        api_treemap_collect_search_hits($nodes, $query_lc, $hits, 'json_shard', $parent_shard_id, $seen);
    }
}

function api_treemap_search_type_rank($type) {
    if ($type === 'directory') return 0;
    if ($type === 'file_group') return 1;
    return 2;
}

function api_treemap_sort_search_hits(&$hits) {
    usort($hits, function($a, $b) {
        $ra = api_treemap_search_type_rank(isset($a['type']) ? $a['type'] : '');
        $rb = api_treemap_search_type_rank(isset($b['type']) ? $b['type'] : '');
        if ($ra !== $rb) return ($ra < $rb) ? -1 : 1;
        $va = isset($a['value']) ? (float)$a['value'] : 0;
        $vb = isset($b['value']) ? (float)$b['value'] : 0;
        if ($va !== $vb) return ($va > $vb) ? -1 : 1;
        return strcmp(strtolower(isset($a['path']) ? $a['path'] : ''), strtolower(isset($b['path']) ? $b['path'] : ''));
    });
}

function api_handle_treemap($disk_path) {
    $shard_id = sanitize_name(trim(param('shard_id', '')));
    $offset = get_int('offset', 0, 0, PHP_INT_MAX);
    $limit = get_int('limit', 120, 1, 500);

    $index_file = api_treemap_find_index_file($disk_path);
    if (!$index_file) {
        b64_success(array('mode' => ($shard_id !== '' ? 'shard' : 'root'), 'root' => null, 'items' => array(), 'source' => 'none'));
    }

    $index = api_treemap_load_json_file($index_file);
    if (!is_array($index)) b64_error('Invalid tree map report JSON.', 500);

    $index_dir = dirname($index_file);
    $manifest_path = api_treemap_manifest_path($index_dir);

    if ($shard_id === '') {
        $root_payload = $index;
        $root_children_total = 0;
        if (isset($root_payload['children']) && is_array($root_payload['children'])) {
            $root_children_total = count($root_payload['children']);
            $root_payload['children'] = array();
            if (!isset($root_payload['has_children'])) $root_payload['has_children'] = ($root_children_total > 0);
        }
        b64_success(array(
            'mode' => 'root',
            'index_file' => basename($index_file),
            'index_date' => (int)get_json_date($index_file),
            'db_available' => is_file($manifest_path),
            'shard_available' => is_file($manifest_path),
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
        $items = api_treemap_read_shard_from_json($index_dir, $shard_id);
        if ($items !== false) $source = 'json_shard';
    }
    if ($items === false && isset($index['children']) && is_array($index['children'])) {
        foreach ($index['children'] as $node) {
            if (!is_array($node)) continue;
            $node_sid = isset($node['shard_id']) ? (string)$node['shard_id'] : '';
            if ($node_sid !== (string)$shard_id) continue;
            $node_path = isset($node['path']) ? (string)$node['path'] : '';
            $by_path = api_treemap_read_bucket_children_by_path($index_dir, $node_path);
            if ($by_path !== false) {
                $items = $by_path;
                $source = 'json_shard';
            }
            break;
        }
    }
    if ($items === false) $items = array();

    api_treemap_sort_items_by_size($items);
    $total = count($items);
    $paged = array_slice($items, $offset, $limit);
    $has_more = ($offset + count($paged)) < $total;

    b64_success(array('mode' => 'shard', 'shard_id' => $shard_id, 'items' => $paged, 'offset' => $offset, 'limit' => $limit, 'total' => $total, 'has_more' => $has_more, 'source' => $source));
}

function api_handle_treemap_search($disk_path) {
    $q_raw = trim(param('q', ''));
    $offset = get_int('offset', 0, 0, PHP_INT_MAX);
    $limit = get_int('limit', 30, 1, 200);

    if ($q_raw === '') {
        b64_success(array('mode' => 'search', 'q' => '', 'items' => array(), 'offset' => $offset, 'limit' => $limit, 'total' => 0, 'has_more' => false, 'source' => 'none'));
    }

    $index_file = api_treemap_find_index_file($disk_path);
    if (!$index_file) {
        b64_success(array('mode' => 'search', 'q' => $q_raw, 'items' => array(), 'offset' => $offset, 'limit' => $limit, 'total' => 0, 'has_more' => false, 'source' => 'none'));
    }

    $index = api_treemap_load_json_file($index_file);
    if (!is_array($index)) b64_error('Invalid tree map report JSON.', 500);

    $all_hits = array();
    $seen = array();
    api_treemap_search_from_json($index, dirname($index_file), strtolower($q_raw), $all_hits, $seen);
    api_treemap_sort_search_hits($all_hits);

    $total = count($all_hits);
    $hits = array_slice($all_hits, $offset, $limit);
    b64_success(array('mode' => 'search', 'q' => $q_raw, 'items' => $hits, 'offset' => $offset, 'limit' => $limit, 'total' => $total, 'has_more' => ($offset + count($hits)) < $total, 'source' => 'json_shard'));
}
