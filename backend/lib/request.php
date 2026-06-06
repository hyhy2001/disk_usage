<?php

function param($key, $default) {
    if (isset($_POST[$key])) return $_POST[$key];
    return isset($_GET[$key]) ? $_GET[$key] : $default;
}

// Max length of an accepted base64-encoded param. 1 MB encoded (~768 KB
// decoded) is far above any real payload here (usernames, group config,
// disks.json) yet caps memory abuse from an arbitrarily large _b64 value.
// PHP file-scope const, bare scalar (5.4-safe).
const DU_B64_MAX_LEN = 1048576;

function get_b64_decode($val) {
    if (!is_string($val) || $val === '' || strlen($val) > DU_B64_MAX_LEN) return '';
    // strict mode rejects non-base64 garbage instead of silently mangling it.
    $decoded = base64_decode($val, true);
    return $decoded === false ? '' : $decoded;
}

function get_b64_param($key, $default) {
    $b64_key = $key . '_b64';
    if (isset($_POST[$b64_key])) return get_b64_decode($_POST[$b64_key]);
    if (isset($_GET[$b64_key])) return get_b64_decode($_GET[$b64_key]);
    return param($key, $default);
}

function get_int($key, $default, $min, $max) {
    return min($max, max($min, (int)param($key, $default)));
}

function sanitize_name($raw) {
    $raw = str_replace(array('../', '..\\'), '', $raw);
    return preg_replace('/[^a-zA-Z0-9_\-\.\@\$\s]/', '', $raw);
}
