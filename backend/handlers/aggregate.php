<?php

function api_handle_aggregate($disk_path) {
    $files = api_collect_main_report_files($disk_path);

    $file_dates = array();
    foreach ($files as $f) {
        $file_dates[$f] = get_json_date($f);
    }
    usort($files, function($a, $b) use ($file_dates) {
        return $file_dates[$a] - $file_dates[$b];
    });

    $inode_file = find_file_by_pattern($disk_path, '/.*inode_usage_report.*\.json$/i');
    $inode_json = "null";
    if ($inode_file && is_file($inode_file)) {
        $inode_json = file_get_contents($inode_file);
    }

    header('Cache-Control: public, max-age=60');
    header('Content-Type: application/json; charset=utf-8');

    echo '{"status":"success","total_files":' . count($files) . ',"inodes":' . ($inode_json ?: "null") . ',"data":[';
    $first = true;
    foreach ($files as $file) {
        if (!$first) echo ',';
        readfile($file);
        $first = false;
    }
    echo ']}';
    exit;
}
