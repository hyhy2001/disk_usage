<?php
// user_detail_api.php — Per-user directory and file detail reports
// Usage:
//   ?dir=path                              → list users
//   ?dir=path&user=alice&type=dir          → dir report
//   ?dir=path&user=alice&type=file         → file report (paginated)
//   ?dir=path&user=alice&type=file&offset=500&limit=500
//   ?dir=path&user=alice&type=both         → dir + first file page
//
// Response: base64_encode(json) — WAF-safe, decode with atob() in JS

$baseDir = __DIR__;
$reqDir  = isset($_GET['dir']) ? trim($_GET['dir'], '/\\') : '';

if (strpos($reqDir, '..') !== false || $reqDir === '') {
    http_response_code(403);
    echo "Access denied.";
    exit;
}

$rawPath    = $baseDir . DIRECTORY_SEPARATOR . $reqDir;
$detailPath = $rawPath . DIRECTORY_SEPARATOR . 'detail_users';

if (!is_dir($rawPath) && !is_link($rawPath)) {
    http_response_code(404);
    echo "Not found.";
    exit;
}

$user   = isset($_GET['user'])   ? preg_replace('/[^a-zA-Z0-9_\-]/', '', $_GET['user']) : '';
$type   = $_GET['type']   ?? '';
$offset = max(0,    (int)($_GET['offset'] ?? 0));
$limit  = min(2000, max(1, (int)($_GET['limit'] ?? 500)));

header('Content-Type: text/plain; charset=utf-8');

// ── List users ────────────────────────────────────────────────────────────────
if ($user === '') {
    $users = [];
    if (is_dir($detailPath)) {
        $dh = @opendir($detailPath);
        while ($dh && ($f = readdir($dh)) !== false) {
            if (preg_match('/^detail_report_dir_(.+)\.json$/', $f, $m)) $users[] = $m[1];
        }
        if ($dh) closedir($dh);
        sort($users);
    }
    echo base64_encode(json_encode(['status' => 'success', 'data' => ['users' => $users]]));
    exit;
}

if (!in_array($type, ['dir', 'file', 'both'], true)) {
    http_response_code(400);
    echo base64_encode(json_encode(['status' => 'error', 'message' => 'Invalid type']));
    exit;
}
if (!is_dir($detailPath)) {
    http_response_code(404);
    echo base64_encode(json_encode(['status' => 'error', 'message' => 'No detail_users/']));
    exit;
}

$data = [];

// ── Dir report ────────────────────────────────────────────────────────────────
if ($type === 'dir' || $type === 'both') {
    $file = $detailPath . DIRECTORY_SEPARATOR . "detail_report_dir_{$user}.json";
    if (!is_file($file)) {
        http_response_code(404);
        echo base64_encode(json_encode(['status' => 'error', 'message' => "No dir: $user"]));
        exit;
    }
    $c = file_get_contents($file);
    $data['dir'] = $c !== false ? json_decode($c, true) : null;
}

// ── File report (streaming paginated) ────────────────────────────────────────
if ($type === 'file' || $type === 'both') {
    $file = $detailPath . DIRECTORY_SEPARATOR . "detail_report_file_{$user}.json";
    if (!is_file($file)) {
        http_response_code(404);
        echo base64_encode(json_encode(['status' => 'error', 'message' => "No file: $user"]));
        exit;
    }
    $fh = @fopen($file, 'r');
    $date = 0; $userName = $user; $totalFiles = 0; $totalUsed = 0;
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

echo base64_encode(json_encode(['status' => 'success', 'data' => $data]));
