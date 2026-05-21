<?php

function api_handle_team($root_dir) {
    $team_name = trim(param('name', ''));
    if ($team_name === '') b64_error('Missing team name', 400);

    $disks = api_load_disks_config($root_dir);
    $team_disks = api_find_team_disks($disks, $team_name);

    if (empty($team_disks)) b64_error('Team not found or has no disks', 404);

    // ETag from disks.json + each disk_path mtime + team name.
    $etag_paths = array($root_dir . DIRECTORY_SEPARATOR . DU_DISKS_CONFIG_FILENAME);
    foreach ($team_disks as $d) {
        if (!empty($d['path'])) $etag_paths[] = $root_dir . DIRECTORY_SEPARATOR . trim($d['path'], '/\\');
    }
    api_send_etag_cache($etag_paths, array($team_name), 15);

    $result_data = array();

    foreach ($team_disks as $d) {
        if (empty($d['path'])) continue;
        $disk_path = $root_dir . DIRECTORY_SEPARATOR . trim($d['path'], '/\\');
        if (!is_dir($disk_path)) continue;

        $files = api_collect_main_report_files($disk_path);

        $latest = false;
        $max_date = -1;
        foreach ($files as $f) {
            $file_date = get_json_date($f);
            if ($file_date > $max_date) {
                $max_date = $file_date;
                $latest = $f;
            }
        }

        if ($latest) {
            $parsed = api_load_json_file($latest);
            if ($parsed) {
                $summary = array();
                $summary['_disk_id'] = isset($d['id']) ? $d['id'] : '';
                $summary['_disk_name'] = isset($d['name']) ? $d['name'] : 'Unknown Disk';
                $summary['_disk_path'] = '***';
                $summary['general_system'] = isset($parsed['general_system']) ? $parsed['general_system'] : array();
                $summary['team_usage'] = isset($parsed['team_usage']) ? $parsed['team_usage'] : array();
                $summary['date'] = isset($parsed['date']) ? $parsed['date'] : 0;
                $summary['directory'] = isset($parsed['directory']) ? $parsed['directory'] : '';
                $result_data[] = $summary;
            }
        }
    }

    header('Cache-Control: public, max-age=15');
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array('status' => 'success', 'team' => $team_name, 'data' => $result_data));
    exit;
}
