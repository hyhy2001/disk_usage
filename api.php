<?php
if (empty($_GET) && empty($_POST)) exit;
header('Content-Type: application/json; charset=utf-8');

$cwd = getcwd();
$disksFile = $cwd . '/disks.json';
if (!is_file($disksFile)) exit(json_encode(["error" => "disks.json missing."]));

$disks = json_decode(file_get_contents($disksFile), true);
$diskMap = [];

// Helper to safely read json files without glob (WAF bypass)
function get_jsons($dir, $match = '', $exclude = '') {
    $res = [];
    if ($dh = @opendir($dir)) {
        while (($f = readdir($dh)) !== false) {
            if (substr($f, -5) === '.json' && ($match === '' || strpos($f, $match) !== false) && ($exclude === '' || strpos($f, $exclude) === false)) {
                $res[] = rtrim($dir, '/\\') . '/' . $f;
            }
        }
        closedir($dh);
    }
    return $res;
}

// Map disks with dynamic pathing
foreach ($disks as $i => $e) {
    $rawPath = ltrim(str_replace(['\\', '/'], '/', $e['path'] ?? "disk_$i"), '/');
    $id = $e['id'] ?? preg_replace('/[^a-z0-9]+/', '_', strtolower($rawPath));
    $resolved = rtrim($cwd, '/\\') . '/' . $rawPath;
    
    $files = get_jsons($resolved, '', 'permission_issues');
    $diskMap[$id] = ['id' => $id, 'name' => $e['name'] ?? $id, 'dir' => $rawPath, 'resolved' => $resolved, 'files' => count($files), 'available' => !empty($files)];
}

$req = $_POST['req'] ?? ($_GET['req'] ?? '');
if ($req === 'list_drives') exit(json_encode(["status" => "success", "disks" => array_values($diskMap)]));

$diskId = $_POST['drive'] ?? ($_GET['drive'] ?? array_key_first($diskMap));
if (!isset($diskMap[$diskId])) exit(json_encode(["error" => "Unknown disk"]));

$dir = $diskMap[$diskId]['resolved'];

// Permissions check route
if ($req === 'permissions') {
    $latest = null; $maxDate = -1;
    foreach (get_jsons($dir, 'permission_issues') as $f) {
        if ($j = json_decode(file_get_contents($f), true)) {
            if (($j['date'] ?? 0) > $maxDate) { $maxDate = $j['date']; $latest = $j; }
        }
    }
    exit(json_encode(["status" => "success", "disk" => ["id" => $diskId, "dir" => $diskMap[$diskId]['dir']], "data" => $latest]));
}

// Default route: aggregate JSON files
$data = [];
foreach (get_jsons($dir, '', 'permission_issues') as $f) {
    if ($j = json_decode(file_get_contents($f), true)) $data[] = $j;
}
exit(json_encode(["status" => "success", "total_files" => count($data), "disk" => ["id" => $diskId, "dir" => $diskMap[$diskId]['dir']], "data" => $data]));
