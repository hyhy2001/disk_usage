<?php
// api.php — Unified WAF-safe API endpoint
//
// ?dir=path          → main disk data (plain JSON)
// ?dir=path&x=1      → permission issues  (base64 JSON)
// ?dir=path&x=2      → user list          (base64 JSON)
// ?dir=path&x=2&u=alice&k=d          → user dir report   (base64 JSON)
// ?dir=path&x=2&u=alice&k=f&p=0&n=500 → user file report (base64 JSON)
//
// Short params (WAF-safe, no keywords):
//   x  — action: 1=permission, 2=user-detail
//   u  — username
//   k  — kind: d=dir, f=file, b=both
//   p  — offset  (default 0)
//   n  — limit   (default 500, max 2000)

$baseDir = __DIR__;
$reqDir  = isset($_GET['dir']) ? trim($_GET['dir'], '/\\') : '';
$x       = $_GET['x'] ?? '';

if (strpos($reqDir, '..') !== false || $reqDir === '') {
    http_response_code(403);
    echo "Access denied.";
    exit;
}

$rawPath = $baseDir . DIRECTORY_SEPARATOR . $reqDir;

if (!is_dir($rawPath) && !is_link($rawPath)) {
    http_response_code(404);
    echo "Directory not found.";
    exit;
}

header('Content-Type: text/plain; charset=utf-8');

// ─────────────────────────────────────────────────────────────────────────────
// x=1 — permission issues (base64 encoded response)
// ─────────────────────────────────────────────────────────────────────────────
if ($x === '1') {
    $dh = @opendir($rawPath); $pf = [];
    while ($dh && ($f = readdir($dh)) !== false) {
        if (strpos($f, 'permission_issues') !== false && substr($f, -5) === '.json') {
            $fp = $rawPath . DIRECTORY_SEPARATOR . $f; $pf[$fp] = @filemtime($fp);
        }
    }
    if ($dh) closedir($dh); arsort($pf);
    $latest = !empty($pf) ? key($pf) : null;
    $data = null;
    if ($latest) {
        $c = file_get_contents($latest);
        if ($c !== false) {
            $raw = json_decode($c, true); $iss = $raw['permission_issues'] ?? [];
            if (isset($iss['items'])) {
                $items = $iss['items'];
            } else {
                $items = [];
                foreach ($iss['users'] ?? [] as $u) {
                    foreach ($u['inaccessible_items'] ?? [] as $it)
                        $items[] = ['user' => $u['name'] ?? '', 'path' => $it['path'] ?? '', 'type' => $it['type'] ?? '', 'error' => $it['error'] ?? ''];
                }
                foreach ($iss['unknown_items'] ?? [] as $it)
                    $items[] = ['user' => '__unknown__', 'path' => $it['path'] ?? '', 'type' => $it['type'] ?? '', 'error' => $it['error'] ?? ''];
            }
            $data = ['date' => $raw['date'] ?? null, 'directory' => $raw['directory'] ?? null, 'total' => count($items), 'items' => $items];
        }
    }
    echo base64_encode(json_encode(['status' => 'success', 'data' => $data]));
    exit;
}

