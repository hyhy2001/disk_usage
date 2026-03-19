<?php
// test_dir.php — Temp test file: list local directory files
// DELETE after testing!

$baseDir = __DIR__;
$testDir = $baseDir . '/mock_reports/disk_sda';

echo "<pre>\n";
echo "=== DIR TEST ===\n";
echo "Base dir : " . $baseDir . "\n";
echo "Test dir : " . $testDir . "\n";
echo "is_dir() : " . (is_dir($testDir) ? "YES" : "NO") . "\n\n";

// Test opendir / readdir
echo "=== opendir() / readdir() ===\n";
$dh = @opendir($testDir);
if ($dh === false) {
    echo "opendir() FAILED\n";
} else {
    echo "opendir() OK\n";
    while (($f = readdir($dh)) !== false) {
        if ($f === '.' || $f === '..') continue;
        $full = $testDir . DIRECTORY_SEPARATOR . $f;
        echo "  - " . $f . " (" . filesize($full) . " bytes)\n";
    }
    closedir($dh);
}

// Test file_get_contents on first .json
echo "\n=== file_get_contents() first .json ===\n";
$dh2 = @opendir($testDir);
if ($dh2) {
    while (($f = readdir($dh2)) !== false) {
        if (substr($f, -5) !== '.json') continue;
        $path    = $testDir . DIRECTORY_SEPARATOR . $f;
        $content = file_get_contents($path);
        if ($content === false) {
            echo "file_get_contents() FAILED on: $f\n";
        } else {
            echo "file_get_contents() OK : $f\n";
            echo "  Size    : " . strlen($content) . " bytes\n";
            $json = json_decode($content, true);
            echo "  json_decode: " . ($json !== null ? "OK — keys: " . implode(', ', array_keys($json)) : "FAILED") . "\n";
        }
        break; // only test first file
    }
    closedir($dh2);
}

echo "\n=== getcwd() ===\n";
echo getcwd() . "\n";

echo "</pre>";
