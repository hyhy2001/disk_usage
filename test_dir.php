<?php
// test_dir.php — Step 2: List .json + read & aggregate them like api.php
// Usage: ?dir=reports/disk_sda
// DELETE after testing!

$baseDir = __DIR__;
$reqDir  = isset($_GET['dir']) ? trim($_GET['dir'], '/\\') : 'mock_reports/disk_sda';

// Block traversal
if (strpos($reqDir, '..') !== false) {
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

// List .json files
$dh = @opendir($rawPath);
$files = [];
while ($dh && ($f = readdir($dh)) !== false) {
    if (substr($f, -5) === '.json') $files[] = $rawPath . DIRECTORY_SEPARATOR . $f;
}
if ($dh) closedir($dh);
sort($files);

// Read & aggregate each JSON file (same as api.php)
$aggregated = [];
$errors     = [];

foreach ($files as $file) {
    $content = file_get_contents($file);
    if ($content === false) {
        $errors[] = basename($file) . ': read failed';
        continue;
    }
    $json = json_decode($content, true);
    if ($json === null) {
        $errors[] = basename($file) . ': json_decode failed';
        continue;
    }
    $aggregated[] = $json;
}

header('Content-Type: text/plain; charset=utf-8');
echo json_encode([
    'status'      => 'success',
    'total_files' => count($aggregated),
    'errors'      => $errors,
    'data'        => $aggregated,
]);
