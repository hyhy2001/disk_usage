<?php
// test_dir.php — List subfolders and JSON files in webroot, returns JSON
// Usage: test_dir.php?dir=reports/disk_sda
// If no ?dir param, lists top-level folders in webroot

header('Content-Type: text/plain; charset=utf-8');

$baseDir = __DIR__;
$reqDir  = isset($_GET['dir']) ? trim($_GET['dir'], '/\\') : '';

// Resolve target directory (must stay within webroot)
if ($reqDir !== '') {
    $target = realpath($baseDir . DIRECTORY_SEPARATOR . $reqDir);
    // Prevent directory traversal
    if ($target === false || strpos($target, $baseDir) !== 0) {
        http_response_code(403);
        echo json_encode(['error' => 'Access denied.']);
        exit;
    }
} else {
    $target = $baseDir;
}

if (!is_dir($target)) {
    http_response_code(404);
    echo json_encode(['error' => 'Directory not found: ' . $reqDir]);
    exit;
}

// List contents
$dh = @opendir($target);
if ($dh === false) {
    http_response_code(500);
    echo json_encode(['error' => 'Cannot open directory.']);
    exit;
}

$folders = [];
$files   = [];

while (($entry = readdir($dh)) !== false) {
    if ($entry === '.' || $entry === '..') continue;
    $full = $target . DIRECTORY_SEPARATOR . $entry;
    if (is_dir($full)) {
        $folders[] = $entry;
    } else {
        $files[] = [
            'name' => $entry,
            'size' => filesize($full),
        ];
    }
}
closedir($dh);

sort($folders);
usort($files, fn($a, $b) => strcmp($a['name'], $b['name']));

echo json_encode([
    'dir'     => $reqDir ?: '(webroot)',
    'path'    => $target,
    'folders' => $folders,
    'files'   => $files,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
