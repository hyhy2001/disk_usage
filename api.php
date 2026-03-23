<?php
// api.php — Main disk data
// Usage: ?dir=reports/disk_sda

$baseDir = __DIR__;
$reqDir  = isset($_GET['dir']) ? trim($_GET['dir'], '/\\') : '';

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

$dh    = @opendir($rawPath);
$files = [];
while ($dh && ($f = readdir($dh)) !== false) {
    if (substr($f, -5) === '.json' && strpos($f, 'permission_issues') === false)
        $files[] = $rawPath . DIRECTORY_SEPARATOR . $f;
}
if ($dh) closedir($dh);
sort($files);

$aggregated = [];
foreach ($files as $file) {
    $content = file_get_contents($file);
    if ($content === false) continue;
    $json = json_decode($content, true);
    if ($json !== null) $aggregated[] = $json;
}

header('Content-Type: text/plain; charset=utf-8');
echo json_encode([
    'status'      => 'success',
    'total_files' => count($aggregated),
    'data'        => $aggregated,
]);
