<?php
// server_info.php — Server diagnostic: WAF, ModSecurity, PHP, Apache/Nginx config
// NOTE: This file will be blocked by company server WAF (only api.php is whitelisted).
//       Use api.php?action=info on the company server instead.

error_reporting(0);
$rf = fn($p) => @is_file($p) ? @file_get_contents($p) : null;

$probePaths = [
    // WAF / ModSecurity
    '/etc/modsecurity/modsecurity.conf',
    '/etc/modsecurity2/modsecurity.conf',
    '/etc/apache2/mods-enabled/security2.conf',
    '/etc/nginx/modsec/main.conf',
    '/www/server/btwaf/conf/config.json',
    '/www/server/btwaf/conf/rule.json',
    '/www/server/btwaf/conf/white.rule',
    '/usr/local/nginx/conf/modsecurity.conf',
    '/usr/local/apache/conf/modsecurity.conf',
    // Web server config
    '/etc/apache2/apache2.conf',
    '/etc/httpd/conf/httpd.conf',
    '/usr/local/apache/conf/httpd.conf',
    '/etc/nginx/nginx.conf',
    '/usr/local/nginx/conf/nginx.conf',
    // Logs
    '/var/log/modsec_audit.log',
    '/var/log/apache2/modsec_audit.log',
    '/var/log/httpd/modsec_audit.log',
];

$found = [];
$miss  = [];
foreach ($probePaths as $p) {
    $c = $rf($p);
    if ($c !== null) $found[$p] = substr($c, -3000); // last 3KB
    else             $miss[]    = $p;
}

header('Content-Type: text/plain; charset=utf-8');
echo json_encode([
    'php'          => PHP_VERSION,
    'server'       => $_SERVER['SERVER_SOFTWARE'] ?? 'unknown',
    'open_basedir' => ini_get('open_basedir') ?: '(not set)',
    'disable_fns'  => ini_get('disable_functions') ?: '(none)',
    'php_ini'      => php_ini_loaded_file(),
    'doc_root'     => $_SERVER['DOCUMENT_ROOT'] ?? 'n/a',
    'script'       => __FILE__,
    'apache_mods'  => function_exists('apache_get_modules') ? apache_get_modules() : null,
    'php_exts'     => get_loaded_extensions(),
    'htaccess'     => $rf(__DIR__ . '/.htaccess'),
    'user_ini'     => $rf(__DIR__ . '/.user.ini'),
    'shell_test'   => @shell_exec('id 2>/dev/null') ?? '(disabled)',
    'config_found' => $found,
    'config_miss'  => $miss,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
