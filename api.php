<?php
// api.php — Disk Usage Dashboard API
// Routing is implicit — determined by which POST params are present:
//   (no drive)           → list all configured disks
//   drive=<id>           → aggregated disk_usage_report*.json
//   drive=<id> + p=1     → latest permission_issues*.json

// Block non-POST requests (direct browser access, curl GET, etc.)
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(200);
    exit;
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

// ── Helpers ───────────────────────────────────────────────────────────────────
function getParam(string $key, string $default = ''): string {
    return trim((string)($_POST[$key] ?? $default));
}

function jsonError(int $code, string $message): void {
    http_response_code($code);
    echo json_encode(['status' => 'error', 'code' => $code, 'message' => $message]);
    exit;
}

function jsonSuccess(array $payload): void {
    echo json_encode(['status' => 'success', ...$payload]);
    exit;
}

// Resolve relative path to absolute (relative = relative to this file)
function resolvePath(string $path): string {
    if ($path !== '' && ($path[0] === '/' || (strlen($path) > 1 && $path[1] === ':'))) {
        return rtrim($path, '/\\');
    }
    return rtrim(__DIR__ . DIRECTORY_SEPARATOR . $path, '/\\');
}

// Read *.json files in a dir — uses opendir() to bypass WAF glob() block
function getJsonFiles(string $dir, string $match = ''): array {
    if (!is_dir($dir)) return [];
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
    jsonError(500, "disks.json not found.");
}

$entries = json_decode(file_get_contents($disksJsonPath), true);
if (!is_array($entries) || count($entries) === 0) {
    jsonError(500, "disks.json is empty or invalid.");
}

// ── Read params ───────────────────────────────────────────────────────────────
$diskId  = getParam('drive');
$isPerms = getParam('p') === '1';

// Sanitize disk ID
if ($diskId !== '' && !preg_match('/^[a-zA-Z0-9_\-]+$/', $diskId)) {
    jsonError(400, "Invalid disk id.");
}

// ── Route: no drive → list all disks ─────────────────────────────────────────
if ($diskId === '') {
    $out = [];
    foreach ($entries as $i => $e) {
        $rawPath  = $e['path'] ?? "disk_{$i}";
        $id       = $e['id']   ?? preg_replace('/[^a-z0-9]+/', '_', strtolower($rawPath));
        $resolved = resolvePath($rawPath);
        $allJson  = getJsonFiles($resolved);
        $count    = count(array_filter($allJson, fn($f) => strpos(basename($f), 'permission_issues') === false));
        $out[] = [
            'id'        => $id,
            'name'      => $e['name'] ?? $id,
            'dir'       => basename(rtrim($rawPath, '/\\')),
            'files'     => $count,
            'available' => $count > 0,
        ];
    }
    jsonSuccess(['disks' => $out]);
}

// ── Resolve the requested disk ────────────────────────────────────────────────
$diskEntry = null;
foreach ($entries as $i => $e) {
    $rawPath = $e['path'] ?? "disk_{$i}";
    $id      = $e['id']   ?? preg_replace('/[^a-z0-9]+/', '_', strtolower($rawPath));
    if ($id === $diskId) {
        $diskEntry = ['id' => $id, 'name' => $e['name'] ?? $id, 'rawPath' => $rawPath];
        break;
    }
}

if ($diskEntry === null) {
    jsonError(404, "Unknown disk.");
}

$reportDir = resolvePath($diskEntry['rawPath']);
$dirLabel  = basename(rtrim($diskEntry['rawPath'], '/\\'));

if (!is_dir($reportDir)) {
    jsonError(404, "Reports directory not found.");
}

// ── Route: drive + p=1 → latest permission_issues ────────────────────────────
if ($isPerms) {
    $files = getJsonFiles($reportDir, 'permission_issues');

    if (empty($files)) {
        jsonSuccess(['disk' => ['id' => $diskId, 'dir' => $dirLabel], 'data' => null]);
    }

    $latest     = null;
    $latestDate = -1;
    foreach ($files as $file) {
        $content = file_get_contents($file);
        if ($content === false) continue;
        $json = json_decode($content, true);
        if (!is_array($json)) continue;
        $d = $json['date'] ?? 0;
        if ($d > $latestDate) { $latestDate = $d; $latest = $json; }
    }

    jsonSuccess(['disk' => ['id' => $diskId, 'dir' => $dirLabel], 'data' => $latest]);
}

// ── Route: drive only → aggregated disk usage ─────────────────────────────────
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

jsonSuccess([
    'total_files' => count($files),
    'disk'        => ['id' => $diskId, 'dir' => $dirLabel],
    'data'        => $aggregated,
]);
