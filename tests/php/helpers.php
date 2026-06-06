<?php
// tests/php/helpers.php — tiny zero-dependency test registry + assertions.
// Runs on PHP 5.4 (array(), no short-array, no closures-in-const). Keeps the
// repo dependency-free: no Composer, no PHPUnit. Each *_test.php file calls
// test('name', function(){ ... }) and uses the assert_* helpers below.

$GLOBALS['__tests'] = array();
$GLOBALS['__stats'] = array('pass' => 0, 'fail' => 0, 'failures' => array());

function test($name, $fn) {
    $GLOBALS['__tests'][] = array('name' => $name, 'fn' => $fn);
}

class AssertionFailed extends Exception {}
class ApiExit extends Exception {}

// Handlers call b64_error/b64_success then exit. In tests we never load
// backend/lib/response.php, so define throwing stubs: a function that would
// have terminated the request instead raises ApiExit, which tests can catch
// via assert_throws. Guarded so the real lib (if ever loaded) wins.
if (!function_exists('b64_error')) {
    function b64_error($message, $code = 400) {
        throw new ApiExit('b64_error(' . $code . '): ' . $message);
    }
}
if (!function_exists('b64_success')) {
    function b64_success($data) {
        throw new ApiExit('b64_success');
    }
}

function assert_true($cond, $msg = '') {
    if ($cond !== true && $cond != true) {
        throw new AssertionFailed($msg !== '' ? $msg : 'expected truthy');
    }
}

function assert_eq($expected, $actual, $msg = '') {
    if ($expected !== $actual) {
        $e = var_export($expected, true);
        $a = var_export($actual, true);
        throw new AssertionFailed(($msg !== '' ? $msg . ' — ' : '') . "expected $e, got $a");
    }
}

function assert_throws($fn, $msg = '') {
    $threw = false;
    try { call_user_func($fn); } catch (Exception $e) { $threw = true; }
    if (!$threw) {
        throw new AssertionFailed($msg !== '' ? $msg : 'expected an exception to be thrown');
    }
}

// Execute the tests registered so far (by the current *_test.php file), print
// per-case output, accumulate into global tallies, then clear the queue so the
// next file starts fresh. Called once per file by run.php.
function run_file_tests() {
    foreach ($GLOBALS['__tests'] as $t) {
        try {
            call_user_func($t['fn']);
            $GLOBALS['__stats']['pass']++;
            echo "  ok   " . $t['name'] . "\n";
        } catch (Exception $e) {
            $GLOBALS['__stats']['fail']++;
            $GLOBALS['__stats']['failures'][] = $t['name'] . ': ' . $e->getMessage();
            echo "  FAIL " . $t['name'] . "\n";
            echo "       " . $e->getMessage() . "\n";
        }
    }
    $GLOBALS['__tests'] = array(); // reset queue for the next file
}

// Print the final summary and return the process exit code.
function final_exit_code() {
    $s = $GLOBALS['__stats'];
    echo "\n" . $s['pass'] . " passed, " . $s['fail'] . " failed\n";
    return $s['fail'] === 0 ? 0 : 1;
}
