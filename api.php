<?php
// api.php — Disk Usage Dashboard API
// ?action=disks                  → list all configured disks
// ?action=permissions&disk=<id>  → latest *permission_issues*.json for disk
// ?disk=<id>                     → aggregated *disk_usage_report*.json for disk

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

// ── Helper: resolve path (absolute or relative to this file) ──────────────────
function resolvePath(string $path): string {
    if ($path !== '' && ($path[0] === '/' || (strlen($path) > 1 && $path[1] === ':'))) {
        return rtrim($path, '/\\');
    }
    return rtrim(__DIR__ . DIRECTORY_SEPARATOR . $path, '/\\');
}

// ── Load disks.json ───────────────────────────────────────────────────────────
$disksJsonPath = __DIR__ . '/disks.json';

if (!is_file($disksJsonPath)) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "disks.json not found."]);
    exit;
}

$entries = json_decode(file_get_contents($disksJsonPath), true);
if (!is_array($entries) || count($entries) === 0) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "disks.json is empty or invalid."]);
    exit;
}

// Build disk map: id => { name, rawPath, resolvedDir }
$disks = [];
foreach ($entries as $i => $e) {
    $rawPath  = $e['path'] ?? "disk_{$i}";
    $id       = $e['id']   ?? preg_replace('/[^a-z0-9]+/', '_', strtolower($rawPath));
    $resolved = resolvePath($rawPath);
    $allJson  = is_dir($resolved) ? (glob($resolved . DIRECTORY_SEPARATOR . '*.json') ?: []) : [];
    $count    = count(array_filter($allJson, fn($f) => strpos(basename($f), 'permission_issues') === false));
    $disks[$id] = [
        'id'        => $id,
        'name'      => $e['name'] ?? $id,
        'dir'       => basename($rawPath),
        'resolved'  => $resolved,
        'files'     => $count,
        'available' => $count > 0,
    ];
}

$action = $_GET['req'] ?? '';

// ── Route: ?req=list_drives  →  list disks ──────────────────────────────────────
if ($action === 'list_drives') {
    $out = array_map(fn($d) => [
        'id'        => $d['id'],
        'name'      => $d['name'],
        'dir'       => $d['dir'],
        'files'     => $d['files'],
        'available' => $d['available'],
    ], array_values($disks));
    echo json_encode(["status" => "success", "disks" => $out]);
    exit;
}

// ── Resolve disk for data routes ──────────────────────────────────────────────
$diskId = $_GET['drive'] ?? array_key_first($disks);

if (!isset($disks[$diskId])) {
    http_response_code(404);
    echo json_encode(["status" => "error", "message" => "Unknown disk id: {$diskId}"]);
    exit;
}

$disk       = $disks[$diskId];
$reportDir  = $disk['resolved'];

if (!is_dir($reportDir)) {
    http_response_code(404);
    echo json_encode(["status" => "error", "message" => "Reports directory not found: {$reportDir}"]);
    exit;
}

// ── Route: ?req=permissions&drive=<id>  →  latest permission_issues file ───
if ($action === 'permissions') {
    $files = glob($reportDir . DIRECTORY_SEPARATOR . '*permission_issues*.json') ?: [];

    if (empty($files)) {
        echo json_encode(["status" => "success", "disk" => ["id" => $diskId, "dir" => $disk['dir']], "data" => null]);
        exit;
    }

    // Read all, pick the one with the highest date field
    $latest     = null;
    $latestDate = -1;

    foreach ($files as $file) {
        $content = file_get_contents($file);
        if ($content === false) continue;
        $json = json_decode($content, true);
        if (!is_array($json)) continue;
        $d = $json['date'] ?? 0;
        if ($d > $latestDate) {
            $latestDate = $d;
            $latest     = $json;
        }
    }

    echo json_encode([
        "status" => "success",
        "disk"   => ["id" => $diskId, "dir" => $disk['dir']],
        "data"   => $latest,
    ]);
    exit;
}

// ── Route: ?disk=<id>  →  aggregated disk usage data ────────────────────────
// Matches any *.json EXCEPT *permission_issues* files
$allFiles   = glob($reportDir . DIRECTORY_SEPARATOR . '*.json') ?: [];
$files      = array_filter($allFiles, fn($f) => strpos(basename($f), 'permission_issues') === false);
$aggregated = [];

foreach ($files as $file) {
    $content = file_get_contents($file);
    if ($content !== false) {
        $json = json_decode($content, true);
        if ($json !== null) $aggregated[] = $json;
    }
}

echo json_encode([
    "status"      => "success",
    "total_files" => count($files),
    "disk"        => ["id" => $diskId, "dir" => $disk['dir']],
    "data"        => $aggregated,
]);
exit;
