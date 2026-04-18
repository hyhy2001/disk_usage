<?php

function api_handle_team($root_dir) {
    $team_name = trim(param('name', ''));
    if ($team_name === '') b64_error('Missing team name', 400);

    $disks = api_load_disks_config($root_dir);
    $team_disks = array();

    if (is_array($disks)) {
        foreach ($disks as $p_or_d) {
            if (isset($p_or_d['teams']) && is_array($p_or_d['teams'])) {
                foreach ($p_or_d['teams'] as $t) {
                    if (isset($t['name']) && $t['name'] === $team_name) {
                        if (isset($t['disks']) && is_array($t['disks'])) {
                            foreach ($t['disks'] as $d) {
                                $team_disks[] = $d;
                            }
                        }
                    }
                }
            }
            if (isset($p_or_d['name']) && $p_or_d['name'] === $team_name) {
                if (isset($p_or_d['disks']) && is_array($p_or_d['disks'])) {
                    foreach ($p_or_d['disks'] as $d) {
                        $team_disks[] = $d;
                    }
                }
            }
        }
    }

    if (empty($team_disks)) b64_error('Team not found or has no disks', 404);

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
            $json = @file_get_contents($latest);
            $parsed = @json_decode($json, true);
            if ($parsed && is_array($parsed)) {
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