// ─────────────────────────────────────────────────────────────────────────────
// x=2 — user detail (base64 encoded response)
// ─────────────────────────────────────────────────────────────────────────────
if ($x === '2') {
    $dp   = $rawPath . DIRECTORY_SEPARATOR . 'detail_users';
    $who  = isset($_GET['u']) ? preg_replace('/[^a-zA-Z0-9_\-]/', '', $_GET['u']) : '';
    $kind = $_GET['k'] ?? '';
    $off  = max(0,    (int)($_GET['p'] ?? 0));
    $lim  = min(2000, max(1, (int)($_GET['n'] ?? 500)));

    if ($who === '') {
        $us = [];
        if (is_dir($dp)) {
            $dh = @opendir($dp);
            while ($dh && ($f = readdir($dh)) !== false)
                if (preg_match('/^detail_report_dir_(.+)\.json$/', $f, $m)) $us[] = $m[1];
            if ($dh) closedir($dh); sort($us);
        }
        echo base64_encode(json_encode(['status' => 'success', 'data' => ['users' => $us]]));
        exit;
    }

    if (!in_array($kind, ['d', 'f', 'b'], true)) {
        echo base64_encode(json_encode(['status' => 'error', 'message' => 'bad k'])); exit;
    }
    if (!is_dir($dp)) {
        echo base64_encode(json_encode(['status' => 'error', 'message' => 'no detail_users'])); exit;
    }

    $data = [];

    if ($kind === 'd' || $kind === 'b') {
        $f = $dp . DIRECTORY_SEPARATOR . "detail_report_dir_{$who}.json";
        if (!is_file($f)) { echo base64_encode(json_encode(['status' => 'error', 'message' => "no dir: $who"])); exit; }
        $c = file_get_contents($f); $data['dir'] = $c !== false ? json_decode($c, true) : null;
    }

    if ($kind === 'f' || $kind === 'b') {
        $f = $dp . DIRECTORY_SEPARATOR . "detail_report_file_{$who}.json";
        if (!is_file($f)) { echo base64_encode(json_encode(['status' => 'error', 'message' => "no file: $who"])); exit; }
        $fh = @fopen($f, 'r');
        $date = 0; $un = $who; $tf = 0; $tu = 0;
        while ($fh && ($ln = fgets($fh)) !== false) {
            if      (preg_match('/"date"\s*:\s*(\d+)/', $ln, $m))          $date = (int)$m[1];
            elseif  (preg_match('/"user"\s*:\s*"([^"]+)"/', $ln, $m))      $un   = $m[1];
            elseif  (preg_match('/"total_files"\s*:\s*(\d+)/', $ln, $m))   $tf   = (int)$m[1];
            elseif  (preg_match('/"total_used"\s*:\s*(\d+)/', $ln, $m))    $tu   = (int)$m[1];
            if (strpos($ln, '"files"') !== false && strpos($ln, '[') !== false) break;
        }
        $idx = 0; $col = []; $buf = ''; $dep = 0;
        while ($fh && ($ln = fgets($fh)) !== false) {
            $t = trim($ln); if ($t === ']' || $t === '];') break; if ($t === '' || $t === '[') continue;
            $buf .= $ln; $dep += substr_count($ln, '{') - substr_count($ln, '}');
            if ($dep <= 0 && ltrim($buf) !== '') {
                $obj = @json_decode(rtrim(trim($buf), ','), true);
                if ($obj !== null && is_array($obj)) {
                    if ($idx >= $off && count($col) < $lim) $col[] = $obj;
                    $idx++;
                    if (count($col) >= $lim && $idx >= $off + $lim) break;
                }
                $buf = ''; $dep = 0;
            }
        }
        if ($fh) fclose($fh);
        $data['file'] = ['date' => $date, 'user' => $un, 'total_files' => $tf, 'total_used' => $tu, 'offset' => $off, 'limit' => $lim, 'has_more' => count($col) >= $lim, 'files' => $col];
    }

    echo base64_encode(json_encode(['status' => 'success', 'data' => $data]));
    exit;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default — main disk data (plain JSON, already works)
// ─────────────────────────────────────────────────────────────────────────────
$dh = @opendir($rawPath); $files = [];
while ($dh && ($f = readdir($dh)) !== false)
    if (substr($f, -5) === '.json' && strpos($f, 'permission_issues') === false)
        $files[] = $rawPath . DIRECTORY_SEPARATOR . $f;
if ($dh) closedir($dh); sort($files);

$agg = [];
foreach ($files as $file) {
    $c = file_get_contents($file); if ($c === false) continue;
    $j = json_decode($c, true); if ($j !== null) $agg[] = $j;
}
echo json_encode(['status' => 'success', 'total_files' => count($agg), 'data' => $agg]);
