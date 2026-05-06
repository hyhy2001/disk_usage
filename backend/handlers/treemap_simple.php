<?php

function api_treemap_simple_find_index_file($disk_path) {
    $dh = @opendir($disk_path);
    if (!$dh) return false;
    $latest = false;
    $latest_date = -1;
    while (($f = readdir($dh)) !== false) {
        if (substr($f, -5) !== '.json') continue;
        $fl = strtolower($f);
        if (strpos($fl, 'tree_map_report') === false && strpos($fl, 'treemap_report') === false) continue;
        $fp = $disk_path . DIRECTORY_SEPARATOR . $f;
        $d = (int)get_json_date($fp);
        if ($d > $latest_date) { $latest_date = $d; $latest = $fp; }
    }
    closedir($dh);
    return $latest;
}

function api_treemap_simple_json_load($path) {
    $raw = @file_get_contents($path);
    if ($raw === false) return false;
    $json = @json_decode($raw, true);
    return is_array($json) ? $json : false;
}

function api_treemap_simple_path_dict($index_dir) {
    $manifest = api_treemap_simple_json_load($index_dir . DIRECTORY_SEPARATOR . 'tree_map_data' . DIRECTORY_SEPARATOR . 'api' . DIRECTORY_SEPARATOR . 'shards_manifest.json');
    if (!is_array($manifest) || empty($manifest['path_dict'])) return array();
    $path = $index_dir . DIRECTORY_SEPARATOR . 'tree_map_data' . DIRECTORY_SEPARATOR . str_replace(array('/', '\\'), DIRECTORY_SEPARATOR, $manifest['path_dict']);
    $map = array();
    $fh = @fopen($path, 'r');
    if (!$fh) return $map;
    while (($line = fgets($fh)) !== false) {
        $line = trim($line);
        if ($line === '') continue;
        $obj = @json_decode($line, true);
        if (!is_array($obj) || !isset($obj['gid']) || !isset($obj['p'])) continue;
        $map[(int)$obj['gid']] = (string)$obj['p'];
    }
    @fclose($fh);
    return $map;
}

function api_treemap_simple_item($obj, $path_dict) {
    if (!is_array($obj)) return false;
    $gid = isset($obj['gid']) ? (int)$obj['gid'] : -1;
    $path = isset($path_dict[$gid]) ? (string)$path_dict[$gid] : '';
    $type = isset($obj['t']) && (string)$obj['t'] === 'f' ? 'file' : 'directory';
    return array(
        'name' => isset($obj['n']) ? (string)$obj['n'] : basename($path),
        'path' => $path,
        'owner' => isset($obj['o']) ? (string)$obj['o'] : '',
        'value' => isset($obj['v']) ? (float)$obj['v'] : 0.0,
        'size' => isset($obj['v']) ? (float)$obj['v'] : 0.0,
        'type' => $type,
        'shard_id' => isset($obj['id']) ? (string)$obj['id'] : '',
        'parent_shard_id' => isset($obj['pid']) ? (string)$obj['pid'] : '',
        'has_children' => !empty($obj['h']),
    );
}

function api_treemap_simple_type_ok($item, $node_type) {
    if ($node_type === 'all' || !is_array($item)) return true;
    if ($node_type === 'dir') return isset($item['type']) && $item['type'] === 'directory';
    if ($node_type === 'file') return isset($item['type']) && $item['type'] === 'file';
    return true;
}

function api_treemap_simple_root_items($index, $node_type, $offset, $limit) {
    $items = array();
    if (isset($index['children']) && is_array($index['children'])) {
        foreach ($index['children'] as $child) {
            if (!is_array($child)) continue;
            $item = array(
                'name' => isset($child['name']) ? (string)$child['name'] : '',
                'path' => isset($child['path']) ? (string)$child['path'] : '',
                'owner' => isset($child['owner']) ? (string)$child['owner'] : '',
                'value' => isset($child['value']) ? (float)$child['value'] : (isset($child['size']) ? (float)$child['size'] : 0.0),
                'size' => isset($child['size']) ? (float)$child['size'] : (isset($child['value']) ? (float)$child['value'] : 0.0),
                'type' => isset($child['type']) ? (string)$child['type'] : 'directory',
                'shard_id' => isset($child['shard_id']) ? (string)$child['shard_id'] : '',
                'parent_shard_id' => isset($index['shard_id']) ? (string)$index['shard_id'] : '',
                'has_children' => !empty($child['has_children']),
            );
            if (api_treemap_simple_type_ok($item, $node_type)) $items[] = $item;
        }
    }
    $total = count($items);
    return array('items' => array_slice($items, $offset, $limit), 'total' => $total, 'has_more' => ($offset + min($limit, $total)) < $total, 'source' => 'index_embedded');
}

