<?php
// Tier 1 pure-logic tests for backend/lib/disks_walker.php (3 disks.json shapes)
require_once DU_ROOT . '/backend/lib/disks_walker.php';

function du_fixture_disks() {
    return array(
        // Shape 1: flat disk
        array('id' => 'flat1', 'name' => 'Flat One', 'path' => 'reports_a'),
        // Shape 2: project node with teams
        array('project' => 'ProjX', 'teams' => array(
            array('name' => 'Alpha', 'disks' => array(
                array('id' => 'a1', 'name' => 'A One'),
                array('id' => 'a2', 'name' => 'A Two'),
            )),
            array('name' => 'Beta', 'disks' => array(
                array('id' => 'b1', 'name' => 'B One'),
            )),
        )),
        // Shape 3: team node
        array('name' => 'Gamma', 'disks' => array(
            array('id' => 'g1', 'name' => 'G One'),
        )),
    );
}

test('iterate visits every disk across all 3 shapes', function () {
    $ids = array();
    api_iterate_disks(du_fixture_disks(), function ($d, $ctx) use (&$ids) {
        $ids[] = $d['id'];
    });
    assert_eq(array('flat1', 'a1', 'a2', 'b1', 'g1'), $ids);
});

test('iterate passes project/team context', function () {
    $ctxById = array();
    api_iterate_disks(du_fixture_disks(), function ($d, $ctx) use (&$ctxById) {
        $ctxById[$d['id']] = $ctx['project'] . '/' . $ctx['team'];
    });
    assert_eq('/', $ctxById['flat1']);
    assert_eq('ProjX/Alpha', $ctxById['a1']);
    assert_eq('ProjX/Beta', $ctxById['b1']);
    assert_eq('/Gamma', $ctxById['g1']);
});

test('iterate stops early on false return', function () {
    $seen = array();
    api_iterate_disks(du_fixture_disks(), function ($d, $ctx) use (&$seen) {
        $seen[] = $d['id'];
        if ($d['id'] === 'a1') return false;
    });
    assert_eq(array('flat1', 'a1'), $seen);
});

test('iterate ignores non-array config', function () {
    $hit = false;
    api_iterate_disks('not an array', function () use (&$hit) { $hit = true; });
    assert_eq(false, $hit);
});

test('count_disks totals across shapes', function () {
    assert_eq(5, api_count_disks(du_fixture_disks()));
});

test('find_team_disks matches project-nested team', function () {
    $d = api_find_team_disks(du_fixture_disks(), 'Alpha');
    assert_eq(2, count($d));
    assert_eq('a1', $d[0]['id']);
});

test('find_team_disks matches top-level team node', function () {
    $d = api_find_team_disks(du_fixture_disks(), 'Gamma');
    assert_eq(1, count($d));
    assert_eq('g1', $d[0]['id']);
});

test('find_team_disks empty for unknown team', function () {
    assert_eq(array(), api_find_team_disks(du_fixture_disks(), 'Nope'));
});

test('find_team_disks empty for empty name', function () {
    assert_eq(array(), api_find_team_disks(du_fixture_disks(), ''));
});

// resolve_disk_entry_by_id lives in filesystem.php but walks via iterate.
test('resolve_disk_entry_by_id finds and augments context', function () {
    require_once DU_ROOT . '/backend/lib/filesystem.php';
    $e = api_resolve_disk_entry_by_id(du_fixture_disks(), 'b1');
    assert_eq('b1', $e['id']);
    assert_eq('ProjX', $e['project']);
    assert_eq('Beta', $e['team']);
});

test('resolve_disk_entry_by_id returns null when missing', function () {
    require_once DU_ROOT . '/backend/lib/filesystem.php';
    assert_eq(null, api_resolve_disk_entry_by_id(du_fixture_disks(), 'zzz'));
});
