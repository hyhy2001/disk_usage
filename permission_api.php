<?php
// permission_api.php — Return latest permission_issues_*.json for a disk directory
// Usage: ?dir=mock_reports/disk_sda
//
// Simple API: only one parameter (?dir), no pagination/filter params.
// Returns ALL items at once. JS handles client-side pagination and filtering.
// Supports both flat format (new) and nested format (legacy) — normalised to flat.

$baseDir = __DIR__;
$reqDir  = isset($_GET['dir']) ? trim($_GET['dir'], '/\\') : '';

// Block traversal
if (strpos($reqDir, '..') !== false || $reqDir === '') {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['status' => 'error', 'message' => 'Access denied']);
    exit;
}

$rawPath = $baseDir . DIRECTORY_SEPARATOR . $reqDir;

if (!is_dir($rawPath) && !is_link($rawPath)) {
    http_response_code(404);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['status' => 'error', 'message' => 'Directory not found']);
    exit;
}

// Find most recent permission_issues_*.json (by file modification time)
$dh        = @opendir($rawPath);
$permFiles = [];
while ($dh && ($f = readdir($dh)) !== false) {
    if (strpos($f, 'permission_issues') !== false && substr($f, -5) === '.json') {
        $fullPath = $rawPath . DIRECTORY_SEPARATOR . $f;
        $permFiles[$fullPath] = @filemtime($fullPath);
    }
}
if ($dh) closedir($dh);

arsort($permFiles);
$latestPath = !empty($permFiles) ? key($permFiles) : null;

header('Content-Type: application/json; charset=utf-8');

if (!$latestPath) {
    echo json_encode(['status' => 'success', 'data' => null]);
    exit;
}

$content = file_get_contents($latestPath);
if ($content === false) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Cannot read file']);
    exit;
}

$raw = json_decode($content, true);
if ($raw === null) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Invalid JSON']);
    exit;
}

// Normalise to flat format — supports both new flat and old nested formats
$issues = $raw['permission_issues'] ?? [];

if (isset($issues['items'])) {
    // New flat format: {total, items:[{user,path,type,error}]}
    $allItems = $issues['items'];
} else {
    // Legacy nested format: {users:[{name,inaccessible_items:[]}], unknown_items:[]}
    $allItems = [];
    foreach ($issues['users'] ?? [] as $u) {
        foreach ($u['inaccessible_items'] ?? [] as $item) {
            $allItems[] = [
                'user'  => $u['name']    ?? '',
                'path'  => $item['path'] ?? '',
                'type'  => $item['type'] ?? '',
                'error' => $item['error'] ?? '',
            ];
        }
    }
    foreach ($issues['unknown_items'] ?? [] as $item) {
        $allItems[] = [
            'user'  => '__unknown__',
            'path'  => $item['path'] ?? '',
            'type'  => $item['type'] ?? '',
            'error' => $item['error'] ?? '',
        ];
    }
}

echo json_encode([
    'status' => 'success',
    'data'   => [
        'date'      => $raw['date']      ?? null,
        'directory' => $raw['directory'] ?? null,
        'total'     => count($allItems),
        'items'     => $allItems,
    ],
]);
