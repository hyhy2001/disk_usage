<?php
// backend/constants.php — single source of truth for filenames & report
// patterns this dashboard reads.
//
// The check_disk/ Python scanner produces these files; disk_usage/ reads
// them. Filename literals were previously scattered across 8 PHP files —
// changing one meant grepping the whole tree. Centralising here keeps the
// PHP side aligned with `check_disk/src/constants.py` (memory: project_layout
// — coupling between the two projects is via these filenames).
//
// PHP 5.4+: `const` at file scope works since PHP 5.3. Use bare scalar
// expressions (no concat with another const).

// Top-level config & state
const DU_DISKS_CONFIG_FILENAME = 'disks.json';
const DU_SCAN_STATUS_FILENAME  = 'scan_status.json';

// Admin (auth) database
const DU_ADMIN_DB_DIRNAME      = 'database';
const DU_ADMIN_DB_FILENAME     = 'admin.db';
const DU_ADMIN_DB_LEGACY_FILE  = 'admin.sqlite';
const DU_ADMIN_BACKUP_DIRNAME  = 'backups';

// Per-disk SQLite outputs
const DU_DETAIL_DB_DIRNAME     = 'detail_users';
const DU_DETAIL_DB_FILENAME    = 'data_detail.db';
const DU_TREEMAP_DB_DIRNAME    = 'tree_map_data';
const DU_TREEMAP_DB_FILENAME   = 'treemap.db';

// Report-file regex patterns (used by find_file_by_pattern + is-main-report tests)
const DU_INODE_REPORT_PATTERN      = '/.*inode_usage_report.*\\.json$/i';
const DU_PERMISSION_REPORT_PATTERN = '/permission_issue.*\\.json$/i';

// SQLite-backed permission report (next to the JSON above).
// Replaces full JSON streaming parse with LIMIT/OFFSET + WHERE.
const DU_PERMISSION_DB_FILENAME    = 'permission_issues.db';

// Substrings used to classify "is this a main disk-usage report?".
// Kept as substrings (not regex) — they are matched with strpos in
// api_is_main_report_json_filename().
const DU_MAIN_REPORT_TAG       = 'disk_usage_report';
const DU_PERMISSION_REPORT_TAG = 'permission_issue';
const DU_DETAIL_REPORT_TAG     = 'detail_report';
const DU_INODE_REPORT_TAG      = 'inode_usage';
