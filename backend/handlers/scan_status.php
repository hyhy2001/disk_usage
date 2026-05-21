<?php

function api_resolve_disk_status($status_file) {
    $empty = array(
        'running'     => false,
        'stage'       => 'done',
        'started_at'  => 0,
        'updated_at'  => 0,
        'finished_at' => 0,
        'pid'         => 0,
        'host'        => '',
        'message'     => '',
        'error'       => '',
    );

    if (!is_file($status_file)) return $empty;

    $status = api_load_json_file($status_file);
    if ($status === null) return array_merge($empty, array('error' => 'parse_error'));

    $status = array_merge($empty, $status);

    // Trust the status file content as-is; scan process manages its own state.
    return array(
        'running'     => !empty($status['running']),
        'stage'       => (string)$status['stage'],
        'started_at'  => (int)$status['started_at'],
        'updated_at'  => (int)$status['updated_at'],
        'finished_at' => (int)$status['finished_at'],
        'pid'         => (int)$status['pid'],
        'host'        => (string)$status['host'],
        'message'     => (string)$status['message'],
        'error'       => (string)$status['error'],
    );
}

function api_handle_scan_status($disk_path) {
    $status_file = $disk_path . DIRECTORY_SEPARATOR . DU_SCAN_STATUS_FILENAME;
    b64_success(api_resolve_disk_status($status_file));
}

function api_handle_team_scan_status($root_dir) {
    $team_name = trim(param('name', ''));
    if ($team_name === '') {
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-cache');
        echo json_encode(array('status' => 'error', 'message' => 'Missing team name'));
        exit;
    }

    $disks = api_load_disks_config($root_dir);
    $team_disks = api_find_team_disks($disks, $team_name);

    $result_data = array();
    foreach ($team_disks as $d) {
        if (empty($d['path'])) continue;
        $disk_path = $root_dir . DIRECTORY_SEPARATOR . trim($d['path'], '/\\');
        if (!is_dir($disk_path)) continue;

        $status = api_resolve_disk_status($disk_path . DIRECTORY_SEPARATOR . DU_SCAN_STATUS_FILENAME);
        $status['_disk_id']   = isset($d['id'])   ? (string)$d['id']   : '';
        $status['_disk_name'] = isset($d['name']) ? (string)$d['name'] : 'Unknown Disk';
        $result_data[] = $status;
    }

    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-cache');
    echo json_encode(array('status' => 'success', 'team' => $team_name, 'data' => $result_data));
    exit;
}
