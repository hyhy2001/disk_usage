<?php
// test_dir.php — List .json files in a directory (relative to webroot)
// Usage: ?dir=mock_reports/disk_sda

$baseDir = __DIR__;
$reqDir  = isset($_GET['dir']) ? trim($_GET['dir'], '/\\') : 'mock_reports/disk_sda';
$target  = realpath($baseDir . DIRECTORY_SEPARATOR . $reqDir);

if ($target === false || strpos($target, $baseDir) !== 0 || !is_dir($target)) {
    http_response_code(404);
    echo "Directory not found.";
    exit;
}

$dh = @opendir($target);
$files = [];
while ($dh && ($f = readdir($dh)) !== false) {
    if (substr($f, -5) === '.json') $files[] = $f;
}
if ($dh) closedir($dh);
sort($files);

echo implode("\n", $files);
