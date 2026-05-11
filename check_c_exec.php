<?php
header('Content-Type: application/json; charset=utf-8');

$binary = __DIR__ . '/backend/lib/query_cli';
$arg = '--help';

function is_disabled($fn) {
    $raw = (string)ini_get('disable_functions');
    if ($raw === '') return false;
    $parts = array_map('trim', explode(',', $raw));
    return in_array($fn, $parts, true);
}

function run_shell_exec($cmd) {
    $out = @shell_exec($cmd . ' 2>&1');
    return array('ok' => $out !== null, 'output' => (string)$out);
}

function run_exec($cmd) {
    $lines = array();
    $code = -1;
    @exec($cmd . ' 2>&1', $lines, $code);
    return array('ok' => ($code === 0), 'exit_code' => $code, 'output' => implode("\n", $lines));
}

function run_popen($cmd) {
    $h = @popen($cmd . ' 2>&1', 'r');
    if (!$h) return array('ok' => false, 'output' => 'popen failed');
    $out = '';
    while (!feof($h)) {
        $out .= fgets($h);
        if (strlen($out) > 8192) break;
    }
    @pclose($h);
    return array('ok' => true, 'output' => $out);
}

$cmd = escapeshellarg($binary) . ' ' . escapeshellarg($arg);

$result = array(
    'php_version' => PHP_VERSION,
    'sapi' => PHP_SAPI,
    'binary' => $binary,
    'binary_exists' => is_file($binary),
    'binary_executable' => is_executable($binary),
    'disable_functions' => (string)ini_get('disable_functions'),
    'checks' => array(),
);

$methods = array('shell_exec', 'exec', 'popen', 'proc_open', 'passthru', 'system');
foreach ($methods as $fn) {
    $result['checks'][$fn] = array(
        'function_exists' => function_exists($fn),
        'disabled' => is_disabled($fn),
    );
}

if ($result['binary_exists'] && $result['binary_executable']) {
    if (function_exists('shell_exec') && !is_disabled('shell_exec')) {
        $result['checks']['shell_exec']['test'] = run_shell_exec($cmd);
    }
    if (function_exists('exec') && !is_disabled('exec')) {
        $result['checks']['exec']['test'] = run_exec($cmd);
    }
    if (function_exists('popen') && !is_disabled('popen')) {
        $result['checks']['popen']['test'] = run_popen($cmd);
    }
}

echo json_encode($result, JSON_PRETTY_PRINT);
