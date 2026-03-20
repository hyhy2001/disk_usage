<?php
// api.php — Read & aggregate .json report files from a directory
// Usage: ?dir=reports/disk_sda  |  ?dir=reports/disk_sda&type=permissions

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

header('Content-Type: application/json; charset=utf-8');

// ── Permissions endpoint ──────────────────────────────────────────────────────
if (($_GET['type'] ?? '') === 'permissions') {
    // Find the most recently named permission_issues_*.json file
    $dh = @opendir($rawPath);
    $permFiles = [];
    while ($dh && ($f = readdir($dh)) !== false) {
        if (strpos($f, 'permission_issues') === 0 && substr($f, -5) === '.json')
            $permFiles[] = $f;
    }
    if ($dh) closedir($dh);
    sort($permFiles);  // alphabetical → latest is last
    $latest = !empty($permFiles) ? end($permFiles) : null;

    if ($latest) {
        $content = file_get_contents($rawPath . DIRECTORY_SEPARATOR . $latest);
        $data    = $content !== false ? json_decode($content, true) : null;
        echo json_encode(['status' => 'success', 'data' => $data]);
    } else {
        echo json_encode(['status' => 'success', 'data' => null]);
    }
    exit;
}

// ── Regular reports endpoint ──────────────────────────────────────────────────

// List .json files (exclude permission_issues)
$dh = @opendir($rawPath);
$files = [];
while ($dh && ($f = readdir($dh)) !== false) {
    if (substr($f, -5) === '.json' && strpos($f, 'permission_issues') === false)
        $files[] = $rawPath . DIRECTORY_SEPARATOR . $f;
}
if ($dh) closedir($dh);
sort($files);

// Read & aggregate
$aggregated = [];
foreach ($files as $file) {
    $content = file_get_contents($file);
    if ($content === false) continue;
    $json = json_decode($content, true);
    if ($json !== null) $aggregated[] = $json;
}

echo json_encode([
    'status'      => 'success',
    'total_files' => count($aggregated),
    'data'        => $aggregated,
]);
