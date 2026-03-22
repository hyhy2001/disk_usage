<?php
// user_detail_api.php — Return per-user detail reports from detail_users/ sub-folder
// Follows the same security pattern as api.php and permission_api.php
//
// Usage:
//   ?dir=mock_reports/disk_sda                              → list users
//   ?dir=mock_reports/disk_sda&user=user1&type=dir          → dir report
//   ?dir=mock_reports/disk_sda&user=user1&type=file         → file report
//   ?dir=mock_reports/disk_sda&user=user1&type=both         → dir + file

$baseDir = __DIR__;
$reqDir  = isset($_GET['dir']) ? trim($_GET['dir'], '/\\') : '';

// Block traversal (same as api.php)
if (strpos($reqDir, '..') !== false || $reqDir === '') {
    http_response_code(403);
    echo 'Access denied.';
    exit;
}

$rawPath    = $baseDir . DIRECTORY_SEPARATOR . $reqDir;
$detailPath = $rawPath . DIRECTORY_SEPARATOR . 'detail_users';

if (!is_dir($rawPath) && !is_link($rawPath)) {
    http_response_code(404);
    echo json_encode(['status' => 'error', 'message' => "Directory not found: $reqDir"]);
    exit;
}

// Sanitise user param: only alphanumeric, dash, underscore
$user = isset($_GET['user']) ? preg_replace('/[^a-zA-Z0-9_\-]/', '', $_GET['user']) : '';
$type = isset($_GET['type']) ? $_GET['type'] : '';

header('Content-Type: text/plain; charset=utf-8');

// ── Mode A: list users ────────────────────────────────────────────────────────
if ($user === '') {
    if (!is_dir($detailPath)) {
        echo json_encode(['status' => 'success', 'data' => ['users' => []]]);
        exit;
    }
    $dh    = @opendir($detailPath);
    $users = [];
    while ($dh && ($f = readdir($dh)) !== false) {
        // Match files like detail_report_dir_{user}.json
        if (preg_match('/^detail_report_dir_(.+)\.json$/', $f, $m)) {
            $users[] = $m[1];
        }
    }
    if ($dh) closedir($dh);
    sort($users);
    echo json_encode(['status' => 'success', 'data' => ['users' => $users]]);
    exit;
}

// ── Mode B: get detail for user ───────────────────────────────────────────────
if (!in_array($type, ['dir', 'file', 'both'], true)) {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => "Invalid type. Use: dir, file, or both"]);
    exit;
}

if (!is_dir($detailPath)) {
    http_response_code(404);
    echo json_encode(['status' => 'error', 'message' => 'detail_users/ not found for this disk']);
    exit;
}

function readDetailFile($detailPath, $reportType, $user) {
    $file = $detailPath . DIRECTORY_SEPARATOR . "detail_report_{$reportType}_{$user}.json";
    if (!is_file($file)) return null;
    $content = file_get_contents($file);
    return $content !== false ? json_decode($content, true) : null;
}

$data = [];
if ($type === 'dir' || $type === 'both') {
    $d = readDetailFile($detailPath, 'dir', $user);
    if ($d === null) {
        http_response_code(404);
        echo json_encode(['status' => 'error', 'message' => "No dir report for user: $user"]);
        exit;
    }
    $data['dir'] = $d;
}
if ($type === 'file' || $type === 'both') {
    $d = readDetailFile($detailPath, 'file', $user);
    if ($d === null) {
        http_response_code(404);
        echo json_encode(['status' => 'error', 'message' => "No file report for user: $user"]);
        exit;
    }
    $data['file'] = $d;
}

echo json_encode(['status' => 'success', 'data' => $data]);
