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
    $disks_file = $root_dir . DIRECTORY_SEPARATOR . 'disks.json';
    $disks_raw  = @file_get_contents($disks_file);
    return ($disks_raw !== false) ? json_decode($disks_raw, true) : array();
}

function api_resolve_disk_entry_by_id($disks, $req_id) {
    $disk_entry = null;
    if (is_array($disks)) {
        foreach ($disks as $p_or_d) {
            if (isset($p_or_d['id']) && $p_or_d['id'] === $req_id) {
                $disk_entry = $p_or_d;
                break;
            }
            if (isset($p_or_d['teams']) && is_array($p_or_d['teams'])) {
                foreach ($p_or_d['teams'] as $t) {
                    if (isset($t['disks']) && is_array($t['disks'])) {
                        foreach ($t['disks'] as $d) {
                            if (isset($d['id']) && $d['id'] === $req_id) {
                                $d['project'] = isset($p_or_d['project']) ? $p_or_d['project'] : '';
                                $d['team']    = isset($t['name']) ? $t['name'] : '';
                                $disk_entry   = $d;
                                break 3;
                            }
                        }
                    }
                }
            }
            if (isset($p_or_d['disks']) && is_array($p_or_d['disks'])) {
                foreach ($p_or_d['disks'] as $d) {
                    if (isset($d['id']) && $d['id'] === $req_id) {
                        $d['project'] = '';
                        $d['team']    = isset($p_or_d['name']) ? $p_or_d['name'] : '';
                        $disk_entry   = $d;
                        break 2;
                    }
                }
            }
        }
    }
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
    if (strpos($fl, 'permission_issue') !== false) return false;
    if (strpos($fl, 'detail_report') !== false) return false;
    if (strpos($fl, 'inode_usage') !== false) return false;

    return strpos($fl, 'disk_usage_report') !== false
        || strpos($fl, 'usage_report') !== false
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
    $latest_mtime = -1;

    while ($dh && ($f = readdir($dh)) !== false) {
        if (!api_is_main_report_json_filename($f)) continue;
        $count++;
        $fp = $disk_path . DIRECTORY_SEPARATOR . $f;
        $mt = @filemtime($fp);
        if (!is_int($mt)) $mt = 0;
        if (!$latest_file || $mt > $latest_mtime) {
            $latest_file = $fp;
            $latest_mtime = $mt;
        }
    }
    if ($dh) closedir($dh);

    $latest_date = 0;
    if ($latest_file && is_file($latest_file)) {
        $latest_date = (int)get_json_date($latest_file);
    }

    return array(
        'report_files_count' => $count,
        'latest_file' => $latest_file,
        'latest_date' => $latest_date,
    );
}
