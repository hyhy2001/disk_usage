<?php

function api_handle_health($root_dir) {
    $status = api_cache_runtime_status();
    $disks = api_load_disks_config($root_dir);

    $disk_count = 0;
    if (is_array($disks)) {
        foreach ($disks as $entry) {
            if (isset($entry['id'])) {
                $disk_count++;
                continue;
            }
            if (isset($entry['disks']) && is_array($entry['disks'])) {
                $disk_count += count($entry['disks']);
            }
            if (isset($entry['teams']) && is_array($entry['teams'])) {
                foreach ($entry['teams'] as $team) {
                    if (isset($team['disks']) && is_array($team['disks'])) {
                        $disk_count += count($team['disks']);
                    }
                }
            }
        }
    }

    b64_success(array(
        'service' => 'disk_usage_api',
        'cache' => $status,
        'disks_config_count' => $disk_count,
        'timestamp' => time(),
    ));
}

