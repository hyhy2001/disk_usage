<?php
// api.php
// Backend API for Disk Usage Dashboard
// Scans the mock_reports directory, aggregates all JSON files, and serves them instantly to overcome browser HTTP fetch limits.

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *'); // Allow local development
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0'); // Prevent caching during dev

$reportsDir = __DIR__ . '/mock_reports';
$aggregatedData = [];

// Determine path to scan
if (!is_dir($reportsDir)) {
    http_response_code(404);
    echo json_encode(["status" => "error", "message" => "Reports directory not found."]);
    exit;
}

// Find all .json files
$files = glob($reportsDir . '/*.json');

if ($files === false || count($files) === 0) {
    echo json_encode(["status" => "success", "data" => []]);
    exit;
}

// Iterate, parse, and accumulate
foreach ($files as $file) {
    $content = file_get_contents($file);
    if ($content !== false) {
        $json = json_decode($content, true);
        if ($json !== null) {
            $aggregatedData[] = $json;
        }
    }
}

// Return the massive combined payload as a single optimized HTTP response
echo json_encode([
    "status" => "success",
    "total_files" => count($files),
    "data" => $aggregatedData
]);
exit;
