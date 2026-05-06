<?php
@ini_set('memory_limit', '512M');
ob_start('ob_gzhandler');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');

require_once __DIR__ . '/lib/request.php';
require_once __DIR__ . '/lib/response.php';
require_once __DIR__ . '/lib/filesystem.php';
require_once __DIR__ . '/lib/cache.php';
require_once __DIR__ . '/lib/export_throttle.php';

if (isset($_GET['debug_runtime']) && $_GET['debug_runtime'] === '1') {
    header('Content-Type: application/json');
    echo json_encode(array(
        'bootstrap_file' => __FILE__,
        'php_version' => PHP_VERSION,
        'disable_functions' => ini_get('disable_functions'),
        'server_time' => date('Y-m-d H:i:s'),
    ), JSON_PRETTY_PRINT);
    exit;
}

require_once __DIR__ . '/handlers/disks.php';
require_once __DIR__ . '/handlers/team.php';
require_once __DIR__ . '/handlers/health.php';
require_once __DIR__ . '/handlers/meta.php';
require_once __DIR__ . '/handlers/permissions.php';
require_once __DIR__ . '/handlers/treemap_simple.php';
require_once __DIR__ . '/handlers/users.php';
require_once __DIR__ . '/handlers/detail_simple.php';
require_once __DIR__ . '/handlers/aggregate.php';
require_once __DIR__ . '/handlers/group_config.php';
require_once __DIR__ . '/handlers/admin.php';
require_once __DIR__ . '/handlers/scan_status.php';

require_once __DIR__ . '/router.php';

api_dispatch_request(dirname(__DIR__));
