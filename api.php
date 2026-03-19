<?php
// api.php — Disk Usage Dashboard API
//
// Single endpoint, no user-supplied params.
// Reads ALL disks from disks.json, returns all data in one response.
// Path construction uses only server-side config — zero user input in file paths.
//
// POST api.php  →  { status, disks: [ { id, name, dir, available, data[], perms } ] }

// Allow GET and POST — block everything else (PUT, DELETE, HEAD, scanners)
if (!in_array($_SERVER['REQUEST_METHOD'], ['GET', 'POST'], true)) {
    http_response_code(405);
    exit;
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

// ── Helpers ───────────────────────────────────────────────────────────────────
function jsonError(int $code, string $message): void {
    http_response_code($code);
    echo json_encode(['status' => 'error', 'code' => $code, 'message' => $message]);
    exit;
}

// Resolve relative path to absolute (relative to this file's directory)
function resolvePath(string $path): string {
    if ($path !== '' && ($path[0] === '/' || (strlen($path) > 1 && $path[1] === ':'))) {
        return rtrim($path, '/\\');
    }
    return rtrim(__DIR__ . DIRECTORY_SEPARATOR . $path, '/\\');
}

// Read *.json files — uses opendir() to bypass WAF glob() restrictions
function readJsonDir(string $dir, string $match = ''): array {
    if (!is_dir($dir)) return [];
    $dh = @opendir($dir);
    if ($dh === false) return [];

    $paths = [];
    while (($f = readdir($dh)) !== false) {
        if ($f === '.' || $f === '..') continue;
        if (substr($f, -5) !== '.json') continue;
        if ($match !== '' && strpos($f, $match) === false) continue;
        $paths[] = rtrim($dir, '/\\') . DIRECTORY_SEPARATOR . $f;
    }
    closedir($dh);
    return $paths;
}

function readJsonFile(string $path): ?array {
    $content = file_get_contents($path);
    if ($content === false) return null;
    $data = json_decode($content, true);
    return is_array($data) ? $data : null;
}

// ── Load disks.json (server-side config only) ─────────────────────────────────
$disksJsonPath = __DIR__ . '/disks.json';

if (!is_file($disksJsonPath)) {
    jsonError(500, "disks.json not found.");
}

$entries = json_decode(file_get_contents($disksJsonPath), true);
if (!is_array($entries) || count($entries) === 0) {
    jsonError(500, "disks.json is empty or invalid.");
}

// ── Build response — iterate all disks from server config ────────────────────
$result = [];

foreach ($entries as $i => $e) {
    // Path comes entirely from server config, not from any HTTP param
    $rawPath  = $e['path'] ?? "disk_{$i}";
    $id       = $e['id']   ?? preg_replace('/[^a-z0-9]+/', '_', strtolower($rawPath));
    $name     = $e['name'] ?? $id;
    $dir      = basename(rtrim($rawPath, '/\\'));
    $resolved = resolvePath($rawPath);

    // ── Disk usage reports ────────────────────────────────────────────────────
    $reportPaths = is_dir($resolved)
        ? array_filter(readJsonDir($resolved), fn($f) => strpos(basename($f), 'permission_issues') === false)
        : [];

    $data = [];
    foreach ($reportPaths as $path) {
        $json = readJsonFile($path);
        if ($json !== null) $data[] = $json;
    }

    // ── Permission issues — pick the one with the latest date field ───────────
    $permPaths = is_dir($resolved) ? readJsonDir($resolved, 'permission_issues') : [];
    $perms     = null;
    $latest    = -1;

    foreach ($permPaths as $path) {
        $json = readJsonFile($path);
        if ($json === null) continue;
        $d = $json['date'] ?? 0;
        if ($d > $latest) { $latest = $d; $perms = $json; }
    }

    $result[] = [
        'id'        => $id,
        'name'      => $name,
        'dir'       => $dir,
        'files'     => count($data),
        'available' => count($data) > 0,
        'data'      => $data,
        'perms'     => $perms,
    ];
}

echo json_encode(['status' => 'success', 'disks' => $result]);
