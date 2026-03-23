<?php
// permission_api.php — Permission issues for a disk directory
// Usage: ?dir=mock_reports/disk_sda
//
// Response: base64_encode(json) — WAF-safe, decode with atob() in JS
// Returns ALL items at once (flat format). Supports legacy nested format.

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
    echo "Not found.";
    exit;
}

// Find most recent permission_issues_*.json
$dh        = @opendir($rawPath);
$permFiles = [];
while ($dh && ($f = readdir($dh)) !== false) {
    if (strpos($f, 'permission_issues') !== false && substr($f, -5) === '.json') {
        $fp = $rawPath . DIRECTORY_SEPARATOR . $f;
        $permFiles[$fp] = @filemtime($fp);
    }
}
if ($dh) closedir($dh);
arsort($permFiles);
$latestPath = !empty($permFiles) ? key($permFiles) : null;

$data = null;
if ($latestPath) {
    $content = file_get_contents($latestPath);
    if ($content !== false) {
        $raw    = json_decode($content, true);
        $issues = $raw['permission_issues'] ?? [];
        if (isset($issues['items'])) {
            $allItems = $issues['items'];
        } else {
            $allItems = [];
            foreach ($issues['users'] ?? [] as $u) {
                foreach ($u['inaccessible_items'] ?? [] as $item) {
                    $allItems[] = ['user' => $u['name'] ?? '', 'path' => $item['path'] ?? '', 'type' => $item['type'] ?? '', 'error' => $item['error'] ?? ''];
                }
            }
            foreach ($issues['unknown_items'] ?? [] as $item) {
                $allItems[] = ['user' => '__unknown__', 'path' => $item['path'] ?? '', 'type' => $item['type'] ?? '', 'error' => $item['error'] ?? ''];
            }
        }
        $data = ['date' => $raw['date'] ?? null, 'directory' => $raw['directory'] ?? null, 'total' => count($allItems), 'items' => $allItems];
    }
}

header('Content-Type: text/plain; charset=utf-8');
echo base64_encode(json_encode(['status' => 'success', 'data' => $data]));
