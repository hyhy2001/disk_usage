<?php
// tests/php/run.php — PHP test runner. Run with the 5.4 CLI to also catch any
// PHP 5.4 syntax incompatibility in the backend it loads:
//   php54 tests/php/run.php
//
// Loads the assertion harness, then every *_test.php in this directory. Each
// test file registers cases via test(); this runner executes them and exits
// non-zero on any failure (CI-friendly).

error_reporting(E_ALL & ~E_DEPRECATED);

define('DU_ROOT', dirname(dirname(__DIR__)));

require __DIR__ . '/helpers.php';

$files = glob(__DIR__ . '/*_test.php');
sort($files);
foreach ($files as $f) {
    echo "\n# " . basename($f) . "\n";
    require $f;
    // Execute the batch registered by this file, then reset the queue so the
    // next file's output is grouped under its own header.
    run_file_tests();
}

exit(final_exit_code());
