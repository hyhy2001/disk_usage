<?php
// lib/keyword.php — shared keyword tokenizer + LIKE-clause builder.
//
// detail.php (file/dir keyword scan) and treemap.php (treemap search) all
// build the same SQL pattern: split a comma-separated query into tokens,
// emit one `<col> LIKE ? COLLATE NOCASE` clause per token, OR them.
// Wildcards ('*') become SQL '%'; bare tokens get %…% wrap.

// Split "a, b*, c" → ["a", "b*", "c"]. Empty tokens dropped. Lowercased.
function api_keyword_tokens($q) {
    $tokens = array();
    if (!is_string($q) || $q === '') return $tokens;
    foreach (explode(',', $q) as $t) {
        $t = strtolower(trim($t));
        if ($t !== '') $tokens[] = $t;
    }
    return $tokens;
}

// Build "(col LIKE ? COLLATE NOCASE OR col LIKE ?…)" + append bind values.
// Returns '' when no usable tokens (caller can fall back / skip filter).
function api_keyword_like_clause($column, $tokens, &$bind) {
    if (empty($tokens) || !is_array($tokens)) return '';
    $parts = array();
    foreach ($tokens as $t) {
        if ($t === '' || !is_string($t)) continue;
        $like = (strpos($t, '*') !== false)
            ? str_replace('*', '%', $t)
            : '%' . $t . '%';
        $parts[] = $column . ' LIKE ? COLLATE NOCASE';
        $bind[] = $like;
    }
    if (empty($parts)) return '';
    return '(' . implode(' OR ', $parts) . ')';
}

// Match a path against a comma-separated keyword query. Supports '*'
// wildcards (anywhere → regex). Returns true when q is empty (no filter).
function api_keyword_match_path($path, $q) {
    $tokens = array_values(array_filter(array_map('trim', explode(',', (string)$q)), 'strlen'));
    if (!$tokens) return true;
    $lc = strtolower((string)$path);
    foreach ($tokens as $t) {
        if (strpos($t, '*') === false) {
            if (strpos($lc, strtolower($t)) !== false) return true;
        } else {
            $re = '/^' . str_replace('\\*', '.*', preg_quote($t, '/')) . '$/i';
            if (@preg_match($re, $path)) return true;
        }
    }
    return false;
}

function api_keyword_fts_match($tokens) {
    if (empty($tokens)) return array('match' => '', 'needs_like' => false);
    $fts_parts = array();
    $needs_like = false;
    foreach ($tokens as $t) {
        $t = strtolower(trim($t));
        if ($t === '') continue;
        $star_pos = strpos($t, '*');
        if ($star_pos === false) {
            $fts_parts[] = $t . '*';
        } elseif ($star_pos === strlen($t) - 1) {
            $fts_parts[] = substr($t, 0, -1) . '*';
        } else {
            $needs_like = true;
        }
    }
    if (empty($fts_parts)) $needs_like = true;
    return array(
        'match' => implode(' ', $fts_parts),
        'needs_like' => $needs_like,
    );
}

function api_keyword_fts_dir_tokens($needle) {
    $parts = preg_split('#[/\\\\\s]+#', strtolower(trim($needle)));
    $parts = array_filter($parts, function($t) { return strlen($t) > 0; });
    return array_values($parts);
}
