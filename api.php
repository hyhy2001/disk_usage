<?php
// api.php — Disk Usage Dashboard API
// ?action=disks                  → list all configured disks
// ?action=permissions&disk=<id>  → latest *permission_issues*.json for disk
// ?disk=<id>                     → aggregated *disk_usage_report*.json for disk

// Block direct browser access — return nothing if no recognized parameters
if (empty($_GET) && empty($_POST)) {
    http_response_code(200);
    exit;
}

header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

// ── Helper: resolve path (absolute or relative to this file) ──────────────────
function resolvePath(string $path): string {
    if ($path !== '' && ($path[0] === '/' || (strlen($path) > 1 && $path[1] === ':'))) {
        // Absolute path — use as-is
        return rtrim($path, '/\\');
    }
    // Relative path — join with __DIR__, do NOT use realpath (breaks symlinks)
    $raw = __DIR__ . DIRECTORY_SEPARATOR . ltrim($path, '/\\');
    return rtrim($raw, '/\\');
}

// ── Helper: Read JSON files (symlink-safe, no realpath) ─────────────────────
function getJsonFiles(string $dir, string $match = ''): array {
    if (!is_dir($dir) && !is_link($dir)) return [];
    $dh = @opendir($dir);
    if ($dh === false) return [];

    $res = [];
    while (($f = readdir($dh)) !== false) {
        if ($f === '.' || $f === '..') continue;
        if (substr($f, -5) !== '.json') continue;
        if ($match !== '' && strpos($f, $match) === false) continue;
        $res[] = rtrim($dir, '/\\') . DIRECTORY_SEPARATOR . $f;
    }
    closedir($dh);
    return $res;
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
    $allJson  = getJsonFiles($resolved);
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

$action = $_POST['req'] ?? ($_GET['req'] ?? '');

// ── Route: list_drives  →  list disks ───────────────────────────────────────────
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
$diskId = $_POST['drive'] ?? ($_GET['drive'] ?? array_key_first($disks));

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

// ── Route: permissions  →  latest permission_issues file ────────
if ($action === 'permissions') {
    $files = getJsonFiles($reportDir, 'permission_issues');

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
$allFiles   = getJsonFiles($reportDir);
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
