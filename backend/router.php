<?php

function api_dispatch_global_type($type, $root_dir) {
    $global_routes = array(
        'disks' => 'api_handle_disks',
        'team' => 'api_handle_team',
        'team_scan_status' => 'api_handle_team_scan_status',
        'health' => 'api_handle_health',
        'group_config' => 'api_handle_group_config',
        'admin' => 'api_handle_admin',
    );
    if (!isset($global_routes[$type])) return false;
    call_user_func($global_routes[$type], $root_dir);
    return true;
}

function api_dispatch_disk_type($type, $disk_path) {
    $disk_routes = array(
        'permissions' => 'api_handle_permissions',
        'treemap' => 'api_handle_treemap',
        'treemap_search' => 'api_handle_treemap_search',
        'meta' => 'api_handle_meta',
        'users' => 'api_handle_users',
        'dirs' => 'api_handle_dirs',
        'files' => 'api_handle_files',
        'detail' => 'api_handle_detail',
    );
    if (!isset($disk_routes[$type])) return false;
    call_user_func($disk_routes[$type], $disk_path);
    return true;
}

function api_dispatch_request($root_dir) {
    $req_id = sanitize_name(param('id', ''));
    $type   = (string)param('type', '');

    if (api_dispatch_global_type($type, $root_dir)) return;

    if ($req_id === '') {
        http_response_code(400);
        echo 'Missing disk id.';
        exit;
    }

    $disks = api_load_disks_config($root_dir);
    $disk_entry = api_resolve_disk_entry_by_id($disks, $req_id);

    if (!$disk_entry || empty($disk_entry['path'])) {
        http_response_code(404);
        echo 'Disk not found.';
        exit;
    }

    $disk_path = $root_dir . DIRECTORY_SEPARATOR . trim($disk_entry['path'], '/\\');

    if (!is_dir($disk_path) && !is_link($disk_path)) {
        http_response_code(404);
        echo 'Disk directory not found.';
        exit;
    }

    header('Content-Type: text/plain; charset=utf-8');

    if (api_dispatch_disk_type($type, $disk_path)) return;

    api_handle_aggregate($disk_path);
}
