<?php
// permission_api.php — Paginated permission issues API
//
// Usage:
//   ?dir=mock_reports/disk_sda                     → full response (legacy)
//   ?dir=mock_reports/disk_sda&offset=0&limit=100  → paginated flat items
//
// Flat item format: { user, path, type, error }
// unknown UID items use user="__unknown__"

$baseDir = __DIR__;
$reqDir  = isset($_GET['dir']) ? trim($_GET['dir'], '/\\') : '';

header('Content-Type: application/json; charset=utf-8');

// Block traversal + empty dir
if ($reqDir === '' || strpos($reqDir, '..') !== false) {
    http_response_code(403);
    echo json_encode(['status' => 'error', 'message' => 'Access denied: invalid dir parameter']);
    exit;
}

$rawPath = $baseDir . DIRECTORY_SEPARATOR . $reqDir;

if (!is_dir($rawPath) && !is_link($rawPath)) {
    http_response_code(404);
    echo json_encode(['status' => 'error', 'message' => "Directory not found: $reqDir"]);
    exit;
}

// Sanitise pagination params
$offset = max(0,    (int)($_GET['offset'] ?? 0));
$limit  = min(5000, max(1, (int)($_GET['limit'] ?? 100)));

// ── Find most recent permission_issues_*.json ─────────────────────────────────
$dh        = @opendir($rawPath);
$permFiles = [];
while ($dh && ($f = readdir($dh)) !== false) {
    if (strpos($f, 'permission_issues') !== false && substr($f, -5) === '.json') {
        $fullPath = $rawPath . DIRECTORY_SEPARATOR . $f;
        $permFiles[$fullPath] = @filemtime($fullPath);
    }
}
if ($dh) closedir($dh);

arsort($permFiles);
$latestPath = !empty($permFiles) ? key($permFiles) : null;

header('Content-Type: application/json; charset=utf-8');

if (!$latestPath) {
    echo json_encode(['status' => 'success', 'data' => null]);
    exit;
}

$content = file_get_contents($latestPath);
if ($content === false) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Cannot read permission file']);
    exit;
}

$data = json_decode($content, true);
if ($data === null) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Invalid JSON in permission file']);
    exit;
}

// ── Normalize: support both flat (new) and nested (legacy) formats ────────────
$issues = $data['permission_issues'] ?? [];

if (isset($issues['items'])) {
    // New flat format
    $allItems = $issues['items'];
    $total    = $issues['total'] ?? count($allItems);
} else {
    // Legacy nested format — flatten on the fly
    $allItems = [];
    foreach ($issues['users'] ?? [] as $u) {
        foreach ($u['inaccessible_items'] ?? [] as $item) {
            $allItems[] = [
                'user'  => $u['name'] ?? '',
                'path'  => $item['path']  ?? '',
                'type'  => $item['type']  ?? '',
                'error' => $item['error'] ?? '',
            ];
        }
    }
    foreach ($issues['unknown_items'] ?? [] as $item) {
        $allItems[] = [
            'user'  => '__unknown__',
            'path'  => $item['path']  ?? '',
            'type'  => $item['type']  ?? '',
            'error' => $item['error'] ?? '',
        ];
    }
    $total = count($allItems);
}

// ── User summary — always from the FULL list (for sidebar counts) ─────────────
$userSummary = [];
foreach ($allItems as $item) {
    $u = $item['user'] ?? '__unknown__';
    $userSummary[$u] = ($userSummary[$u] ?? 0) + 1;
}

// ── Server-side user filter (applied BEFORE pagination) ───────────────────────
// ?users=alice,bob,__unknown__  — comma-separated. Empty = no filter (all).
$userFilter = [];
if (isset($_GET['users']) && trim($_GET['users']) !== '') {
    $userFilter = array_filter(array_map('trim', explode(',', $_GET['users'])));
}

if (!empty($userFilter)) {
    $filterSet = array_flip($userFilter);   // O(1) lookup
    $allItems  = array_values(array_filter($allItems, function ($item) use ($filterSet) {
        return isset($filterSet[$item['user'] ?? '']);
    }));
    $total = count($allItems);
}

// ── Paginate ─────────────────────────────────────────────────────────────────
$page_items = array_slice($allItems, $offset, $limit);
$returned   = count($page_items);

echo json_encode([
    'status' => 'success',
    'data'   => [
        'date'         => $data['date']      ?? null,
        'directory'    => $data['directory'] ?? null,
        'total'        => $total,
        'offset'       => $offset,
        'limit'        => $limit,
        'has_more'     => $returned >= $limit && ($offset + $returned) < $total,
        'items'        => $page_items,
        'user_summary' => $userSummary,   // always full counts, not filtered
    ],
]);
