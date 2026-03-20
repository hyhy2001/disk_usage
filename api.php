<?php
// api.php — Disk Usage Dashboard API
// ?req=list_drives            → list all configured disks
// ?req=permissions&drive=<id> → latest permission_issues JSON
// ?drive=<id>                 → aggregated report JSONs for disk

$baseDir   = __DIR__;

// disks.json: local file OR remote URL via ?disks=https://...
$disksParam = $_GET['disks'] ?? '';
if ($disksParam !== '' && (strpos($disksParam, 'http://') === 0 || strpos($disksParam, 'https://') === 0)) {
    $raw = @file_get_contents($disksParam);
} else {
    $raw = @file_get_contents($baseDir . '/' . ($disksParam ?: 'disks.json'));
}
$entries = json_decode($raw, true);
if (!is_array($entries)) $entries = [];

echo "[DEBUG] disks.json loaded: " . count($entries) . " entries\n";
echo json_encode($entries);

/*
// Build disk map — raw path, symlink-safe
$disks = [];
foreach ($entries as $e) {
    $raw = $e['path'] ?? '';
    $dir = ($raw !== '' && $raw[0] === '/')
        ? rtrim($raw, '/')
        : rtrim($baseDir . '/' . ltrim($raw, '/'), '/');
    $id  = $e['id'] ?? basename($dir);

    $dh = @opendir($dir); $count = 0;
    while ($dh && ($f = readdir($dh)) !== false) {
        if (substr($f,-5)==='.json' && strpos($f,'permission_issues')===false) $count++;
    }
    if ($dh) closedir($dh);

    $disks[$id] = ['id'=>$id,'name'=>$e['name']??$id,'dir'=>basename($raw?:$id),'resolved'=>$dir,'files'=>$count];
}

$req    = $_GET['req']   ?? '';
$diskId = $_GET['drive'] ?? array_key_first($disks);

echo "[DEBUG] req=$req disk=$diskId disks=" . count($disks) . "\n";

// list_drives
if ($req === 'list_drives') {
    $out = array_map(fn($d)=>['id'=>$d['id'],'name'=>$d['name'],'dir'=>$d['dir'],'files'=>$d['files'],'available'=>$d['files']>0], array_values($disks));
    echo json_encode(['status'=>'success','disks'=>$out]);
    exit;
}

$disk = $disks[$diskId] ?? null;
$dir  = $disk['resolved'] ?? '';
echo "[DEBUG] dir=$dir is_dir=" . (is_dir($dir)?'yes':'no') . " is_link=" . (is_link($dir)?'yes':'no') . "\n";

if (!$disk || (!is_dir($dir) && !is_link($dir))) {
    echo json_encode(['status'=>'error','message'=>"Not found: $diskId / $dir"]);
    exit;
}

// Read json files helper
$read = function(string $dir, string $match='') {
    $dh = @opendir($dir); $out = [];
    while ($dh && ($f=readdir($dh))!==false) {
        if (substr($f,-5)!=='.json') continue;
        if ($match!=='' && strpos($f,$match)===false) continue;
        $j = json_decode(@file_get_contents($dir.'/'.$f), true);
        if ($j !== null) $out[] = $j;
    }
    if ($dh) closedir($dh);
    return $out;
};

// permissions
if ($req === 'permissions') {
    $all = $read($dir, 'permission_issues');
    $latest = null;
    foreach ($all as $j) { if (($j['date']??0) > ($latest['date']??-1)) $latest=$j; }
    echo json_encode(['status'=>'success','disk'=>['id'=>$diskId],'data'=>$latest]);
    exit;
}

// disk data
$all  = $read($dir);
$data = array_values(array_filter($all, fn($j)=>!isset($j['permission_issues'])));
echo "[DEBUG] files=" . count($all) . " reports=" . count($data) . "\n";
echo json_encode(['status'=>'success','total_files'=>count($data),'disk'=>['id'=>$diskId,'dir'=>$disk['dir']],'data'=>$data]);
*/

