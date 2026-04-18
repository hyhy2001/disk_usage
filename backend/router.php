<?php

function api_dispatch_request($root_dir) {
    $req_id = sanitize_name(param('id', ''));
    $type   = param('type', '');

    if ($type === 'disks') {
        api_handle_disks($root_dir);
    }

    if ($type === 'team') {
        api_handle_team($root_dir);
    }

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

    $type = param('type', '');
    if ($type === 'permissions') {
        api_handle_permissions($disk_path);
    }
    if ($type === 'meta') {
        api_handle_meta($disk_path);
    }
    if ($type === 'users') {
        api_handle_users($disk_path);
    }
    if ($type === 'dirs') {
        api_handle_dirs($disk_path);
    }
    if ($type === 'files') {
        api_handle_files($disk_path);
    }

    api_handle_aggregate($disk_path);
}
