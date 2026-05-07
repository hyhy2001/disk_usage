<?php

function api_treemap_find_index_file($disk_path) {
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

function api_treemap_json_load($path) {
    $raw = @file_get_contents($path);
    if ($raw === false) return false;
    $json = @json_decode($raw, true);
    return is_array($json) ? $json : false;
}

function api_treemap_manifest($index_dir) {
    static $cache = array();
    if (isset($cache[$index_dir])) return $cache[$index_dir];
    $cache[$index_dir] = api_treemap_json_load($index_dir . DIRECTORY_SEPARATOR . 'tree_map_data' . DIRECTORY_SEPARATOR . 'api' . DIRECTORY_SEPARATOR . 'shards_manifest.json');
    return $cache[$index_dir];
}

function api_treemap_path_dict_get($index_dir, $gid) {
    static $meta_cache = array();
    static $value_cache = array();
    static $handle_cache = array();

    $gid = (int)$gid;
    if ($gid < 0) return '';
    if (isset($value_cache[$index_dir]) && array_key_exists($gid, $value_cache[$index_dir])) return $value_cache[$index_dir][$gid];

    if (!isset($meta_cache[$index_dir])) {
        $manifest = api_treemap_manifest($index_dir);
        $meta_cache[$index_dir] = false;
        if (is_array($manifest) && !empty($manifest['path_dict'])) {
            $base_dir = $index_dir . DIRECTORY_SEPARATOR . 'tree_map_data' . DIRECTORY_SEPARATOR;
            $ndjson_path = $base_dir . str_replace(array('/', '\\'), DIRECTORY_SEPARATOR, $manifest['path_dict']);
            $seek_rel = !empty($manifest['path_dict_seek']) ? (string)$manifest['path_dict_seek'] : 'api/path_dict.seek';
            $seek_path = $base_dir . str_replace(array('/', '\\'), DIRECTORY_SEPARATOR, $seek_rel);
            $meta_cache[$index_dir] = array('ndjson_path' => $ndjson_path, 'seek_path' => $seek_path, 'seek_ok' => false, 'count' => 0);
        }
    }

    $meta = $meta_cache[$index_dir];
    if (!is_array($meta) || empty($meta['ndjson_path'])) return '';
    if (!isset($handle_cache[$index_dir])) $handle_cache[$index_dir] = array('sfh' => false, 'dfh' => false, 'fh' => false, 'inited' => false);

    $path = '';
    if (!$handle_cache[$index_dir]['inited']) {
        $handle_cache[$index_dir]['inited'] = true;
        if (is_file($meta['seek_path']) && is_file($meta['ndjson_path'])) {
            $sfh = @fopen($meta['seek_path'], 'rb');
            $dfh = @fopen($meta['ndjson_path'], 'rb');
            if ($sfh && $dfh) {
                $magic = @fread($sfh, 4);
                $version_raw = @fread($sfh, 4);
                $count_raw = @fread($sfh, 4);
                if ($magic === 'PDX1' && strlen($version_raw) === 4 && strlen($count_raw) === 4) {
                    $version = unpack('V', $version_raw); $version = $version ? (int)$version[1] : 0;
                    $count = unpack('V', $count_raw); $count = $count ? (int)$count[1] : 0;
                    if ($version === 1 && $count > 0) {
                        $handle_cache[$index_dir]['sfh'] = $sfh;
                        $handle_cache[$index_dir]['dfh'] = $dfh;
                        $meta_cache[$index_dir]['seek_ok'] = true;
                        $meta_cache[$index_dir]['count'] = $count;
                    } else {
                        @fclose($sfh);
                        @fclose($dfh);
                    }
                } else {
                    @fclose($sfh);
                    @fclose($dfh);
                }
            } else {
                if ($sfh) @fclose($sfh);
                if ($dfh) @fclose($dfh);
            }
        }
        if (!$meta_cache[$index_dir]['seek_ok'] && is_file($meta['ndjson_path'])) {
            $handle_cache[$index_dir]['fh'] = @fopen($meta['ndjson_path'], 'r');
        }
    }

    if (!empty($meta_cache[$index_dir]['seek_ok'])) {
        $sfh = $handle_cache[$index_dir]['sfh'];
        $dfh = $handle_cache[$index_dir]['dfh'];
        $count = (int)$meta_cache[$index_dir]['count'];
        $record_size = 16;
        $left = 0; $right = $count - 1;
        while ($left <= $right) {
            $mid = (int)(($left + $right) / 2);
            if (@fseek($sfh, 12 + ($mid * $record_size)) !== 0) break;
            $gid_raw = @fread($sfh, 4); $off_raw = @fread($sfh, 8); $len_raw = @fread($sfh, 4);
            if (strlen($gid_raw) !== 4 || strlen($off_raw) !== 8 || strlen($len_raw) !== 4) break;
            $cur_gid = unpack('V', $gid_raw); $cur_gid = $cur_gid ? (int)$cur_gid[1] : -1;
            if ($cur_gid < $gid) {
                $left = $mid + 1;
            } else if ($cur_gid > $gid) {
                $right = $mid - 1;
            } else {
                $off_parts = unpack('V2', $off_raw);
                $off = $off_parts ? (((int)$off_parts[1]) + (((int)$off_parts[2]) * 4294967296)) : -1;
                $len = unpack('V', $len_raw); $len = $len ? (int)$len[1] : 0;
                if ($off >= 0 && $len > 0 && $len <= 16777216 && @fseek($dfh, $off) === 0) {
                    $line = @fread($dfh, $len);
                    $obj = @json_decode(rtrim((string)$line, "\r\n"), true);
                    if (is_array($obj) && isset($obj['p'])) $path = (string)$obj['p'];
                }
                break;
            }
        }
    }

    if ($path === '') {
        $fh = $handle_cache[$index_dir]['fh'];
        if ($fh && @rewind($fh)) {
            while (($line = fgets($fh)) !== false) {
                $obj = @json_decode(trim($line), true);
                if (!is_array($obj) || !isset($obj['gid']) || !isset($obj['p'])) continue;
                if ((int)$obj['gid'] === $gid) { $path = (string)$obj['p']; break; }
            }
        }
    }

    if (!isset($value_cache[$index_dir])) $value_cache[$index_dir] = array();
    $value_cache[$index_dir][$gid] = $path;
    return $path;
}

function api_treemap_bucket_path($index_dir, $template, $prefix) {
    if (!$template) return false;
    return $index_dir . DIRECTORY_SEPARATOR . 'tree_map_data' . DIRECTORY_SEPARATOR . str_replace(array('/', '\\'), DIRECTORY_SEPARATOR, str_replace('{prefix}', $prefix, $template));
}

function api_treemap_shard_items($index_dir, $shard_id, $node_type, $offset, $limit) {
    $manifest = api_treemap_manifest($index_dir);
    if (!is_array($manifest) || empty($manifest['pid_seek']) || empty($manifest['shard_path_template'])) return array('items'=>array(),'total'=>0,'has_more'=>false,'source'=>'pid_seek');
    $pid_seek_path = $index_dir . DIRECTORY_SEPARATOR . 'tree_map_data' . DIRECTORY_SEPARATOR . str_replace(array('/', '\\'), DIRECTORY_SEPARATOR, $manifest['pid_seek']);
    if (!is_file($pid_seek_path)) return array('items'=>array(),'total'=>0,'has_more'=>false,'source'=>'pid_seek');

    $target_pid = strtolower((string)$shard_id);
    if ($target_pid === '' || !ctype_xdigit($target_pid)) return array('items'=>array(),'total'=>0,'has_more'=>false,'source'=>'pid_seek');
    $target_pid = str_pad(substr($target_pid, 0, 16), 16, '0', STR_PAD_LEFT);
    $target_hi = hexdec(substr($target_pid, 0, 8));
    $target_lo = hexdec(substr($target_pid, 8, 8));

    $sfh = @fopen($pid_seek_path, 'rb');
    if (!$sfh) return array('items'=>array(),'total'=>0,'has_more'=>false,'source'=>'pid_seek');
    $magic = @fread($sfh, 4); $version_raw = @fread($sfh, 4); $count_raw = @fread($sfh, 8);
    if ($magic !== 'PSDX' || strlen($version_raw) !== 4 || strlen($count_raw) !== 8) { @fclose($sfh); return array('items'=>array(),'total'=>0,'has_more'=>false,'source'=>'pid_seek'); }
    $version = unpack('V', $version_raw); $version = $version ? (int)$version[1] : 0;
    $count_parts = unpack('V2', $count_raw); $count = $count_parts ? (((int)$count_parts[1]) + (((int)$count_parts[2]) * 4294967296)) : 0;
    if ($version !== 1 || $count <= 0) { @fclose($sfh); return array('items'=>array(),'total'=>0,'has_more'=>false,'source'=>'pid_seek'); }

    $record_size = 25; $left = 0; $right = $count - 1; $first = -1;
    while ($left <= $right) {
        $mid = (int)(($left + $right) / 2);
        if (@fseek($sfh, 16 + ($mid * $record_size)) !== 0) break;
        $rec_raw = @fread($sfh, $record_size); if (strlen($rec_raw) !== $record_size) break;
        $pid_hi = unpack('V', substr($rec_raw, 0, 4)); $pid_hi = $pid_hi ? (int)$pid_hi[1] : -1;
        $pid_lo_a = unpack('V2', substr($rec_raw, 4, 8)); $pid_lo = $pid_lo_a ? ((int)$pid_lo_a[1] + ((int)$pid_lo_a[2] * 4294967296)) : -1;
        if ($pid_hi < $target_hi || ($pid_hi === $target_hi && $pid_lo < $target_lo)) $left = $mid + 1;
        else if ($pid_hi > $target_hi || ($pid_hi === $target_hi && $pid_lo > $target_lo)) $right = $mid - 1;
        else { $first = $mid; $right = $mid - 1; }
    }

    if ($first < 0) { @fclose($sfh); return array('items'=>array(),'total'=>0,'has_more'=>false,'source'=>'pid_seek'); }

    $bucket_handles = array(); $items = array();
    for ($i = $first; $i < $count; $i++) {
        if (@fseek($sfh, 16 + ($i * $record_size)) !== 0) break;
        $rec_raw = @fread($sfh, $record_size); if (strlen($rec_raw) !== $record_size) break;
        $pid_hi = unpack('V', substr($rec_raw, 0, 4)); $pid_hi = $pid_hi ? (int)$pid_hi[1] : -1;
        $pid_lo_a = unpack('V2', substr($rec_raw, 4, 8)); $pid_lo = $pid_lo_a ? ((int)$pid_lo_a[1] + ((int)$pid_lo_a[2] * 4294967296)) : -1;
        if ($pid_hi !== $target_hi || $pid_lo !== $target_lo) break;
        $bucket_prefix = unpack('C', substr($rec_raw, 12, 1)); $bucket_prefix = $bucket_prefix ? (int)$bucket_prefix[1] : 0;
        $offset_a = unpack('V2', substr($rec_raw, 13, 8)); $row_offset = $offset_a ? ((int)$offset_a[1] + ((int)$offset_a[2] * 4294967296)) : -1;
        $row_len_a = unpack('V', substr($rec_raw, 21, 4)); $row_len = $row_len_a ? (int)$row_len_a[1] : 0;
        if ($row_offset < 0 || $row_len <= 0 || $row_len > 16777216) continue;
        $prefix = str_pad(dechex($bucket_prefix), 2, '0', STR_PAD_LEFT);
        if (!isset($bucket_handles[$prefix])) {
            $bucket_path = api_treemap_bucket_path($index_dir, $manifest['shard_path_template'], $prefix);
            $bucket_handles[$prefix] = ($bucket_path && is_file($bucket_path)) ? @fopen($bucket_path, 'rb') : false;
        }
        $dfh = $bucket_handles[$prefix]; if (!$dfh) continue;
        if (@fseek($dfh, $row_offset) !== 0) continue;
        $line = @fread($dfh, $row_len); if (!is_string($line) || $line === '') continue;
        $obj = @json_decode(rtrim($line, "\r\n"), true);
        if (!is_array($obj) || !isset($obj['pid']) || strtolower((string)$obj['pid']) !== $target_pid) continue;
        if (isset($obj['id']) && strtolower((string)$obj['id']) === $target_pid) continue;
        $item = api_treemap_item($obj, $index_dir);
        if ($item && api_treemap_type_ok($item, $node_type)) $items[] = $item;
    }
    @fclose($sfh); foreach ($bucket_handles as $fh) if ($fh) @fclose($fh);

    usort($items, function($a, $b) { $va = isset($a['value']) ? (float)$a['value'] : 0; $vb = isset($b['value']) ? (float)$b['value'] : 0; if ($va === $vb) return strcmp(isset($a['path']) ? $a['path'] : '', isset($b['path']) ? $b['path'] : ''); return ($va > $vb) ? -1 : 1; });
    $total = count($items);
    return array('items' => array_slice($items, $offset, $limit), 'total' => $total, 'has_more' => ($offset + min($limit, $total)) < $total, 'source' => 'pid_seek');
}

function api_treemap_item($obj, $index_dir) { if (!is_array($obj)) return false; $gid = isset($obj['gid']) ? (int)$obj['gid'] : -1; $path = ($gid >= 0) ? api_treemap_path_dict_get($index_dir, $gid) : ''; $t = isset($obj['t']) ? (string)$obj['t'] : 'd'; if ($t === 'f') $type = 'file'; else if ($t === 'g' || $t === 'fg') $type = 'file_group'; else $type = 'directory'; return array('name' => isset($obj['n']) ? (string)$obj['n'] : basename($path), 'path' => $path, 'owner' => isset($obj['o']) ? (string)$obj['o'] : '', 'value' => isset($obj['v']) ? (float)$obj['v'] : 0.0, 'size' => isset($obj['v']) ? (float)$obj['v'] : 0.0, 'type' => $type, 'shard_id' => isset($obj['id']) ? (string)$obj['id'] : '', 'parent_shard_id' => isset($obj['pid']) ? (string)$obj['pid'] : '', 'has_children' => !empty($obj['h'])); }
function api_treemap_type_ok($item, $node_type) { if ($node_type === 'all' || !is_array($item)) return true; if ($node_type === 'dir') return isset($item['type']) && $item['type'] === 'directory'; if ($node_type === 'file') return isset($item['type']) && ($item['type'] === 'file' || $item['type'] === 'file_group'); return true; }
function api_treemap_make_root($index) { if (!is_array($index)) return null; return array('name' => isset($index['name']) ? (string)$index['name'] : '/', 'path' => isset($index['path']) ? (string)$index['path'] : '/', 'owner' => isset($index['owner']) ? (string)$index['owner'] : '', 'value' => isset($index['value']) ? (float)$index['value'] : (isset($index['size']) ? (float)$index['size'] : 0.0), 'size' => isset($index['size']) ? (float)$index['size'] : (isset($index['value']) ? (float)$index['value'] : 0.0), 'type' => isset($index['type']) ? (string)$index['type'] : 'directory', 'shard_id' => isset($index['shard_id']) ? (string)$index['shard_id'] : '', 'parent_shard_id' => '', 'has_children' => !empty($index['has_children']) || !empty($index['children']), 'children' => array()); }
function api_treemap_root_items($index, $node_type, $offset, $limit) { $items = array(); if (isset($index['children']) && is_array($index['children'])) { foreach ($index['children'] as $child) { if (!is_array($child)) continue; $item = array('name' => isset($child['name']) ? (string)$child['name'] : '', 'path' => isset($child['path']) ? (string)$child['path'] : '', 'owner' => isset($child['owner']) ? (string)$child['owner'] : '', 'value' => isset($child['value']) ? (float)$child['value'] : (isset($child['size']) ? (float)$child['size'] : 0.0), 'size' => isset($child['size']) ? (float)$child['size'] : (isset($child['value']) ? (float)$child['value'] : 0.0), 'type' => isset($child['type']) ? (string)$child['type'] : 'directory', 'shard_id' => isset($child['shard_id']) ? (string)$child['shard_id'] : '', 'parent_shard_id' => isset($index['shard_id']) ? (string)$index['shard_id'] : '', 'has_children' => !empty($child['has_children'])); if (api_treemap_type_ok($item, $node_type)) $items[] = $item; } } $total = count($items); return array('items' => array_slice($items, $offset, $limit), 'total' => $total, 'has_more' => ($offset + min($limit, $total)) < $total, 'source' => 'index_embedded'); }

function api_handle_treemap($disk_path) {
    $shard_id = sanitize_name(trim(param('shard_id', '')));
    $offset = get_int('offset', 0, 0, PHP_INT_MAX);
    $limit = get_int('limit', 120, 1, 500);
    $node_type = strtolower(trim(param('node_type', 'all')));
    if ($node_type !== 'dir' && $node_type !== 'file') $node_type = 'all';
    $index_file = api_treemap_find_index_file($disk_path);
    if (!$index_file) b64_success(array('root' => null, 'items' => array(), 'total' => 0, 'has_more' => false, 'source' => 'none'));
    $index = api_treemap_json_load($index_file);
    if (!is_array($index)) b64_success(array('root' => null, 'items' => array(), 'total' => 0, 'has_more' => false, 'source' => 'invalid'));
    $root = api_treemap_make_root($index);
    if ($shard_id === '') { $result = api_treemap_root_items($index, $node_type, $offset, $limit); $result['root'] = $root; b64_success($result); }
    b64_success(api_treemap_shard_items(dirname($index_file), $shard_id, $node_type, $offset, $limit));
}

function api_handle_treemap_search($disk_path) {
    $offset = get_int('offset', 0, 0, PHP_INT_MAX); $limit = get_int('limit', 120, 1, 500); $node_type = strtolower(trim(param('node_type', 'all'))); if ($node_type !== 'dir' && $node_type !== 'file') $node_type = 'all'; $q = trim(param('q', ''));
    $index_file = api_treemap_find_index_file($disk_path); if (!$index_file || $q === '') b64_success(array('items' => array(), 'total' => 0, 'has_more' => false, 'source' => 'search'));
    $cmd = array(escapeshellarg('/www/wwwroot/disk.hydev.me/check_disk/src/native_index/query_cli'), escapeshellarg(dirname($index_file))); if ($node_type === 'dir' || $node_type === 'file') { $cmd[]='--type'; $cmd[]=$node_type; }
    $cmd[]='--kw'; $cmd[]=escapeshellarg(str_replace(',', '|', (string)$q)); $cmd[]='--offset'; $cmd[]=escapeshellarg((string)(int)$offset); $cmd[]='--limit'; $cmd[]=escapeshellarg((string)(int)$limit); $cmd[]='--sort'; $cmd[]='size_desc'; $cmd[]='--json'; $cmd[]='--docs';
    $json = @json_decode((string)@shell_exec(implode(' ', $cmd) . ' 2>&1'), true); if (!is_array($json) || !isset($json['docs']) || !is_array($json['docs'])) b64_success(array('items' => array(), 'total' => 0, 'has_more' => false, 'source' => 'search_cli_error'));
    $items = array(); foreach ($json['docs'] as $doc) { if (!is_array($doc)) continue; $docName = isset($doc['name']) ? (string)$doc['name'] : ''; $docPath = isset($doc['path']) ? (string)$doc['path'] : ''; if ($docName === '[files]' || strpos($docPath, '__files__') !== false) continue; $t = isset($doc['type']) ? (string)$doc['type'] : 'd'; if ($t === 'f') $type = 'file'; else if ($t === 'g' || $t === 'fg') $type = 'file_group'; else $type = 'directory'; $item = array('name' => isset($doc['name']) ? (string)$doc['name'] : '', 'path' => isset($doc['path']) ? (string)$doc['path'] : '', 'owner' => isset($doc['user']) ? (string)$doc['user'] : '', 'value' => isset($doc['size']) ? (float)$doc['size'] : 0.0, 'size' => isset($doc['size']) ? (float)$doc['size'] : 0.0, 'type' => $type, 'shard_id' => isset($doc['shard_id']) ? (string)$doc['shard_id'] : '', 'parent_shard_id' => '', 'has_children' => !empty($doc['has_children'])); if (!api_treemap_type_ok($item, $node_type)) continue; $items[] = $item; }
    $total = isset($json['matched']) ? (int)$json['matched'] : count($items); if ($total < 0) $total = 0;
    b64_success(array('items' => $items, 'total' => $total, 'has_more' => ($offset + count($items)) < $total, 'source' => 'search_cli'));
}
