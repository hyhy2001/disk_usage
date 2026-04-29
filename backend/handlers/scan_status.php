<?php

function api_handle_scan_status($disk_path) {
    $status_file = $disk_path . DIRECTORY_SEPARATOR . 'scan_status.json';

    if (!is_file($status_file)) {
        b64_success(array(
            'running'     => false,
            'stage'       => 'done',
            'started_at'  => 0,
            'updated_at'  => 0,
            'finished_at' => 0,
            'pid'         => 0,
            'host'        => '',
            'message'     => '',
            'error'       => '',
        ));
    }

    $raw = @file_get_contents($status_file);
    if ($raw === false) {
        b64_success(array('running' => false, 'stage' => 'done', 'error' => 'unreadable'));
    }

    $status = @json_decode($raw, true);
    if (!is_array($status)) {
        b64_success(array('running' => false, 'stage' => 'done', 'error' => 'parse_error'));
    }

    // If marked running but PID no longer alive, treat as stale
    if (!empty($status['running']) && !empty($status['pid'])) {
        $pid = (int)$status['pid'];
        // Check via /proc (Linux only; fail safe on other systems)
        if ($pid > 0 && !@file_exists('/proc/' . $pid)) {
            $status['running']     = false;
            $status['stage']       = 'done';
            $status['message']     = 'Stale: process no longer running';
            $status['finished_at'] = isset($status['updated_at']) ? $status['updated_at'] : 0;
        }
    }

    b64_success(array(
        'running'     => !empty($status['running']),
        'stage'       => isset($status['stage'])       ? (string)$status['stage']       : 'done',
        'started_at'  => isset($status['started_at'])  ? (int)$status['started_at']     : 0,
        'updated_at'  => isset($status['updated_at'])  ? (int)$status['updated_at']     : 0,
        'finished_at' => isset($status['finished_at']) ? (int)$status['finished_at']    : 0,
        'pid'         => isset($status['pid'])         ? (int)$status['pid']            : 0,
        'host'        => isset($status['host'])        ? (string)$status['host']        : '',
        'message'     => isset($status['message'])     ? (string)$status['message']     : '',
        'error'       => isset($status['error'])       ? (string)$status['error']       : '',
    ));
}
