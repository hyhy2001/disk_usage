<?php

function api_meta_read_total_dirs($report_file) {
    $fh = @fopen($report_file, 'r');
    if (!$fh) return 0;

    $total_dirs = 0;
    while (($ln = fgets($fh)) !== false) {
        if (preg_match('/"total_dirs"\s*:\s*(\d+)/', $ln, $m)) {
            $total_dirs = (int)$m[1];
            break;
        }
        if (strpos($ln, '"dirs"') !== false && strpos($ln, '[') !== false) {
            break;
        }
    }
    fclose($fh);

    return $total_dirs;
}

function api_meta_read_total_files($report_file) {
    $fh = @fopen($report_file, 'r');
    if (!$fh) return 0;

    $total_files = 0;
    while (($ln = fgets($fh)) !== false) {
        if (preg_match('/"total_files"\s*:\s*(\d+)/', $ln, $m)) {
            $total_files = (int)$m[1];
            break;
        }
        if (strpos($ln, '"files"') !== false && strpos($ln, '[') !== false) {
            break;
        }
    }
    fclose($fh);

    return $total_files;
}

function api_handle_meta($disk_path) {
    $files = api_collect_main_report_files($disk_path);
    $latest_date = 0;
    foreach ($files as $f) {
        $d = get_json_date($f);
        if ($d > $latest_date) $latest_date = $d;
    }

    $total_files = 0;
    $total_dirs = 0;
    $detail_dir = $disk_path . DIRECTORY_SEPARATOR . 'detail_users';
    if (is_dir($detail_dir)) {
        $latest_dir_by_user = array();
        $latest_file_by_user = array();
        $dh = @opendir($detail_dir);
        while ($dh && ($f = readdir($dh)) !== false) {
            $fp = $detail_dir . DIRECTORY_SEPARATOR . $f;
            $d = get_json_date($fp);

            if (preg_match('/(?:.*_)?detail_report_dirs?_([^\/\\\\]+)\.json$/', $f, $m)) {
                $user = $m[1];
                if (!isset($latest_dir_by_user[$user]) || $d > $latest_dir_by_user[$user]['date']) {
                    $latest_dir_by_user[$user] = array(
                        'date' => $d,
                        'path' => $fp,
                    );
                }
                continue;
            }

            if (preg_match('/(?:.*_)?detail_report_files?_([^\/\\\\]+)\.json$/', $f, $m)) {
                $user = $m[1];
                if (!isset($latest_file_by_user[$user]) || $d > $latest_file_by_user[$user]['date']) {
                    $latest_file_by_user[$user] = array(
                        'date' => $d,
                        'path' => $fp,
                    );
                }
            }
        }
        if ($dh) closedir($dh);

        foreach ($latest_dir_by_user as $info) {
            $total_dirs += api_meta_read_total_dirs($info['path']);
        }
        foreach ($latest_file_by_user as $info) {
            $total_files += api_meta_read_total_files($info['path']);
        }
    }

    b64_success(array(
        'latest_date' => $latest_date,
        'total_files' => $total_files,
        'report_files_count' => count($files),
        'total_dirs'  => $total_dirs,
    ));
}
