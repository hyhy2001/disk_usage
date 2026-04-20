<?php

function api_cache_dir() {
    $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'disk_usage_api_cache';
    if (!is_dir($dir)) @mkdir($dir, 0777, true);
    return $dir;
}

function api_cache_runtime_status() {
    $dir = api_cache_dir();
    $exists = is_dir($dir);
    $writable = $exists && is_writable($dir);
    $probe_ok = false;
    $probe_file = $dir . DIRECTORY_SEPARATOR . '.probe.' . getmypid() . '.' . mt_rand(1000, 9999);

    if ($writable) {
        if (@file_put_contents($probe_file, 'ok', LOCK_EX) !== false) {
            $probe_ok = true;
            @unlink($probe_file);
        }
    }

    return array(
        'cache_dir' => $dir,
        'exists' => $exists,
        'writable' => $writable,
        'probe_ok' => $probe_ok,
        'mode' => ($exists && $writable && $probe_ok) ? 'enabled' : 'degraded',
    );
}

function api_cache_key_path($key) {
    return api_cache_dir() . DIRECTORY_SEPARATOR . md5($key) . '.json';
}

function api_cache_lock_path($key) {
    return api_cache_dir() . DIRECTORY_SEPARATOR . md5($key) . '.lock';
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

function api_cache_lock_acquire($key, $wait_seconds) {
    $lock_fp = api_cache_lock_path($key);
    $fh = @fopen($lock_fp, 'c');
    if (!$fh) return false;

    $deadline = microtime(true) + max(0.1, (float)$wait_seconds);
    do {
        if (@flock($fh, LOCK_EX | LOCK_NB)) {
            return $fh;
        }
        usleep(50000); // 50ms backoff
    } while (microtime(true) < $deadline);

    @fclose($fh);
    return false;
}

function api_cache_lock_release($lock_handle) {
    if (!$lock_handle) return;
    @flock($lock_handle, LOCK_UN);
    @fclose($lock_handle);
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
        api_cache_maybe_cleanup();
    } else {
        @unlink($tmp);
    }
}

function api_cache_remember($key, $ttl_seconds, $builder, $lock_wait_seconds, $peer_wait_seconds) {
    $cached = api_cache_get($key, $ttl_seconds);
    if ($cached !== null) return $cached;

    $lock = api_cache_lock_acquire($key, $lock_wait_seconds);
    if ($lock) {
        // Re-check after lock to avoid duplicate rebuild.
        $cached = api_cache_get($key, $ttl_seconds);
        if ($cached !== null) {
            api_cache_lock_release($lock);
            return $cached;
        }

        $data = call_user_func($builder);
        if ($data !== null) api_cache_set($key, $data);
        api_cache_lock_release($lock);
        return $data;
    }

    // Could not lock: wait briefly for peer to populate cache.
    $deadline = microtime(true) + max(0.1, (float)$peer_wait_seconds);
    do {
        usleep(60000); // 60ms poll interval
        $cached = api_cache_get($key, $ttl_seconds);
        if ($cached !== null) return $cached;
    } while (microtime(true) < $deadline);

    // Last resort: rebuild without lock.
    $data = call_user_func($builder);
    if ($data !== null) api_cache_set($key, $data);
    return $data;
}

function api_cache_maybe_cleanup() {
    // Lightweight probabilistic cleanup to keep temp cache folder healthy.
    if (mt_rand(1, 50) !== 1) return;

    $dir = api_cache_dir();
    if (!is_dir($dir)) return;

    $ttl_hard = 300; // 5 minutes
    $max_files = 400;
    $now = time();

    $entries = array();
    $dh = @opendir($dir);
    while ($dh && ($f = readdir($dh)) !== false) {
        if (substr($f, -5) !== '.json') continue;
        $fp = $dir . DIRECTORY_SEPARATOR . $f;
        $mtime = @filemtime($fp);
        if (!is_int($mtime)) continue;
        $entries[] = array('path' => $fp, 'mtime' => $mtime);
        if (($now - $mtime) > $ttl_hard) @unlink($fp);
    }
    if ($dh) closedir($dh);

    if (count($entries) <= $max_files) return;

    usort($entries, function($a, $b) {
        if ($a['mtime'] == $b['mtime']) return 0;
        return ($a['mtime'] > $b['mtime']) ? -1 : 1;
    });
    for ($i = $max_files; $i < count($entries); $i++) {
        @unlink($entries[$i]['path']);
    }
}
