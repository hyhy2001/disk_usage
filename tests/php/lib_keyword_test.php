<?php
// Tier 1 pure-logic tests for backend/lib/keyword.php
require_once DU_ROOT . '/backend/lib/keyword.php';

test('tokens splits comma list, trims, lowercases', function () {
    assert_eq(array('a', 'b', 'c'), api_keyword_tokens('A, b ,C'));
});
test('tokens drops empty fragments', function () {
    assert_eq(array('x', 'y'), api_keyword_tokens('x,,  ,y'));
});
test('tokens returns empty for empty string', function () {
    assert_eq(array(), api_keyword_tokens(''));
});
test('tokens returns empty for non-string', function () {
    assert_eq(array(), api_keyword_tokens(null));
});

test('like_clause wraps bare token with %..%', function () {
    $bind = array();
    $sql = api_keyword_like_clause('path', array('foo'), $bind);
    assert_eq('(path LIKE ? COLLATE NOCASE)', $sql);
    assert_eq(array('%foo%'), $bind);
});
test('like_clause converts * wildcard to %', function () {
    $bind = array();
    $sql = api_keyword_like_clause('name', array('ab*cd'), $bind);
    assert_eq('(name LIKE ? COLLATE NOCASE)', $sql);
    assert_eq(array('ab%cd'), $bind);
});
test('like_clause ORs multiple tokens and appends all binds', function () {
    $bind = array();
    $sql = api_keyword_like_clause('p', array('a', 'b'), $bind);
    assert_eq('(p LIKE ? COLLATE NOCASE OR p LIKE ? COLLATE NOCASE)', $sql);
    assert_eq(array('%a%', '%b%'), $bind);
});
test('like_clause returns empty string for no tokens', function () {
    $bind = array();
    assert_eq('', api_keyword_like_clause('p', array(), $bind));
    assert_eq(array(), $bind);
});

test('match_path true when query empty (no filter)', function () {
    assert_true(api_keyword_match_path('/any/path', ''));
});
test('match_path substring case-insensitive', function () {
    assert_true(api_keyword_match_path('/var/LOG/app', 'log'));
});
test('match_path false when token absent', function () {
    assert_eq(false, api_keyword_match_path('/var/log', 'xyz'));
});
test('match_path wildcard anchors full string', function () {
    assert_true(api_keyword_match_path('/home/alice', '*alice'));
    assert_eq(false, api_keyword_match_path('/home/alice/sub', '*alice'));
});
