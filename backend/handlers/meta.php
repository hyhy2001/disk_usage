<?php

function api_meta_read_detail_total($report_file, $total_key) {
    if (preg_match('/\.ndjson$/i', $report_file)) {
        $fh = @fopen($report_file, 'r');
        if (!$fh) return 0;

        $scanned = 0;
        $max_scan_lines = 20;
        while (($ln = fgets($fh)) !== false && $scanned < $max_scan_lines) {
            $scanned++;
            $ln = trim($ln);
            if ($ln === '') continue;

            $obj = @json_decode($ln, true);
            if (!is_array($obj)) continue;

            $meta = null;
            if (isset($obj['_meta']) && is_array($obj['_meta'])) $meta = $obj['_meta'];
            elseif (isset($obj['meta']) && is_array($obj['meta'])) $meta = $obj['meta'];
            elseif (isset($obj['type']) && $obj['type'] === 'meta') $meta = $obj;

            if (is_array($meta) && isset($meta[$total_key])) {
                fclose($fh);
                return (int)$meta[$total_key];
            }
        }
        fclose($fh);
        return 0;
    }

    $fh = @fopen($report_file, 'r');
    if (!$fh) return 0;

    $total = 0;
    while (($ln = fgets($fh)) !== false) {
        if (preg_match('/"' . preg_quote($total_key, '/') . '"\s*:\s*(\d+)/', $ln, $m)) {
            $total = (int)$m[1];
            break;
        }
        if (strpos($ln, '"dirs"') !== false && strpos($ln, '[') !== false) {
            break;
        }
        if (strpos($ln, '"files"') !== false && strpos($ln, '[') !== false) {
            break;
        }
    }
    fclose($fh);

    return $total;
}

function api_handle_meta($disk_path) {
    $disk_mtime = @filemtime($disk_path);
    $detail_dir = $disk_path . DIRECTORY_SEPARATOR . 'detail_users';
    $detail_mtime = @filemtime($detail_dir);
    $cache_key = 'meta:' . $disk_path . ':' . (is_int($disk_mtime) ? $disk_mtime : 0) . ':' . (is_int($detail_mtime) ? $detail_mtime : 0);
    $cached = api_cache_get($cache_key, 6);
    if (is_array($cached)
        && isset($cached['latest_date'])
        && isset($cached['total_files'])
        && isset($cached['report_files_count'])
        && isset($cached['total_dirs'])) {
        b64_success($cached);
    }

    $files = api_collect_main_report_files($disk_path);
    $latest_date = 0;
    foreach ($files as $f) {
        $d = get_json_date($f);
        if ($d > $latest_date) $latest_date = $d;
    }

    $total_files = 0;
    $total_dirs = 0;
    if (is_dir($detail_dir)) {
        $latest_dir_by_user = array();
        $latest_file_by_user = array();
        $dh = @opendir($detail_dir);
        while ($dh && ($f = readdir($dh)) !== false) {
            $fp = $detail_dir . DIRECTORY_SEPARATOR . $f;
            $d = get_json_date($fp);

            if (preg_match('/(?:.*_)?detail_report_dirs?_([^\/\\\\]+)\.(?:json|ndjson)$/i', $f, $m)) {
                $user = $m[1];
                if (!isset($latest_dir_by_user[$user]) || $d > $latest_dir_by_user[$user]['date']) {
                    $latest_dir_by_user[$user] = array(
                        'date' => $d,
                        'path' => $fp,
                    );
                }
                continue;
            }

            if (preg_match('/(?:.*_)?detail_report_files?_([^\/\\\\]+)\.(?:json|ndjson)$/i', $f, $m)) {
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
            $total_dirs += api_meta_read_detail_total($info['path'], 'total_dirs');
        }
        foreach ($latest_file_by_user as $info) {
            $total_files += api_meta_read_detail_total($info['path'], 'total_files');
        }
    }

    $data = array(
        'latest_date' => $latest_date,
        'total_files' => $total_files,
        'report_files_count' => count($files),
        'total_dirs'  => $total_dirs,
    );
    api_cache_set($cache_key, $data);
    b64_success($data);
}
