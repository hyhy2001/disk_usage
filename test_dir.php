<?php
// test_dir.php — List .json files (supports symlinks). DELETE after testing!
// Usage: ?dir=reports/disk_sda

$baseDir = __DIR__;
$reqDir  = isset($_GET['dir']) ? trim($_GET['dir'], '/\\') : 'mock_reports/disk_sda';

// Build the raw path (don't use realpath — it breaks symlinks outside webroot)
$rawPath = $baseDir . DIRECTORY_SEPARATOR . $reqDir;

// Only block obvious traversal attempts (..)
if (strpos($reqDir, '..') !== false) {
    http_response_code(403);
    echo "Access denied.";
    exit;
}

// Allow both real dirs and symlinks pointing to dirs
if (!is_dir($rawPath) && !is_link($rawPath)) {
    http_response_code(404);
    echo "Directory not found: $reqDir";
    exit;
}

$dh = @opendir($rawPath);
$files = [];
while ($dh && ($f = readdir($dh)) !== false) {
    if (substr($f, -5) === '.json') $files[] = $f;
}
if ($dh) closedir($dh);
sort($files);

echo implode("\n", $files);
