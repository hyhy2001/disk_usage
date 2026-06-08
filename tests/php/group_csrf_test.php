<?php
// Tier 1 tests for the group_config double-submit CSRF predicate.
// api_group_cfg_csrf_ok is the pure, side-effect-free core of the check
// (no cookies/headers), so it's unit-testable directly. It depends on
// api_admin_hash_equals for the constant-time compare, so load admin.php too.
require_once DU_ROOT . '/backend/handlers/admin.php';        // api_admin_hash_equals
require_once DU_ROOT . '/backend/handlers/group_config.php'; // api_group_cfg_csrf_ok

$DU_TOKEN_A = '0123456789abcdef0123456789abcdef'; // 32 hex
$DU_TOKEN_B = 'fedcba9876543210fedcba9876543210'; // 32 hex, different

test('csrf_ok true when cookie and sent token match', function () use ($DU_TOKEN_A) {
    assert_eq(true, api_group_cfg_csrf_ok($DU_TOKEN_A, $DU_TOKEN_A));
});

test('csrf_ok false when tokens differ', function () use ($DU_TOKEN_A, $DU_TOKEN_B) {
    assert_eq(false, api_group_cfg_csrf_ok($DU_TOKEN_A, $DU_TOKEN_B));
});

test('csrf_ok false when cookie token is empty', function () use ($DU_TOKEN_A) {
    assert_eq(false, api_group_cfg_csrf_ok('', $DU_TOKEN_A));
});

test('csrf_ok false when sent token is empty', function () use ($DU_TOKEN_A) {
    assert_eq(false, api_group_cfg_csrf_ok($DU_TOKEN_A, ''));
});

test('csrf_ok false when both empty (no cookie issued yet)', function () {
    assert_eq(false, api_group_cfg_csrf_ok('', ''));
});

test('csrf_ok false when cookie token is malformed (not 32 hex)', function () {
    // A non-hex/short cookie value must never validate even if echoed exactly,
    // so a client cannot self-issue a junk token pair and pass the check.
    assert_eq(false, api_group_cfg_csrf_ok('not-a-real-token', 'not-a-real-token'));
    assert_eq(false, api_group_cfg_csrf_ok('abc', 'abc'));
});

test('csrf_ok false on length-mismatch prefix (no truncated match)', function () use ($DU_TOKEN_A) {
    // Guards against a compare that returns true on a shared prefix.
    assert_eq(false, api_group_cfg_csrf_ok($DU_TOKEN_A, substr($DU_TOKEN_A, 0, 16)));
});
