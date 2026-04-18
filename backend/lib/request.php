<?php

function param($key, $default) {
    if (isset($_POST[$key])) return $_POST[$key];
    return isset($_GET[$key]) ? $_GET[$key] : $default;
}

function get_b64_param($key, $default) {
    $b64_key = $key . '_b64';
    if (isset($_POST[$b64_key])) return base64_decode($_POST[$b64_key]);
    if (isset($_GET[$b64_key])) return base64_decode($_GET[$b64_key]);
    return param($key, $default);
}

function get_int($key, $default, $min, $max) {
    return min($max, max($min, (int)param($key, $default)));
}

function sanitize_name($raw) {
    $raw = str_replace(array('../', '..\\'), '', $raw);
    return preg_replace('/[^a-zA-Z0-9_\-\.\@\$\s]/', '', $raw);
}

function matches_wildcard($string, $wildcard) {
    if ($wildcard === '') return true;
    if (strpos($wildcard, '*') === false) $wildcard = '*' . $wildcard . '*';
    $regex = '/^' . str_replace('\*', '.*', preg_quote($wildcard, '/')) . '$/i';
    return preg_match($regex, $string);
}
