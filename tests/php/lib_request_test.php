<?php
// Tier 1 pure-logic tests for backend/lib/request.php
require_once DU_ROOT . '/backend/lib/request.php';

// --- get_int: cast + clamp to [min,max] ---
test('get_int clamps below min', function () {
    $_GET = array('n' => '-5'); $_POST = array();
    assert_eq(0, get_int('n', 10, 0, 100));
});
test('get_int clamps above max', function () {
    $_GET = array('n' => '99999'); $_POST = array();
    assert_eq(100, get_int('n', 10, 0, 100));
});
test('get_int passes value in range', function () {
    $_GET = array('n' => '42'); $_POST = array();
    assert_eq(42, get_int('n', 10, 0, 100));
});
test('get_int uses default when missing', function () {
    $_GET = array(); $_POST = array();
    assert_eq(10, get_int('n', 10, 0, 100));
});
test('get_int casts non-numeric to 0 then clamps', function () {
    $_GET = array('n' => 'abc'); $_POST = array();
    assert_eq(5, get_int('n', 10, 5, 100)); // (int)'abc'=0 -> clamp up to min 5
});

// --- sanitize_name: strip ../ then whitelist ---
test('sanitize_name strips parent traversal', function () {
    assert_eq('etcpasswd', sanitize_name('../etc/passwd'));
});
test('sanitize_name keeps allowed chars', function () {
    assert_eq('disk_sda-1.report@host', sanitize_name('disk_sda-1.report@host'));
});
test('sanitize_name drops disallowed punctuation', function () {
    assert_eq('abc', sanitize_name('a/b\\c'));
});

// --- get_b64_decode: cap length + strict decode ---
test('get_b64_decode decodes valid base64', function () {
    assert_eq('alice', get_b64_decode(base64_encode('alice')));
});
test('get_b64_decode rejects garbage (strict)', function () {
    assert_eq('', get_b64_decode('@@@not base64@@@'));
});
test('get_b64_decode rejects empty', function () {
    assert_eq('', get_b64_decode(''));
});
test('get_b64_decode rejects over-limit input', function () {
    $huge = str_repeat('QQ', 600000); // ~1.2MB encoded > DU_B64_MAX_LEN
    assert_eq('', get_b64_decode($huge));
});
test('get_b64_decode accepts at-limit JSON payload', function () {
    $json = '{"groups":[{"id":"g1","name":"Team A"}]}';
    assert_eq($json, get_b64_decode(base64_encode($json)));
});

// --- get_b64_param: *_b64 wins, else plain fallback ---
test('get_b64_param prefers _b64 key', function () {
    $_GET = array('user_b64' => base64_encode('bob')); $_POST = array();
    assert_eq('bob', get_b64_param('user', 'def'));
});
test('get_b64_param falls back to plain param', function () {
    $_GET = array('user' => 'carol'); $_POST = array();
    assert_eq('carol', get_b64_param('user', 'def'));
});
