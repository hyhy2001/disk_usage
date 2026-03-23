<?php
// user_detail_api.php — Per-user detail reports with pagination
//
// Usage:
//   ?dir=mock_reports/disk_sda                              → list users
//   ?dir=mock_reports/disk_sda&user=user1&type=dir          → dir report (full)
//   ?dir=mock_reports/disk_sda&user=user1&type=file         → file report (paginated)
//   ?dir=mock_reports/disk_sda&user=user1&type=file&offset=500&limit=500
//   ?dir=mock_reports/disk_sda&user=user1&type=both         → dir + first page of files
//
// Pagination (type=file or type=both):
//   offset  — 0-indexed row to start from   (default: 0)
//   limit   — max rows to return            (default: 500, max: 2000)

$baseDir = __DIR__;
$reqDir  = isset($_GET['dir']) ? trim($_GET['dir'], '/\\') : '';

header('Content-Type: application/json; charset=utf-8');

// ── Security: block path traversal + empty dir ────────────────────────────────
if ($reqDir === '' || strpos($reqDir, '..') !== false) {
    http_response_code(403);
    echo json_encode(['status' => 'error', 'message' => 'Access denied: invalid dir parameter']);
    exit;
}

$rawPath    = $baseDir . DIRECTORY_SEPARATOR . $reqDir;
$detailPath = $rawPath . DIRECTORY_SEPARATOR . 'detail_users';

if (!is_dir($rawPath) && !is_link($rawPath)) {
    http_response_code(404);
    echo json_encode(['status' => 'error', 'message' => "Directory not found: $reqDir"]);
    exit;
}

// Sanitise params
$user   = isset($_GET['user'])   ? preg_replace('/[^a-zA-Z0-9_\-]/', '', $_GET['user']) : '';
$type   = isset($_GET['type'])   ? $_GET['type'] : '';
$offset = max(0,    (int)($_GET['offset'] ?? 0));
$limit  = min(2000, max(1, (int)($_GET['limit'] ?? 500)));

header('Content-Type: application/json; charset=utf-8');

// ── Mode A: list users ────────────────────────────────────────────────────────
if ($user === '') {
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
if (!in_array($type, ['dir', 'file', 'both'], true)) {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => 'Invalid type. Use: dir, file, or both']);
    exit;
}

if (!is_dir($detailPath)) {
    http_response_code(404);
    echo json_encode(['status' => 'error', 'message' => 'detail_users/ not found for this disk']);
    exit;
}

// ── Dir report: always small, load in full ────────────────────────────────────
function readDirReport($detailPath, $user) {
    $file = $detailPath . DIRECTORY_SEPARATOR . "detail_report_dir_{$user}.json";
    if (!is_file($file)) return null;
    $content = file_get_contents($file);
    return $content !== false ? json_decode($content, true) : null;
}

// ── File report: streaming paginated reader ───────────────────────────────────
// Works for both indent=2 (multi-line entries) and single-line-per-entry formats
// by using brace-depth counting to detect object boundaries.
// Memory: O(limit) regardless of file size.
function readFileReportPaginated($detailPath, $user, $offset, $limit) {
    $file = $detailPath . DIRECTORY_SEPARATOR . "detail_report_file_{$user}.json";
    if (!is_file($file)) return null;

    $fh = @fopen($file, 'r');
    if (!$fh) return null;

    // ── Pass 1: read metadata until "files": [ ───────────────────────────────
    $date        = 0;
    $userName    = $user;
    $totalFiles  = 0;
    $totalUsed   = 0;
    $inFiles     = false;

    while (($line = fgets($fh)) !== false) {
        if (preg_match('/"date"\s*:\s*(\d+)/', $line, $m))         $date       = (int)$m[1];
        elseif (preg_match('/"user"\s*:\s*"([^"]+)"/', $line, $m)) $userName   = $m[1];
        elseif (preg_match('/"total_files"\s*:\s*(\d+)/', $line, $m)) $totalFiles = (int)$m[1];
        elseif (preg_match('/"total_used"\s*:\s*(\d+)/', $line, $m))  $totalUsed  = (int)$m[1];

        // Stop as soon as we reach the files array — next fgets() will be first entry
        if (strpos($line, '"files"') !== false && strpos($line, '[') !== false) break;
    }

    // ── Pass 2: stream entries with brace-depth tracking ─────────────────────
    $idx       = 0;      // current entry index
    $collected = [];
    $buf       = '';
    $depth     = 0;

    while (($line = fgets($fh)) !== false) {
        $t = trim($line);

        // End of array
        if ($t === ']' || $t === '];') break;
        if ($t === '' || $t === '[')   continue;

        $buf   .= $line;
        $depth += substr_count($line, '{') - substr_count($line, '}');

        if ($depth <= 0 && ltrim($buf) !== '') {
            // We have a complete JSON object
            $clean = rtrim(trim($buf), ',');
            $obj   = @json_decode($clean, true);
            if ($obj !== null && is_array($obj)) {
                if ($idx >= $offset && count($collected) < $limit) {
                    $collected[] = $obj;
                }
                $idx++;
                // Early exit: collected enough and past offset
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
        // Reliable end-of-file detection: if we received a full page we may have more;
        // if fewer than requested, we've consumed all remaining entries.
        'has_more'    => $returned >= $limit,
        'files'       => $collected,
    ];
}

// ── Build response ────────────────────────────────────────────────────────────
$data = [];

if ($type === 'dir' || $type === 'both') {
    $d = readDirReport($detailPath, $user);
    if ($d === null) {
        http_response_code(404);
        echo json_encode(['status' => 'error', 'message' => "No dir report for user: $user"]);
        exit;
    }
    $data['dir'] = $d;
}

if ($type === 'file' || $type === 'both') {
    $d = readFileReportPaginated($detailPath, $user, $offset, $limit);
    if ($d === null) {
        http_response_code(404);
        echo json_encode(['status' => 'error', 'message' => "No file report for user: $user"]);
        exit;
    }
    $data['file'] = $d;
}

echo json_encode(['status' => 'success', 'data' => $data]);
