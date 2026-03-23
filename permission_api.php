<?php
// permission_api.php — Return all permission issues for a disk directory
// Usage: ?dir=mock_reports/disk_sda
//
// Returns all items at once (no server-side pagination/filter).
// Pagination and user-filtering are done client-side in JavaScript.
// Keeping this simple (like api.php) avoids WAF 403 on production servers.

$baseDir = __DIR__;
$reqDir  = isset($_GET['dir']) ? trim($_GET['dir'], '/\\') : '';

header('Content-Type: application/json; charset=utf-8');

if ($reqDir === '' || strpos($reqDir, '..') !== false) {
    http_response_code(403);
    echo json_encode(['status' => 'error', 'message' => 'Access denied']);
    exit;
}

$rawPath = $baseDir . DIRECTORY_SEPARATOR . $reqDir;

if (!is_dir($rawPath) && !is_link($rawPath)) {
    http_response_code(404);
    echo json_encode(['status' => 'error', 'message' => 'Directory not found']);
    exit;
}

// ── Find most recent permission_issues_*.json ─────────────────────────────────
$dh        = @opendir($rawPath);
$permFiles = [];
while ($dh && ($f = readdir($dh)) !== false) {
    if (strpos($f, 'permission_issues') !== false && substr($f, -5) === '.json') {
        $full = $rawPath . DIRECTORY_SEPARATOR . $f;
        $permFiles[$full] = @filemtime($full);
    }
}
if ($dh) closedir($dh);

arsort($permFiles);
$latestPath = !empty($permFiles) ? key($permFiles) : null;

if (!$latestPath) {
    echo json_encode(['status' => 'success', 'data' => null]);
    exit;
}

$content = file_get_contents($latestPath);
if ($content === false) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Cannot read permission file']);
    exit;
}

$data = json_decode($content, true);
if ($data === null) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Invalid JSON']);
    exit;
}

// ── Normalize: support both flat (new) and nested (legacy) formats ────────────
$issues = $data['permission_issues'] ?? [];

if (isset($issues['items'])) {
    $allItems = $issues['items'];
} else {
    // Legacy nested format — flatten on the fly
    $allItems = [];
    foreach ($issues['users'] ?? [] as $u) {
        foreach ($u['inaccessible_items'] ?? [] as $item) {
            $allItems[] = [
                'user'  => $u['name'] ?? '',
                'path'  => $item['path']  ?? '',
                'type'  => $item['type']  ?? '',
                'error' => $item['error'] ?? '',
            ];
        }
    }
    foreach ($issues['unknown_items'] ?? [] as $item) {
        $allItems[] = [
            'user'  => '__unknown__',
            'path'  => $item['path']  ?? '',
            'type'  => $item['type']  ?? '',
            'error' => $item['error'] ?? '',
        ];
    }
}

echo json_encode([
    'status' => 'success',
    'data'   => [
        'date'      => $data['date']      ?? null,
        'directory' => $data['directory'] ?? null,
        'total'     => count($allItems),
        'items'     => $allItems,
    ],
]);
