<?php

function api_cache_dir() {
    $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'disk_usage_api_cache';
    if (!is_dir($dir)) @mkdir($dir, 0777, true);
    return $dir;
}

function api_cache_key_path($key) {
    return api_cache_dir() . DIRECTORY_SEPARATOR . md5($key) . '.json';
}

function api_cache_get($key, $ttl_seconds) {
    $fp = api_cache_key_path($key);
    if (!is_file($fp)) return null;

    $raw = @file_get_contents($fp);
    if ($raw === false) return null;

    $obj = @json_decode($raw, true);
    if (!is_array($obj) || !isset($obj['ts']) || !array_key_exists('data', $obj)) return null;

    $age = time() - (int)$obj['ts'];
    if ($age > (int)$ttl_seconds) return null;

    return $obj['data'];
}

function api_cache_set($key, $data) {
    $fp = api_cache_key_path($key);
    $tmp = $fp . '.tmp.' . getmypid() . '.' . mt_rand(1000, 9999);

    $payload = json_encode(array(
        'ts'   => time(),
        'data' => $data,
    ));
    if ($payload === false) return;

    if (@file_put_contents($tmp, $payload, LOCK_EX) !== false) {
        @rename($tmp, $fp);
        @chmod($fp, 0666);
    } else {
        @unlink($tmp);
    }
}

