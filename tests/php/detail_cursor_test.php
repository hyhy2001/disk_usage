<?php
// Tier 1 pure-logic tests for the keyset cursor codec in backend/handlers/detail.php
require_once DU_ROOT . '/backend/handlers/detail.php';

test('cursor round-trips a dir cursor (size,id)', function () {
    $c = array('size' => 12345, 'id' => 7);
    $enc = api_detail_encode_cursor($c);
    assert_eq($c, api_detail_decode_cursor($enc));
});

test('cursor round-trips a file cursor (size,dir_id,name_id)', function () {
    $c = array('size' => 999, 'dir_id' => 42, 'name_id' => 88);
    $enc = api_detail_encode_cursor($c);
    assert_eq($c, api_detail_decode_cursor($enc));
});

test('cursor encoding is URL-safe (no +, /, =)', function () {
    // Force bytes that would yield +,/,= in standard base64.
    $enc = api_detail_encode_cursor(array('size' => 4294967295, 'id' => 4294967294));
    assert_eq(false, strpos($enc, '+') !== false, 'no plus');
    assert_eq(false, strpos($enc, '/') !== false, 'no slash');
    assert_eq(false, strpos($enc, '=') !== false, 'no padding');
});

test('decode returns null for empty', function () {
    assert_eq(null, api_detail_decode_cursor(''));
});

test('decode returns null for malformed base64', function () {
    assert_eq(null, api_detail_decode_cursor('@@@@'));
});

test('decode returns null for valid base64 that is not a JSON array', function () {
    // base64 of the JSON string "42" decodes fine but is not an array.
    $enc = rtrim(strtr(base64_encode('42'), '+/', '-_'), '=');
    assert_eq(null, api_detail_decode_cursor($enc));
});

test('decode tolerates missing padding (URL-safe)', function () {
    $c = array('size' => 1, 'id' => 2);
    $enc = api_detail_encode_cursor($c); // already stripped of '='
    assert_eq($c, api_detail_decode_cursor($enc));
});