function api_treemap_simple_shard_items($index_dir, $shard_id, $node_type, $offset, $limit) {
    $path_dict = api_treemap_simple_path_dict($index_dir);
    $shards_root = $index_dir . DIRECTORY_SEPARATOR . 'tree_map_data' . DIRECTORY_SEPARATOR . 'shards';
    $items = array();

    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($shards_root, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $file) {
        if (!$file->isFile()) continue;
        if (substr($file->getFilename(), -7) !== '.ndjson') continue;
        $fh = @fopen($file->getPathname(), 'r');
        if (!$fh) continue;
        while (($line = fgets($fh)) !== false) {
            $line = trim($line);
            if ($line === '') continue;
            $obj = @json_decode($line, true);
            if (!is_array($obj)) continue;
            if (!isset($obj['pid']) || (string)$obj['pid'] !== (string)$shard_id) continue;
            $item = api_treemap_simple_item($obj, $path_dict);
            if ($item && api_treemap_simple_type_ok($item, $node_type)) $items[] = $item;
        }
        @fclose($fh);
    }

    usort($items, function($a, $b) {
        $va = isset($a['value']) ? (float)$a['value'] : 0;
        $vb = isset($b['value']) ? (float)$b['value'] : 0;
        if ($va === $vb) return strcmp(isset($a['path']) ? $a['path'] : '', isset($b['path']) ? $b['path'] : '');
        return ($va > $vb) ? -1 : 1;
    });

    $total = count($items);
    return array('items' => array_slice($items, $offset, $limit), 'total' => $total, 'has_more' => ($offset + min($limit, $total)) < $total, 'source' => 'json_shard_ndjson');
}

function api_handle_treemap_simple($disk_path) {
    $shard_id = sanitize_name(trim(param('shard_id', '')));
    $offset = get_int('offset', 0, 0, PHP_INT_MAX);
    $limit = get_int('limit', 120, 1, 500);
    $node_type = strtolower(trim(param('node_type', 'all')));
    if ($node_type !== 'dir' && $node_type !== 'file') $node_type = 'all';

    $index_file = api_treemap_simple_find_index_file($disk_path);
    if (!$index_file) b64_success(array('items' => array(), 'total' => 0, 'has_more' => false, 'source' => 'none'));

    $index = api_treemap_simple_json_load($index_file);
    if (!is_array($index)) b64_success(array('items' => array(), 'total' => 0, 'has_more' => false, 'source' => 'invalid'));

    if ($shard_id === '') b64_success(api_treemap_simple_root_items($index, $node_type, $offset, $limit));
    b64_success(api_treemap_simple_shard_items(dirname($index_file), $shard_id, $node_type, $offset, $limit));
}

function api_handle_treemap_search_simple($disk_path) {
    $offset = get_int('offset', 0, 0, PHP_INT_MAX);
    $limit = get_int('limit', 120, 1, 500);
    $node_type = strtolower(trim(param('node_type', 'all')));
    if ($node_type !== 'dir' && $node_type !== 'file') $node_type = 'all';
    $q = strtolower(trim(param('q', '')));

    $index_file = api_treemap_simple_find_index_file($disk_path);
    if (!$index_file || $q === '') b64_success(array('items' => array(), 'total' => 0, 'has_more' => false, 'source' => 'search'));

    $index_dir = dirname($index_file);
    $path_dict = api_treemap_simple_path_dict($index_dir);
    $shards_root = $index_dir . DIRECTORY_SEPARATOR . 'tree_map_data' . DIRECTORY_SEPARATOR . 'shards';
    $items = array();
    $seen = array();

    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($shards_root, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $file) {
        if (!$file->isFile()) continue;
        if (substr($file->getFilename(), -7) !== '.ndjson') continue;
        $fh = @fopen($file->getPathname(), 'r');
        if (!$fh) continue;
        while (($line = fgets($fh)) !== false) {
            $line = trim($line);
            if ($line === '') continue;
            $obj = @json_decode($line, true);
            if (!is_array($obj)) continue;
            $item = api_treemap_simple_item($obj, $path_dict);
            if (!$item || !api_treemap_simple_type_ok($item, $node_type)) continue;
            $path = strtolower(isset($item['path']) ? $item['path'] : '');
            $name = strtolower(isset($item['name']) ? $item['name'] : '');
            if (strpos($path, $q) === false && strpos($name, $q) === false) continue;
            $key = $item['path'] . '|' . $item['type'];
            if (isset($seen[$key])) continue;
            $seen[$key] = true;
            $items[] = $item;
        }
        @fclose($fh);
    }

    usort($items, function($a, $b) {
        $va = isset($a['value']) ? (float)$a['value'] : 0;
        $vb = isset($b['value']) ? (float)$b['value'] : 0;
        if ($va === $vb) return strcmp(isset($a['path']) ? $a['path'] : '', isset($b['path']) ? $b['path'] : '');
        return ($va > $vb) ? -1 : 1;
    });

    $total = count($items);
    b64_success(array('items' => array_slice($items, $offset, $limit), 'total' => $total, 'has_more' => ($offset + min($limit, $total)) < $total, 'source' => 'search'));
}
