<?php

function api_handle_health($root_dir) {
    $status = api_cache_runtime_status();
    $disks = api_load_disks_config($root_dir);
    $disk_count = api_count_disks($disks);

    b64_success(array(
        'service' => 'disk_usage_api',
        'cache' => $status,
        'disks_config_count' => $disk_count,
        'timestamp' => time(),
    ));
}

