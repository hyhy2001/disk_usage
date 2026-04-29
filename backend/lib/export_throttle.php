<?php

function api_export_detect_cpu_count() {
    $n = 0;
    if (function_exists('shell_exec')) {
        $out = @shell_exec('nproc 2>/dev/null');
        if (is_string($out)) $n = (int)trim($out);
    }
    if ($n <= 0 && is_readable('/proc/cpuinfo')) {
        $raw = @file_get_contents('/proc/cpuinfo');
        if (is_string($raw)) $n = substr_count($raw, 'processor');
    }
    return $n > 0 ? $n : 2;
}

function api_export_detect_max_workers() {
    $override = getenv('DISK_USAGE_CSV_EXPORT_WORKERS');
    if ($override !== false && trim($override) !== '') {
        $v = (int)$override;
        if ($v > 0) return max(1, min(16, $v));
    }

    $cpu = api_export_detect_cpu_count();
    return max(1, min(4, (int)floor($cpu / 2)));
}

function api_export_lock_dir($disk_path) {
    $base = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'disk_usage_csv_locks';
    if (!is_dir($base)) @mkdir($base, 0777, true);
    @chmod($base, 0777);
    $dir = $base . DIRECTORY_SEPARATOR . sha1($disk_path);
    if (!is_dir($dir)) @mkdir($dir, 0777, true);
    @chmod($dir, 0777);
    return $dir;
}

function api_export_acquire_slot($disk_path, $max_wait_seconds = 120) {
    $lock_dir = api_export_lock_dir($disk_path);
    if (!is_dir($lock_dir) || !is_writable($lock_dir)) {
        b64_error('CSV export lock directory is not writable.', 500);
    }

    $slots = api_export_detect_max_workers();
    $deadline = microtime(true) + max(0, (int)$max_wait_seconds);
    $handles = array();

    while (true) {
        for ($i = 1; $i <= $slots; $i++) {
            $path = $lock_dir . DIRECTORY_SEPARATOR . 'slot_' . $i . '.lock';
            if (!isset($handles[$i])) {
                if (!is_file($path)) @touch($path);
                @chmod($path, 0666);
                $fh = @fopen($path, 'c+');
                if (!$fh) continue;
                $handles[$i] = $fh;
            }

            if (@flock($handles[$i], LOCK_EX | LOCK_NB)) {
                @ftruncate($handles[$i], 0);
                @fwrite($handles[$i], getmypid() . "\n" . time() . "\n");
                foreach ($handles as $idx => $fh) {
                    if ($idx !== $i && is_resource($fh)) @fclose($fh);
                }
                return array('handle' => $handles[$i], 'slot' => $i, 'slots' => $slots);
            }
        }

        if (microtime(true) >= $deadline) {
            foreach ($handles as $fh) if (is_resource($fh)) @fclose($fh);
            http_response_code(429);
            b64_error('CSV export queue is busy. Please try again later.', 429);
        }

        usleep(250000);
    }
}
