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
