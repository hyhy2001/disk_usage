<?php
// user_detail_api.php — Per-user detail reports with pagination
//
// Parameters use short names to avoid WAF false-positives:
//   ?dir=mock_reports/disk_sda            → list users
//   ?dir=...&u=user1&t=dir               → dir report (full)
//   ?dir=...&u=user1&t=file              → file report (paginated)
//   ?dir=...&u=user1&t=file&p=500&n=500  → paginated file report
//   ?dir=...&u=user1&t=both              → dir + first page of files
//
// Pagination (t=file or t=both):
//   p  — 0-indexed row to start from   (default: 0)
//   n  — max rows to return            (default: 500, max: 2000)

$baseDir = __DIR__;
$reqDir  = isset($_GET['dir']) ? trim($_GET['dir'], '/\\') : '';

header('Content-Type: application/json; charset=utf-8');

// ── Security: block path traversal + empty dir ────────────────────────────────
if ($reqDir === '' || strpos($reqDir, '..') !== false) {
    http_response_code(403);
    echo json_encode(['status' => 'error', 'message' => 'Access denied']);
    exit;
}

$rawPath    = $baseDir . DIRECTORY_SEPARATOR . $reqDir;
$detailPath = $rawPath . DIRECTORY_SEPARATOR . 'detail_users';

if (!is_dir($rawPath) && !is_link($rawPath)) {
    http_response_code(404);
    echo json_encode(['status' => 'error', 'message' => 'Directory not found']);
    exit;
}

// Sanitise params — short names: u, t, p, n
$who    = isset($_GET['u']) ? preg_replace('/[^a-zA-Z0-9_\-]/', '', $_GET['u']) : '';
$kind   = isset($_GET['t']) ? $_GET['t'] : '';
$offset = max(0,    (int)($_GET['p'] ?? 0));
$limit  = min(2000, max(1, (int)($_GET['n'] ?? 500)));

// ── Mode A: list users ────────────────────────────────────────────────────────
if ($who === '') {
    if (!is_dir($detailPath)) {
        echo json_encode(['status' => 'success', 'data' => ['users' => []]]);
        exit;
    }
    $dh    = @opendir($detailPath);
    $users = [];
    while ($dh && ($f = readdir($dh)) !== false) {
        if (preg_match('/^detail_report_dir_(.+)\.json$/', $f, $m)) {
            $users[] = $m[1];
        }
    }
    if ($dh) closedir($dh);
    sort($users);
    echo json_encode(['status' => 'success', 'data' => ['users' => $users]]);
    exit;
}

// ── Mode B: get detail for user ───────────────────────────────────────────────
if (!in_array($kind, ['dir', 'file', 'both'], true)) {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => 'Invalid t. Use: dir, file, or both']);
    exit;
}

if (!is_dir($detailPath)) {
    http_response_code(404);
    echo json_encode(['status' => 'error', 'message' => 'detail_users/ not found']);
    exit;
}

// ── Dir report: always small, load in full ────────────────────────────────────
function readDirReport($detailPath, $who) {
    $file = $detailPath . DIRECTORY_SEPARATOR . "detail_report_dir_{$who}.json";
    if (!is_file($file)) return null;
    $content = file_get_contents($file);
    return $content !== false ? json_decode($content, true) : null;
}

// ── File report: streaming paginated reader ───────────────────────────────────
// Works for both indent=2 (multi-line entries) and single-line-per-entry formats
// by using brace-depth counting to detect object boundaries.
// Memory: O(limit) regardless of file size.
function readFileReportPaginated($detailPath, $who, $offset, $limit) {
    $file = $detailPath . DIRECTORY_SEPARATOR . "detail_report_file_{$who}.json";
    if (!is_file($file)) return null;

    $fh = @fopen($file, 'r');
    if (!$fh) return null;

    // ── Pass 1: read metadata until "files": [ ───────────────────────────────
    $date       = 0;
    $userName   = $who;
    $totalFiles = 0;
    $totalUsed  = 0;

    while (($line = fgets($fh)) !== false) {
        if (preg_match('/"date"\s*:\s*(\d+)/', $line, $m))          $date       = (int)$m[1];
        elseif (preg_match('/"user"\s*:\s*"([^"]+)"/', $line, $m))  $userName   = $m[1];
        elseif (preg_match('/"total_files"\s*:\s*(\d+)/', $line, $m)) $totalFiles = (int)$m[1];
        elseif (preg_match('/"total_used"\s*:\s*(\d+)/', $line, $m))  $totalUsed  = (int)$m[1];

        if (strpos($line, '"files"') !== false && strpos($line, '[') !== false) break;
    }

    // ── Pass 2: stream entries with brace-depth tracking ─────────────────────
    $idx       = 0;
    $collected = [];
    $buf       = '';
    $depth     = 0;

    while (($line = fgets($fh)) !== false) {
        $t = trim($line);
        if ($t === ']' || $t === '];') break;
        if ($t === '' || $t === '[')   continue;

        $buf   .= $line;
        $depth += substr_count($line, '{') - substr_count($line, '}');

        if ($depth <= 0 && ltrim($buf) !== '') {
            $clean = rtrim(trim($buf), ',');
            $obj   = @json_decode($clean, true);
            if ($obj !== null && is_array($obj)) {
                if ($idx >= $offset && count($collected) < $limit) {
                    $collected[] = $obj;
                }
                $idx++;
                if (count($collected) >= $limit && $idx >= $offset + $limit) break;
            }
            $buf   = '';
            $depth = 0;
        }
    }

    $returned = count($collected);
    fclose($fh);
    return [
        'date'        => $date,
        'user'        => $userName,
        'total_files' => $totalFiles,
        'total_used'  => $totalUsed,
        'offset'      => $offset,
        'limit'       => $limit,
        'has_more'    => $returned >= $limit,
        'files'       => $collected,
    ];
}

// ── Build response ────────────────────────────────────────────────────────────
$data = [];

if ($kind === 'dir' || $kind === 'both') {
    $d = readDirReport($detailPath, $who);
    if ($d === null) {
        http_response_code(404);
        echo json_encode(['status' => 'error', 'message' => "No dir report for: $who"]);
        exit;
    }
    $data['dir'] = $d;
}

if ($kind === 'file' || $kind === 'both') {
    $d = readFileReportPaginated($detailPath, $who, $offset, $limit);
    if ($d === null) {
        http_response_code(404);
        echo json_encode(['status' => 'error', 'message' => "No file report for: $who"]);
        exit;
    }
    $data['file'] = $d;
}

echo json_encode(['status' => 'success', 'data' => $data]);
