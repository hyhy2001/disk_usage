<?php
// api.php — Unified WAF-safe API endpoint (PHP 5.4+ compatible)
//
// ALL actions use only ?dir= parameter (WAF allows only this):
//
//   ?dir=path               -> main disk data (plain JSON)
//   ?dir=p|path             -> permission issues (base64 JSON)
//   ?dir=u|path             -> user list (base64 JSON)
//   ?dir=d|alice|path       -> user dir report (base64 JSON)
//   ?dir=f|alice|0|500|path -> user file report paginated (base64 JSON)
//
// The pipe | prefix encodes the action - no extra params needed.

function _g($arr, $key, $default) {
    return isset($arr[$key]) ? $arr[$key] : $default;
}

$baseDir = __DIR__;
$raw     = isset($_GET['dir']) ? $_GET['dir'] : '';

// Block traversal anywhere in the raw value
if (strpos($raw, '..') !== false || $raw === '') {
    http_response_code(403);
    echo "Access denied.";
    exit;
}

header('Content-Type: text/plain; charset=utf-8');

// -- Parse action prefix --
// Formats: p|path / u|path / d|username|path / f|username|offset|limit|path
$parts  = explode('|', $raw, 5);
$action = count($parts) > 1 ? $parts[0] : '';
$lastPart = $parts[count($parts) - 1];
$reqDir = count($parts) > 1 ? trim($lastPart, '/\\') : trim($raw, '/\\');

// Validate the actual disk path
if (strpos($reqDir, '..') !== false || $reqDir === '') {
    http_response_code(403); echo "Access denied."; exit;
}
$rawPath = $baseDir . DIRECTORY_SEPARATOR . $reqDir;
if (!is_dir($rawPath) && !is_link($rawPath)) {
    http_response_code(404); echo "Not found."; exit;
}

// ─────────────────────────────────────────────────────────────────────────────
// p|path -- permission issues
// ─────────────────────────────────────────────────────────────────────────────
if ($action === 'p') {
    $dh = @opendir($rawPath); $pf = array();
    while ($dh && ($f = readdir($dh)) !== false) {
        if (strpos($f, 'permission_issues') !== false && substr($f, -5) === '.json') {
            $fp = $rawPath . DIRECTORY_SEPARATOR . $f;
            $pf[$fp] = @filemtime($fp);
        }
    }
    if ($dh) closedir($dh);
    arsort($pf);
    $latest = !empty($pf) ? key($pf) : null;
    $data = null;
    if ($latest) {
        $c = file_get_contents($latest);
        if ($c !== false) {
            $raw2 = json_decode($c, true);
            $iss  = _g($raw2, 'permission_issues', array());
            if (isset($iss['items'])) {
                $items = $iss['items'];
            } else {
                $items = array();
                $users = _g($iss, 'users', array());
                foreach ($users as $u) {
                    $inacc = _g($u, 'inaccessible_items', array());
                    foreach ($inacc as $it)
                        $items[] = array(
                            'user'  => _g($u,  'name',  ''),
                            'path'  => _g($it, 'path',  ''),
                            'type'  => _g($it, 'type',  ''),
                            'error' => _g($it, 'error', ''),
                        );
                }
                $unknown = _g($iss, 'unknown_items', array());
                foreach ($unknown as $it)
                    $items[] = array(
                        'user'  => '__unknown__',
                        'path'  => _g($it, 'path',  ''),
                        'type'  => _g($it, 'type',  ''),
                        'error' => _g($it, 'error', ''),
                    );
            }
            $data = array(
                'date'      => _g($raw2, 'date',      null),
                'directory' => _g($raw2, 'directory', null),
                'total'     => count($items),
                'items'     => $items,
            );
        }
    }
    echo base64_encode(json_encode(array('status' => 'success', 'data' => $data)));
    exit;
}

// ─────────────────────────────────────────────────────────────────────────────
// u|path -- list users
// ─────────────────────────────────────────────────────────────────────────────
if ($action === 'u') {
    $dp = $rawPath . DIRECTORY_SEPARATOR . 'detail_users';
    $us = array();
    if (is_dir($dp)) {
        $dh = @opendir($dp);
        while ($dh && ($f = readdir($dh)) !== false)
            if (preg_match('/^detail_report_dir_(.+)\.json$/', $f, $m)) $us[] = $m[1];
        if ($dh) closedir($dh);
        sort($us);
    }
    echo base64_encode(json_encode(array('status' => 'success', 'data' => array('users' => $us))));
    exit;
}

