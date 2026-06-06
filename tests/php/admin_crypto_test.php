<?php
// Tier 1 tests for crypto/auth helpers in backend/handlers/admin.php
require_once DU_ROOT . '/backend/lib/request.php'; // require_csrf uses param() fallback
require_once DU_ROOT . '/backend/handlers/admin.php';

test('pbkdf2 is deterministic for same inputs', function () {
    $a = bin2hex(api_admin_pbkdf2('pw', 'saltsalt', 1000, 32));
    $b = bin2hex(api_admin_pbkdf2('pw', 'saltsalt', 1000, 32));
    assert_eq($a, $b);
    assert_eq(64, strlen($a)); // 32 bytes -> 64 hex chars
});

test('pbkdf2 differs when salt differs', function () {
    $a = bin2hex(api_admin_pbkdf2('pw', 'salt1', 1000, 32));
    $b = bin2hex(api_admin_pbkdf2('pw', 'salt2', 1000, 32));
    assert_eq(false, $a === $b);
});

test('pbkdf2 matches a precomputed known vector', function () {
    // PBKDF2-HMAC-SHA256, password="password", salt="salt", iter=2, dkLen=32.
    // Standard published test vector (RFC-style) — hardcoded so the test runs
    // on PHP 5.4 (which lacks hash_pbkdf2).
    $expected = 'ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43';
    assert_eq($expected, bin2hex(api_admin_pbkdf2('password', 'salt', 2, 32)));
});

test('hash_equals true for identical strings', function () {
    assert_true(api_admin_hash_equals('abc123', 'abc123'));
});
test('hash_equals false for different strings', function () {
    assert_eq(false, api_admin_hash_equals('abc123', 'abc124'));
});
test('hash_equals false for different lengths', function () {
    assert_eq(false, api_admin_hash_equals('abc', 'abcd'));
});

test('hash_password + verify_password round-trip', function () {
    $hash = api_admin_hash_password('correct horse battery');
    assert_true(api_admin_verify_password('correct horse battery', $hash));
    assert_eq(false, api_admin_verify_password('wrong password', $hash));
});

test('verify_password handles explicit pbkdf2 format', function () {
    // Build a pbkdf2$ hash by hand and confirm verify parses + matches it.
    $iter = 1000; $salt = 'abcdef0123456789';
    $calc = bin2hex(api_admin_pbkdf2('s3cr3tpass', hex2bin($salt), $iter, 32));
    $stored = 'pbkdf2$' . $iter . '$' . $salt . '$' . $calc;
    assert_true(api_admin_verify_password('s3cr3tpass', $stored));
    assert_eq(false, api_admin_verify_password('nope', $stored));
});

test('verify_password false for malformed pbkdf2 string', function () {
    assert_eq(false, api_admin_verify_password('x', 'pbkdf2$missing$parts'));
});

test('csrf token is 64 hex chars and stable within a session', function () {
    // session_start may warn under CLI headers; suppress and proceed.
    @session_start();
    $t1 = api_admin_csrf_token();
    $t2 = api_admin_csrf_token();
    assert_eq($t1, $t2, 'token stable across calls');
    assert_eq(64, strlen($t1));
    assert_eq(1, preg_match('/^[0-9a-f]{64}$/', $t1));
});

test('require_csrf rejects missing token (ApiExit 403)', function () {
    @session_start();
    api_admin_csrf_token(); // ensure a token exists in session
    $_SERVER = array();
    $_GET = array(); $_POST = array();
    assert_throws(function () { api_admin_require_csrf(); });
});

test('require_csrf accepts correct token via header', function () {
    @session_start();
    $tok = api_admin_csrf_token();
    $_SERVER = array('HTTP_X_CSRF_TOKEN' => $tok);
    $_GET = array(); $_POST = array();
    // No exception == pass.
    api_admin_require_csrf();
    assert_true(true);
});
