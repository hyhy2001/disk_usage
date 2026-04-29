<?php

function b64_success($data) {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array('status' => 'success', 'data' => $data));
    exit;
}

function b64_error($message, $code) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array('status' => 'error', 'message' => $message));
    exit;
}

function json_success($data) {
    echo json_encode($data);
    exit;
}

/**
 * Issue ETag/Cache-Control headers based on the source file's mtime/size and any
 * extra context (query params, etc). If the client sends a matching
 * If-None-Match header we short-circuit with a 304 response and exit.
 *
 * @param string|array $source_paths   File path or array of file paths whose
 *                                     mtime+size define the cached snapshot.
 * @param array        $extra_keys     Extra strings (e.g. filter params, type)
 *                                     that should invalidate the cache when
 *                                     they change.
 * @param int          $max_age        Browser cache TTL in seconds.
 */
function api_send_etag_cache($source_paths, $extra_keys = array(), $max_age = 300) {
    if (!is_array($source_paths)) $source_paths = array($source_paths);

    $parts = array();
    foreach ($source_paths as $p) {
        if ($p === '' || $p === null) continue;
        $mtime = @filemtime($p);
        $size  = @filesize($p);
        if ($mtime === false) $mtime = 0;
        if ($size === false)  $size  = 0;
        $parts[] = $mtime . '-' . $size;
    }
    foreach ($extra_keys as $k) {
        if ($k === null || $k === '') continue;
        $parts[] = (string)$k;
    }

    $etag = '"' . substr(sha1(implode('|', $parts)), 0, 24) . '"';

    // Override the global no-cache headers from bootstrap for this response.
    header('Cache-Control: private, max-age=' . (int)$max_age . ', must-revalidate');
    header('Pragma:');
    header('ETag: ' . $etag);

    $client_etag = isset($_SERVER['HTTP_IF_NONE_MATCH']) ? trim($_SERVER['HTTP_IF_NONE_MATCH']) : '';
    if ($client_etag !== '' && $client_etag === $etag) {
        http_response_code(304);
        // Some setups need explicit Content-Length: 0 to avoid hanging.
        header('Content-Length: 0');
        // Discard any output buffer started in bootstrap so the body is empty.
        if (ob_get_level() > 0) @ob_end_clean();
        exit;
    }
}
