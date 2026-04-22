<?php
ob_start('ob_gzhandler');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');

require_once __DIR__ . '/lib/request.php';
require_once __DIR__ . '/lib/response.php';
require_once __DIR__ . '/lib/filesystem.php';
require_once __DIR__ . '/lib/cache.php';

require_once __DIR__ . '/handlers/disks.php';
require_once __DIR__ . '/handlers/team.php';
require_once __DIR__ . '/handlers/health.php';
require_once __DIR__ . '/handlers/meta.php';
require_once __DIR__ . '/handlers/permissions.php';
require_once __DIR__ . '/handlers/treemap.php';
require_once __DIR__ . '/handlers/users.php';
require_once __DIR__ . '/handlers/dirs.php';
require_once __DIR__ . '/handlers/files.php';
require_once __DIR__ . '/handlers/aggregate.php';
require_once __DIR__ . '/handlers/group_config.php';
require_once __DIR__ . '/handlers/admin.php';

require_once __DIR__ . '/router.php';

api_dispatch_request(dirname(__DIR__));
