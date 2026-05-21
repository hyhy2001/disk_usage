<?php
// lib/disks_walker.php — shared traversal helpers for disks.json.
//
// disks.json may contain three entry shapes at top level:
//   1. flat disk:    { id, name, path, ... }
//   2. project node: { project, teams: [ { name, disks: [...] } ] }
//   3. team node:    { name, disks: [...] }
//
// Handlers historically re-implemented this walk 5×. This module exposes
// three primitives that cover every existing call site.

// Visit every disk entry. Callback receives ($disk, $context):
//   $context = ['project' => string, 'team' => string]
// Stop iteration early by returning false from $callback.
function api_iterate_disks($disks_config, $callback) {
    if (!is_array($disks_config)) return;
    foreach ($disks_config as $entry) {
        if (!is_array($entry)) continue;
        // Shape 1: flat disk
        if (isset($entry['id'])) {
            if ($callback($entry, array('project' => '', 'team' => '')) === false) return;
            continue;
        }
        // Shape 2: project node with teams
        if (isset($entry['project']) && isset($entry['teams']) && is_array($entry['teams'])) {
            $project = (string)$entry['project'];
            foreach ($entry['teams'] as $team) {
                if (!is_array($team) || empty($team['disks']) || !is_array($team['disks'])) continue;
                $team_name = isset($team['name']) ? (string)$team['name'] : '';
                foreach ($team['disks'] as $d) {
                    if (!is_array($d)) continue;
                    if ($callback($d, array('project' => $project, 'team' => $team_name)) === false) return;
                }
            }
            continue;
        }
        // Shape 3: team node
        if (isset($entry['name']) && isset($entry['disks']) && is_array($entry['disks'])) {
            $team_name = (string)$entry['name'];
            foreach ($entry['disks'] as $d) {
                if (!is_array($d)) continue;
                if ($callback($d, array('project' => '', 'team' => $team_name)) === false) return;
            }
        }
    }
}

// Return all disk entries belonging to a team (matched by team name on
// either project.teams[].name or top-level team node).
function api_find_team_disks($disks_config, $team_name) {
    $matches = array();
    if (!is_array($disks_config) || $team_name === '') return $matches;
    foreach ($disks_config as $entry) {
        if (!is_array($entry)) continue;
        if (isset($entry['teams']) && is_array($entry['teams'])) {
            foreach ($entry['teams'] as $t) {
                if (isset($t['name']) && $t['name'] === $team_name
                    && isset($t['disks']) && is_array($t['disks'])) {
                    foreach ($t['disks'] as $d) {
                        if (is_array($d)) $matches[] = $d;
                    }
                }
            }
        }
        if (isset($entry['name']) && $entry['name'] === $team_name
            && isset($entry['disks']) && is_array($entry['disks'])) {
            foreach ($entry['disks'] as $d) {
                if (is_array($d)) $matches[] = $d;
            }
        }
    }
    return $matches;
}

// Count total disk entries across all shapes.
function api_count_disks($disks_config) {
    $count = 0;
    api_iterate_disks($disks_config, function($_d, $_ctx) use (&$count) {
        $count++;
    });
    return $count;
}
