<?php

function api_handle_disks($root_dir) {
    $disks = api_load_disks_config($root_dir);
    $safe_disks = array();

    if (is_array($disks)) {
        foreach ($disks as $p_or_d) {
            if (isset($p_or_d['id'])) {
                $safe_disks[] = array(
                    'id'   => $p_or_d['id'],
                    'name' => isset($p_or_d['name']) ? $p_or_d['name'] : ''
                );
            } elseif (isset($p_or_d['project'])) {
                $proj = array('project' => $p_or_d['project']);
                $safe_teams = array();
                if (isset($p_or_d['teams']) && is_array($p_or_d['teams'])) {
                    foreach ($p_or_d['teams'] as $t) {
                        $team = array('name' => isset($t['name']) ? $t['name'] : 'Unknown');
                        $safe_disk_list = array();
                        if (isset($t['disks']) && is_array($t['disks'])) {
                            foreach ($t['disks'] as $d) {
                                $safe_disk_list[] = array(
                                    'id'   => isset($d['id']) ? $d['id'] : '',
                                    'name' => isset($d['name']) ? $d['name'] : ''
                                );
                            }
                        }
                        $team['disks'] = $safe_disk_list;
                        $safe_teams[] = $team;
                    }
                }
                $proj['teams'] = $safe_teams;
                $safe_disks[] = $proj;
            } elseif (isset($p_or_d['name']) && isset($p_or_d['disks'])) {
                $team = array('name' => $p_or_d['name']);
                $safe_disk_list = array();
                if (is_array($p_or_d['disks'])) {
                    foreach ($p_or_d['disks'] as $d) {
                        $safe_disk_list[] = array(
                            'id'   => isset($d['id']) ? $d['id'] : '',
                            'name' => isset($d['name']) ? $d['name'] : ''
                        );
                    }
                }
                $team['disks'] = $safe_disk_list;
                $safe_disks[] = $team;
            }
        }
    }

    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($safe_disks);
    exit;
}
