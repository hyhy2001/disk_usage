<?php

// Read a file and return its trimmed contents only if it is valid JSON;
// otherwise null. Guards the aggregate stream against empty/half-written
// report files (the scanner writes these atomically, but a crash mid-write
// or an NFS hiccup can still leave a truncated file) — without this, one bad
// file silently corrupts the whole concatenated JSON array.
function api_aggregate_read_valid_json($file) {
    $raw = @file_get_contents($file);
    if ($raw === false) return null;
    $raw = trim($raw);
    if ($raw === '') return null;
    json_decode($raw);
    if (json_last_error() !== JSON_ERROR_NONE) return null;
    return $raw;
}

function api_handle_aggregate($disk_path) {
    $files = api_collect_main_report_files($disk_path);

    $file_dates = array();
    foreach ($files as $f) {
        $file_dates[$f] = get_json_date($f);
    }
    usort($files, function($a, $b) use ($file_dates) {
        return $file_dates[$a] - $file_dates[$b];
    });

    // Pre-read and validate so total_files and the emitted array agree, and a
    // corrupt file is skipped instead of breaking the response.
    $valid = array();
    foreach ($files as $file) {
        $json = api_aggregate_read_valid_json($file);
        if ($json !== null) $valid[] = $json;
    }

    $inode_file = find_file_by_pattern($disk_path, DU_INODE_REPORT_PATTERN);
    $inode_json = "null";
    if ($inode_file && is_file($inode_file)) {
        $maybe = api_aggregate_read_valid_json($inode_file);
        if ($maybe !== null) $inode_json = $maybe;
    }

    header('Cache-Control: no-store');
    header('Content-Type: application/json; charset=utf-8');
    echo '{"status":"success","total_files":' . count($valid) . ',"inodes":' . $inode_json . ',"data":[';
    $first = true;
    foreach ($valid as $json) {
        if (!$first) echo ',';
        echo $json;
        $first = false;
    }
    echo ']}';
    exit;
}
