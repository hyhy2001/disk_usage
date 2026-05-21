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
