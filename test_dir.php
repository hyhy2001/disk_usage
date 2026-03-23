<?php
// test_dir.php — Combined API test file
// Consolidates api.php + permission_api.php + user_detail_api.php into one endpoint.
//
// Usage:
//   ?action=main&dir=...                              → same as api.php
//   ?action=perm&dir=...                              → same as permission_api.php
//   ?action=detail&dir=...                            → list users (user_detail_api.php)
//   ?action=detail&dir=...&u=user1&t=dir              → dir report
//   ?action=detail&dir=...&u=user1&t=file&p=0&n=500  → file report paginated

$baseDir = __DIR__;
$reqDir  = isset($_GET['dir']) ? trim($_GET['dir'], '/\\') : '';
$action  = $_GET['action'] ?? 'main';

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

header('Content-Type: text/plain; charset=utf-8');

// ─────────────────────────────────────────────────────────────────────────────
// ACTION: perm — same as permission_api.php
// ─────────────────────────────────────────────────────────────────────────────
if ($action === 'perm') {
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
    echo json_encode(['status' => 'success', 'data' => $data]);
    exit;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION: detail — same as user_detail_api.php
// ─────────────────────────────────────────────────────────────────────────────
if ($action === 'detail') {
    $detailPath = $rawPath . DIRECTORY_SEPARATOR . 'detail_users';
    $who    = isset($_GET['u']) ? preg_replace('/[^a-zA-Z0-9_\-]/', '', $_GET['u']) : '';
    $kind   = $_GET['t'] ?? '';
    $offset = max(0,    (int)($_GET['p'] ?? 0));
    $limit  = min(2000, max(1, (int)($_GET['n'] ?? 500)));

    if ($who === '') {
        $users = [];
        if (is_dir($detailPath)) {
            $dh = @opendir($detailPath);
            while ($dh && ($f = readdir($dh)) !== false) {
                if (preg_match('/^detail_report_dir_(.+)\.json$/', $f, $m)) $users[] = $m[1];
            }
            if ($dh) closedir($dh);
            sort($users);
        }
        echo json_encode(['status' => 'success', 'data' => ['users' => $users]]);
        exit;
    }

    if (!in_array($kind, ['dir', 'file', 'both'], true)) {
        http_response_code(400);
        echo json_encode(['status' => 'error', 'message' => 'Invalid t. Use: dir, file, both']);
        exit;
    }

    $data = [];

    if ($kind === 'dir' || $kind === 'both') {
        $file = $detailPath . DIRECTORY_SEPARATOR . "detail_report_dir_{$who}.json";
        if (!is_file($file)) { http_response_code(404); echo json_encode(['status' => 'error', 'message' => "No dir report for: $who"]); exit; }
        $c = file_get_contents($file);
        $data['dir'] = $c !== false ? json_decode($c, true) : null;
    }

    if ($kind === 'file' || $kind === 'both') {
        $file = $detailPath . DIRECTORY_SEPARATOR . "detail_report_file_{$who}.json";
        if (!is_file($file)) { http_response_code(404); echo json_encode(['status' => 'error', 'message' => "No file report for: $who"]); exit; }
        $fh = @fopen($file, 'r');
        $date = 0; $userName = $who; $totalFiles = 0; $totalUsed = 0;
        while ($fh && ($line = fgets($fh)) !== false) {
            if      (preg_match('/"date"\s*:\s*(\d+)/', $line, $m))          $date       = (int)$m[1];
            elseif  (preg_match('/"user"\s*:\s*"([^"]+)"/', $line, $m))      $userName   = $m[1];
            elseif  (preg_match('/"total_files"\s*:\s*(\d+)/', $line, $m))   $totalFiles = (int)$m[1];
            elseif  (preg_match('/"total_used"\s*:\s*(\d+)/', $line, $m))    $totalUsed  = (int)$m[1];
            if (strpos($line, '"files"') !== false && strpos($line, '[') !== false) break;
        }
        $idx = 0; $collected = []; $buf = ''; $depth = 0;
        while ($fh && ($line = fgets($fh)) !== false) {
            $t = trim($line);
            if ($t === ']' || $t === '];') break;
            if ($t === '' || $t === '[') continue;
            $buf .= $line; $depth += substr_count($line, '{') - substr_count($line, '}');
            if ($depth <= 0 && ltrim($buf) !== '') {
                $obj = @json_decode(rtrim(trim($buf), ','), true);
                if ($obj !== null && is_array($obj)) {
                    if ($idx >= $offset && count($collected) < $limit) $collected[] = $obj;
                    $idx++;
                    if (count($collected) >= $limit && $idx >= $offset + $limit) break;
                }
                $buf = ''; $depth = 0;
            }
        }
        if ($fh) fclose($fh);
        $data['file'] = ['date' => $date, 'user' => $userName, 'total_files' => $totalFiles, 'total_used' => $totalUsed, 'offset' => $offset, 'limit' => $limit, 'has_more' => count($collected) >= $limit, 'files' => $collected];
    }

    echo json_encode(['status' => 'success', 'data' => $data]);
    exit;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION: main — same as api.php
// ─────────────────────────────────────────────────────────────────────────────
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
    if ($json === null) continue;
    $aggregated[] = $json;
}

echo json_encode(['status' => 'success', 'data' => $aggregated]);