// ─────────────────────────────────────────────────────────────────────────────
// d|username|path -- user dir report
// ─────────────────────────────────────────────────────────────────────────────
if ($action === 'd') {
    $who = isset($parts[1]) ? preg_replace('/[^a-zA-Z0-9_\-]/', '', $parts[1]) : '';
    $dp  = $rawPath . DIRECTORY_SEPARATOR . 'detail_users';
    $f   = $dp . DIRECTORY_SEPARATOR . 'detail_report_dir_' . $who . '.json';
    if (!is_file($f)) {
        echo base64_encode(json_encode(array('status' => 'error', 'message' => 'no dir: ' . $who)));
        exit;
    }
    $c = file_get_contents($f);
    echo base64_encode(json_encode(array(
        'status' => 'success',
        'data'   => array('dir' => ($c !== false ? json_decode($c, true) : null)),
    )));
    exit;
}

// ─────────────────────────────────────────────────────────────────────────────
// f|username|offset|limit|path -- user file report paginated
// ─────────────────────────────────────────────────────────────────────────────
if ($action === 'f') {
    $who = isset($parts[1]) ? preg_replace('/[^a-zA-Z0-9_\-]/', '', $parts[1]) : '';
    $off = max(0,    (int)(isset($parts[2]) ? $parts[2] : 0));
    $lim = min(2000, max(1, (int)(isset($parts[3]) ? $parts[3] : 500)));
    $dp  = $rawPath . DIRECTORY_SEPARATOR . 'detail_users';
    $f   = $dp . DIRECTORY_SEPARATOR . 'detail_report_file_' . $who . '.json';
    if (!is_file($f)) {
        echo base64_encode(json_encode(array('status' => 'error', 'message' => 'no file: ' . $who)));
        exit;
    }
    $fh = @fopen($f, 'r');
    $date = 0; $un = $who; $tf = 0; $tu = 0;
    while ($fh && ($ln = fgets($fh)) !== false) {
        if      (preg_match('/"date"\s*:\s*(\d+)/', $ln, $m))          $date = (int)$m[1];
        elseif  (preg_match('/"user"\s*:\s*"([^"]+)"/', $ln, $m))      $un   = $m[1];
        elseif  (preg_match('/"total_files"\s*:\s*(\d+)/', $ln, $m))   $tf   = (int)$m[1];
        elseif  (preg_match('/"total_used"\s*:\s*(\d+)/', $ln, $m))    $tu   = (int)$m[1];
        if (strpos($ln, '"files"') !== false && strpos($ln, '[') !== false) break;
    }
    $idx = 0; $col = array(); $buf = ''; $dep = 0;
    while ($fh && ($ln = fgets($fh)) !== false) {
        $t = trim($ln);
        if ($t === ']' || $t === '];') break;
        if ($t === '' || $t === '[') continue;
        $buf .= $ln;
        $dep += substr_count($ln, '{') - substr_count($ln, '}');
        if ($dep <= 0 && ltrim($buf) !== '') {
            $obj = @json_decode(rtrim(trim($buf), ','), true);
            if ($obj !== null && is_array($obj)) {
                if ($idx >= $off && count($col) < $lim) $col[] = $obj;
                $idx++;
                if (count($col) >= $lim && $idx >= $off + $lim) break;
            }
            $buf = ''; $dep = 0;
        }
    }
    if ($fh) fclose($fh);
    echo base64_encode(json_encode(array(
        'status' => 'success',
        'data'   => array('file' => array(
            'date'        => $date,
            'user'        => $un,
            'total_files' => $tf,
            'total_used'  => $tu,
            'offset'      => $off,
            'limit'       => $lim,
            'has_more'    => count($col) >= $lim,
            'files'       => $col,
        )),
    )));
    exit;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default -- main disk data (plain JSON)
// ─────────────────────────────────────────────────────────────────────────────
$dh = @opendir($rawPath); $files = array();
while ($dh && ($f = readdir($dh)) !== false)
    if (substr($f, -5) === '.json' && strpos($f, 'permission_issues') === false)
        $files[] = $rawPath . DIRECTORY_SEPARATOR . $f;
if ($dh) closedir($dh);
sort($files);

$agg = array();
foreach ($files as $file) {
    $c = file_get_contents($file); if ($c === false) continue;
    $j = json_decode($c, true); if ($j !== null) $agg[] = $j;
}
echo json_encode(array('status' => 'success', 'total_files' => count($agg), 'data' => $agg));
