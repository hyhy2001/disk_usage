<?php

function get_json_date($fp) {
    if ($fh = @fopen($fp, 'r')) {
        $header = fread($fh, 8192);
        fclose($fh);
        if (preg_match('/"date"\s*:\s*(\d+)/', $header, $m)) {
            return (int)$m[1];
        }
    }

    return @filemtime($fp);
}

function api_load_disks_config($root_dir) {
    $disks_file = $root_dir . DIRECTORY_SEPARATOR . DU_DISKS_CONFIG_FILENAME;
    return api_load_json_file($disks_file, array());
}

function api_load_json_file($path, $default = null) {
    if (!is_file($path)) return $default;
    $raw = @file_get_contents($path);
    if ($raw === false) return $default;
    $decoded = @json_decode($raw, true);
    return is_array($decoded) ? $decoded : $default;
}

function api_resolve_disk_entry_by_id($disks, $req_id) {
    $disk_entry = null;
    api_iterate_disks($disks, function($d, $ctx) use ($req_id, &$disk_entry) {
        if (!isset($d['id']) || $d['id'] !== $req_id) return;
        $disk_entry = $d;
        $disk_entry['project'] = $ctx['project'];
        $disk_entry['team']    = $ctx['team'];
        return false; // stop iteration
    });
    return $disk_entry;
}

function find_file_by_pattern($dir, $pattern) {
    if (!is_dir($dir)) return false;
    $dh = @opendir($dir);
    $found = false;
    $max_date = -1;
    while ($dh && ($f = readdir($dh)) !== false) {
        if (preg_match($pattern, $f)) {
            $fp = $dir . DIRECTORY_SEPARATOR . $f;
            $d = get_json_date($fp);
            if ($d > $max_date) {
                $max_date = $d;
                $found = $fp;
            }
        }
    }
    if ($dh) closedir($dh);
    return $found;
}

function api_is_main_report_json_filename($filename) {
    if (substr($filename, -5) !== '.json') return false;
    $fl = strtolower($filename);
    if (strpos($fl, DU_PERMISSION_REPORT_TAG) !== false) return false;
    if (strpos($fl, DU_DETAIL_REPORT_TAG) !== false) return false;
    if (strpos($fl, DU_INODE_REPORT_TAG) !== false) return false;

    return strpos($fl, DU_MAIN_REPORT_TAG) !== false
        || strpos($filename, 'report_') === 0
        || preg_match('/^report[_-]/i', $filename);
}

function api_collect_main_report_files($disk_path) {
    $dh = @opendir($disk_path);
    $files = array();
    while ($dh && ($f = readdir($dh)) !== false) {
        if (api_is_main_report_json_filename($f)) {
            $files[] = $disk_path . DIRECTORY_SEPARATOR . $f;
        }
    }
    if ($dh) closedir($dh);
    return $files;
}

function api_get_latest_main_report_info($disk_path) {
    $dh = @opendir($disk_path);
    $count = 0;
    $latest_file = false;
    $latest_date = -1;

    // "Latest" is decided by the embedded report "date" (via get_json_date),
    // NOT filesystem mtime — this matches how aggregate.php sorts reports, so
    // meta/users and the aggregate timeline always agree on which report is
    // newest. (mtime could disagree, e.g. an older report copied in later.)
    while ($dh && ($f = readdir($dh)) !== false) {
        if (!api_is_main_report_json_filename($f)) continue;
        $count++;
        $fp = $disk_path . DIRECTORY_SEPARATOR . $f;
        $d = (int)get_json_date($fp);
        if (!$latest_file || $d > $latest_date) {
            $latest_file = $fp;
            $latest_date = $d;
        }
    }
    if ($dh) closedir($dh);

    if ($latest_date < 0) $latest_date = 0;

    return array(
        'report_files_count' => $count,
        'latest_file' => $latest_file,
        'latest_date' => $latest_date,
    );
}
