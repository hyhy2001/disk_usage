<?php

function api_handle_users($disk_path) {
    $detail_dir = $disk_path . DIRECTORY_SEPARATOR . 'detail_users';
    $users = array();
    if (is_dir($detail_dir)) {
        $dh = @opendir($detail_dir);
        while ($dh && ($f = readdir($dh)) !== false) {
            if (preg_match('/(?:.*_)?detail_report_dirs?_(.+)\.json$/', $f, $m)) {
                $users[] = $m[1];
            }
        }
        if ($dh) closedir($dh);

        $users = array_unique($users);
        sort($users);
    }
    b64_success(array('users' => $users));
}
