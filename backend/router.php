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

    if ($type === 'health') {
        api_handle_health($root_dir);
    }

    if ($type === 'group_config') {
        api_handle_group_config($root_dir);
    }

    if ($type === 'admin') {
        api_handle_admin($root_dir);
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
    if ($type === 'treemap') {
        api_handle_treemap($disk_path);
    }
    if ($type === 'treemap_search') {
        api_handle_treemap_search($disk_path);
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
    if ($type === 'dirs_csv') {
        api_handle_dirs_csv($disk_path);
    }
    if ($type === 'files') {
        api_handle_files($disk_path);
    }
    if ($type === 'files_csv') {
        api_handle_files_csv($disk_path);
    }
    if ($type === 'detail') {
        api_handle_detail($disk_path);
    }
    if ($type === 'scan_status') {
        api_handle_scan_status($disk_path);
    }

    api_handle_aggregate($disk_path);
}
