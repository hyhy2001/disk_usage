<?php
// Tier 1 tests for api_aggregate_read_valid_json (guards corrupt report files)
require_once DU_ROOT . '/backend/handlers/aggregate.php';

// Scratch dir for fixtures.
function du_agg_tmp() {
    $d = sys_get_temp_dir() . '/du_agg_test_' . getmypid();
    if (!is_dir($d)) mkdir($d, 0700, true);
    return $d;
}
function du_agg_write($name, $content) {
    $p = du_agg_tmp() . '/' . $name;
    file_put_contents($p, $content);
    return $p;
}

test('read_valid_json returns trimmed content for valid JSON', function () {
    $p = du_agg_write('ok.json', "  {\"date\":1,\"x\":true}\n");
    assert_eq('{"date":1,"x":true}', api_aggregate_read_valid_json($p));
});

test('read_valid_json returns null for corrupt JSON', function () {
    $p = du_agg_write('bad.json', '{"date":2, BROKEN');
    assert_eq(null, api_aggregate_read_valid_json($p));
});

test('read_valid_json returns null for empty file', function () {
    $p = du_agg_write('empty.json', '');
    assert_eq(null, api_aggregate_read_valid_json($p));
});

test('read_valid_json returns null for whitespace-only file', function () {
    $p = du_agg_write('ws.json', "   \n\t ");
    assert_eq(null, api_aggregate_read_valid_json($p));
});

test('read_valid_json returns null for missing file', function () {
    assert_eq(null, api_aggregate_read_valid_json(du_agg_tmp() . '/nope.json'));
});

test('read_valid_json accepts a JSON array too', function () {
    $p = du_agg_write('arr.json', '[1,2,3]');
    assert_eq('[1,2,3]', api_aggregate_read_valid_json($p));
});

// Cleanup (registered last so it runs after the cases above).
test('cleanup aggregate fixtures', function () {
    $d = du_agg_tmp();
    foreach (glob($d . '/*') as $f) @unlink($f);
    @rmdir($d);
    assert_true(true);
});
