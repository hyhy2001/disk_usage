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

// Find most recent permission_issues_*.json
$dh = @opendir($rawPath);
$permFiles = [];
while ($dh && ($f = readdir($dh)) !== false) {
    if (strpos($f, 'permission_issues') === 0 && substr($f, -5) === '.json')
        $permFiles[] = $f;
}
if ($dh) closedir($dh);
sort($permFiles);
$latest = !empty($permFiles) ? end($permFiles) : null;

$data = null;
if ($latest) {
    $content = file_get_contents($rawPath . DIRECTORY_SEPARATOR . $latest);
    if ($content !== false) $data = json_decode($content, true);
}

header('Content-Type: text/plain; charset=utf-8');
echo json_encode(['status' => 'success', 'data' => $data]);
