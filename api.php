<?php
// api.php — Read & aggregate .json files from a directory
// Usage: ?dir=reports/disk_sda  (relative to webroot)
// Returns all .json files (except permission_issues) as aggregated array

$baseDir = __DIR__;
$reqDir  = $_GET['dir'] ?? '';
$type    = $_GET['type'] ?? 'reports'; // 'reports' or 'permissions'

// Block traversal
if (strpos($reqDir, '..') !== false || $reqDir === '') {
    echo json_encode(['status' => 'error', 'message' => 'Invalid dir']);
    exit;
}

$rawPath = $baseDir . '/' . ltrim($reqDir, '/');

if (!is_dir($rawPath) && !is_link($rawPath)) {
    echo json_encode(['status' => 'error', 'message' => "Not found: $reqDir"]);
    exit;
}

$dh = @opendir($rawPath);
$data = [];
while ($dh && ($f = readdir($dh)) !== false) {
    if (substr($f, -5) !== '.json') continue;
    $isPermission = strpos($f, 'permission_issues') !== false;
    if ($type === 'permissions' && !$isPermission) continue;
    if ($type === 'reports' && $isPermission) continue;
    $j = json_decode(@file_get_contents($rawPath . '/' . $f), true);
    if ($j !== null) $data[] = $j;
}
if ($dh) closedir($dh);

echo json_encode(['status' => 'success', 'total_files' => count($data), 'data' => $data]);
