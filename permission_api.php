<?php
// permission_api.php — Return latest permission_issues_*.json for a disk directory
// Usage: ?dir=mock_reports/disk_sda

$baseDir = __DIR__;
$reqDir  = isset($_GET['dir']) ? trim($_GET['dir'], '/\\') : '';

// Block traversal
if (strpos($reqDir, '..') !== false || $reqDir === '') {
    http_response_code(403);
    echo "Access denied.";
    exit;
}

$rawPath = $baseDir . DIRECTORY_SEPARATOR . $reqDir;

if (!is_dir($rawPath) && !is_link($rawPath)) {
    http_response_code(404);
    echo "Directory not found: $reqDir";
    exit;
}

// Find most recent permission_issues_*.json (by file modification time)
$dh        = @opendir($rawPath);
$permFiles = [];
while ($dh && ($f = readdir($dh)) !== false) {
    if (strpos($f, 'permission_issues') !== false && substr($f, -5) === '.json') {
        $fullPath           = $rawPath . DIRECTORY_SEPARATOR . $f;
        $permFiles[$fullPath] = @filemtime($fullPath);
    }
}
if ($dh) closedir($dh);

arsort($permFiles);
$latestPath = !empty($permFiles) ? key($permFiles) : null;

$data = null;
if ($latestPath) {
    $content = file_get_contents($latestPath);
    if ($content !== false) $data = json_decode($content, true);
}

// Normalise to flat format — supports both new flat and old nested formats
if ($data !== null) {
    $issues = $data['permission_issues'] ?? [];

    if (isset($issues['items'])) {
        // New flat format: keep as-is
        $allItems = $issues['items'];
    } else {
        // Legacy nested format — flatten on the fly
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

    $data = [
        'date'      => $data['date']      ?? null,
        'directory' => $data['directory'] ?? null,
        'total'     => count($allItems),
        'items'     => $allItems,
    ];
}

header('Content-Type: text/plain; charset=utf-8');
echo json_encode(['status' => 'success', 'data' => $data]);
