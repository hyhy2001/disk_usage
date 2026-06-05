<?php
@ini_set('memory_limit', '512M');
ob_start('ob_gzhandler');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');

require_once __DIR__ . '/constants.php';
require_once __DIR__ . '/lib/request.php';
require_once __DIR__ . '/lib/response.php';
require_once __DIR__ . '/lib/disks_walker.php';
require_once __DIR__ . '/lib/keyword.php';
require_once __DIR__ . '/lib/filesystem.php';
require_once __DIR__ . '/lib/cache.php';
require_once __DIR__ . '/lib/db_connection.php';
require_once __DIR__ . '/lib/path_resolver.php';

require_once __DIR__ . '/handlers/disks.php';
require_once __DIR__ . '/handlers/team.php';
require_once __DIR__ . '/handlers/health.php';
require_once __DIR__ . '/handlers/meta.php';
require_once __DIR__ . '/handlers/permissions.php';
require_once __DIR__ . '/handlers/treemap.php';
require_once __DIR__ . '/handlers/users.php';
require_once __DIR__ . '/handlers/detail.php';
require_once __DIR__ . '/handlers/aggregate.php';
require_once __DIR__ . '/handlers/group_config.php';
require_once __DIR__ . '/handlers/admin.php';
require_once __DIR__ . '/handlers/scan_status.php';

// Runtime diagnostics. Gated behind admin auth — it leaks PHP version and
// disable_functions (exploit-surface recon) and is loaded after admin.php so
// the auth helper is available. Unauthenticated callers get a generic 401.
if (isset($_GET['debug_runtime']) && $_GET['debug_runtime'] === '1') {
    header('Content-Type: application/json');
    if (!api_admin_is_authenticated()) {
        http_response_code(401);
        echo json_encode(array('error' => 'Unauthorized'));
        exit;
    }
    echo json_encode(array(
        'php_version' => PHP_VERSION,
        'disable_functions' => ini_get('disable_functions'),
        'server_time' => date('Y-m-d H:i:s'),
    ), JSON_PRETTY_PRINT);
    exit;
}

require_once __DIR__ . '/router.php';

api_dispatch_request(dirname(__DIR__));
