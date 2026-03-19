<?php
// api.php — Disk Usage Dashboard API
// POST do=disks                 → list all configured disks
// POST do=perms&drive=<id>      → latest permission_issues*.json for disk
// POST drive=<id>               → aggregated disk_usage_report*.json for disk

// ── Block direct browser access (no params) ───────────────────────────────────
if (empty($_GET) && empty($_POST)) {
    http_response_code(200);
    exit;
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

// ── Input validation ──────────────────────────────────────────────────────────
$ALLOWED_ACTIONS = ['disks', 'perms', ''];

function getParam(string $key, string $default = ''): string {
    $val = $_POST[$key] ?? ($_GET[$key] ?? $default);
    return trim((string)$val);
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

$action = getParam('do');
$diskId = getParam('drive');

// Validate action param
if (!in_array($action, $ALLOWED_ACTIONS, true)) {
    jsonError(400, "Unknown action.");
}

// Sanitize disk ID: allow only alphanumeric + underscore/hyphen
if ($diskId !== '' && !preg_match('/^[a-zA-Z0-9_\-]+$/', $diskId)) {
    jsonError(400, "Invalid disk id format.");
}

// ── Helper: resolve path (absolute or relative to this file) ──────────────────
function resolvePath(string $path): string {
    if ($path !== '' && ($path[0] === '/' || (strlen($path) > 1 && $path[1] === ':'))) {
        return rtrim($path, '/\\');
    }
    return rtrim(__DIR__ . DIRECTORY_SEPARATOR . $path, '/\\');
}

// ── Helper: Read JSON files (Bypass WAF glob() block) ─────────────────────────
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

// ── Route: disks — list all disks (eager, needed for full list) ────────────────
if ($action === 'disks') {
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

// ── Resolve disk for data routes (lazy: only resolve the requested disk) ──────
$diskEntry = null;
foreach ($entries as $i => $e) {
    $rawPath = $e['path'] ?? "disk_{$i}";
    $id      = $e['id']   ?? preg_replace('/[^a-z0-9]+/', '_', strtolower($rawPath));

    // Default to first disk if no drive param given
    if ($diskId === '') {
        $diskId    = $id;
        $diskEntry = ['id' => $id, 'name' => $e['name'] ?? $id, 'rawPath' => $rawPath];
        break;
    }

    if ($id === $diskId) {
        $diskEntry = ['id' => $id, 'name' => $e['name'] ?? $id, 'rawPath' => $rawPath];
        break;
    }
}

if ($diskEntry === null) {
    jsonError(404, "Unknown disk id: {$diskId}");
}

$reportDir = resolvePath($diskEntry['rawPath']);
$dirLabel  = basename(rtrim($diskEntry['rawPath'], '/\\'));

if (!is_dir($reportDir)) {
    jsonError(404, "Reports directory not found: {$reportDir}");
}

// ── Route: perms — latest permission_issues file ───────────────────────────────
if ($action === 'perms') {
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
        if ($d > $latestDate) {
            $latestDate = $d;
            $latest     = $json;
        }
    }

    jsonSuccess(['disk' => ['id' => $diskId, 'dir' => $dirLabel], 'data' => $latest]);
}

// ── Route: disk usage — aggregated report files ───────────────────────────────
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
