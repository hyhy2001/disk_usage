<?php
// Tier 1 tests for api_group_cfg_sanitize (schema v3 normalize + dedup)
require_once DU_ROOT . '/backend/handlers/group_config.php';

test('sanitize returns empty v3 skeleton for non-array', function () {
    $out = api_group_cfg_sanitize('nope');
    assert_eq(3, $out['schema_version']);
    assert_eq(array(), $out['groups']);
    assert_eq(array(), $out['seeded_disks']);
});

test('sanitize dedups and sorts users per disk', function () {
    $out = api_group_cfg_sanitize(array('groups' => array(
        array('id' => 'g1', 'name' => 'G1', 'diskUsers' => array(
            'disk_a' => array('bob', 'alice', 'bob', '  alice  ', ''),
        )),
    )));
    assert_eq(array('alice', 'bob'), $out['groups'][0]['diskUsers']['disk_a']);
});

test('sanitize fills missing id/name with defaults', function () {
    $out = api_group_cfg_sanitize(array('groups' => array(
        array('diskUsers' => array()),
    )));
    assert_eq('group_1', $out['groups'][0]['id']);
    assert_eq('Group 1', $out['groups'][0]['name']);
});

test('sanitize drops empty disk_id and non-array users', function () {
    $out = api_group_cfg_sanitize(array('groups' => array(
        array('id' => 'g', 'name' => 'G', 'diskUsers' => array(
            '' => array('x'),          // empty disk id -> dropped
            'disk_b' => 'notarray',    // non-array users -> dropped
            'disk_c' => array('u1'),   // kept
        )),
    )));
    $du = $out['groups'][0]['diskUsers'];
    assert_eq(array('disk_c'), array_keys($du));
    assert_eq(array('u1'), $du['disk_c']);
});

test('sanitize coerces seeded_disks to bool', function () {
    $out = api_group_cfg_sanitize(array('seeded_disks' => array(
        'disk_a' => 1, 'disk_b' => 0, 'disk_c' => 'yes',
    )));
    assert_eq(true, $out['seeded_disks']['disk_a']);
    assert_eq(false, $out['seeded_disks']['disk_b']);
    assert_eq(true, $out['seeded_disks']['disk_c']);
});

test('sanitize skips non-array group entries', function () {
    $out = api_group_cfg_sanitize(array('groups' => array('bad', array('id' => 'ok', 'name' => 'OK'))));
    assert_eq(1, count($out['groups']));
    assert_eq('ok', $out['groups'][0]['id']);
});
