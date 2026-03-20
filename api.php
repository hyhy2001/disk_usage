<?php
// api.php — Disk Usage Dashboard API
// ?req=list_drives            → list all configured disks
// ?req=permissions&drive=<id> → latest permission_issues JSON
// ?drive=<id>                 → aggregated report JSONs for disk



// ── Load disks.json ───────────────────────────────────────────────────────────
$disksJson = __DIR__ . '/disks.json';
$entries   = json_decode(@file_get_contents($disksJson), true);

if (!is_array($entries) || !count($entries)) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'disks.json missing or invalid.']);
    exit;
}

// Build disk map — raw path (no realpath, supports symlinks)
$disks = [];
foreach ($entries as $e) {
    $rawPath = $e['path'] ?? '';
    // Absolute path kept as-is; relative → join with __DIR__
    $dir = ($rawPath !== '' && $rawPath[0] === '/')
        ? rtrim($rawPath, '/')
        : rtrim(__DIR__ . '/' . ltrim($rawPath, '/'), '/');

    $id = $e['id'] ?? preg_replace('/[^a-z0-9]+/', '_', strtolower(basename($dir)));

    // Count report files (exclude permission_issues)
    $count = 0;
    $dh = @opendir($dir);
    while ($dh && ($f = readdir($dh)) !== false) {
        if (substr($f, -5) === '.json' && strpos($f, 'permission_issues') === false) $count++;
    }
    if ($dh) closedir($dh);

    $disks[$id] = [
        'id'        => $id,
        'name'      => $e['name'] ?? $id,
        'dir'       => basename($rawPath ?: $id),
        'resolved'  => $dir,
        'files'     => $count,
        'available' => $count > 0,
    ];
}

$req    = $_GET['req']   ?? '';
$diskId = $_GET['drive'] ?? array_key_first($disks);

echo "[DEBUG] req=$req disk=$diskId\n";
echo "[DEBUG] disks.json loaded: " . count($disks) . " disks\n";

// ── Route: list_drives ────────────────────────────────────────────────────────
if ($req === 'list_drives') {
    $out = array_map(fn($d) => [
        'id'        => $d['id'],
        'name'      => $d['name'],
        'dir'       => $d['dir'],
        'files'     => $d['files'],
        'available' => $d['available'],
    ], array_values($disks));
    echo json_encode(['status' => 'success', 'disks' => $out]);
    exit;
}

// ── Resolve disk ──────────────────────────────────────────────────────────────
if (!isset($disks[$diskId])) {
    http_response_code(404);
    echo json_encode(['status' => 'error', 'message' => "Unknown disk: $diskId"]);
    exit;
}

$disk = $disks[$diskId];
$dir  = $disk['resolved'];

if (!is_dir($dir) && !is_link($dir)) {
    http_response_code(404);
    echo json_encode(['status' => 'error', 'message' => "Dir not found: $dir"]);
    exit;
}

echo "[DEBUG] resolved dir: $dir\n";
echo "[DEBUG] is_dir=" . (is_dir($dir) ? 'yes' : 'no') . " is_link=" . (is_link($dir) ? 'yes' : 'no') . "\n";

// Helper: read all .json files (optionally filtered by name substring)
function readJsonFiles(string $dir, string $match = ''): array {
    $dh  = @opendir($dir);
    $out = [];
    while ($dh && ($f = readdir($dh)) !== false) {
        if (substr($f, -5) !== '.json') continue;
        if ($match !== '' && strpos($f, $match) === false) continue;
        $content = @file_get_contents($dir . '/' . $f);
        if ($content === false) continue;
        $json = json_decode($content, true);
        if ($json !== null) $out[] = $json;
    }
    if ($dh) closedir($dh);
    return $out;
}

// ── Route: permissions ────────────────────────────────────────────────────────
if ($req === 'permissions') {
    $all    = readJsonFiles($dir, 'permission_issues');
    $latest = null;
    foreach ($all as $j) {
        if (($j['date'] ?? 0) > ($latest['date'] ?? -1)) $latest = $j;
    }
    echo json_encode(['status' => 'success', 'disk' => ['id' => $diskId], 'data' => $latest]);
    exit;
}

// ── Route: disk data ──────────────────────────────────────────────────────────
$all  = readJsonFiles($dir);
$data = array_values(array_filter($all, fn($j) => !isset($j['permission_issues'])));

echo "[DEBUG] files read: " . count($all) . " total, " . count($data) . " reports\n";

echo json_encode([
    'status'      => 'success',
    'total_files' => count($data),
    'disk'        => ['id' => $diskId, 'dir' => $disk['dir']],
    'data'        => $data,
]);
