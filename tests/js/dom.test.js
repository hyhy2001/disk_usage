import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escHtml, pct } from '../../js/utils/dom.js';

// escHtml is the project's primary XSS defense. Per CLAUDE.md it escapes
// & < > " but intentionally NOT ' (single quote) — so these tests lock that
// contract: anything rendered into a single-quoted attribute must use
// addEventListener, never inline onclick.
test('escHtml escapes ampersand', () => {
    assert.equal(escHtml('a & b'), 'a &amp; b');
});
test('escHtml escapes angle brackets (script injection)', () => {
    assert.equal(escHtml('<script>alert(1)</script>'),
        '&lt;script&gt;alert(1)&lt;/script&gt;');
});
test('escHtml escapes double quote (attribute breakout)', () => {
    assert.equal(escHtml('x" onmouseover="evil'),
        'x&quot; onmouseover=&quot;evil');
});
test('escHtml does NOT escape single quote (documented contract)', () => {
    assert.equal(escHtml("it's"), "it's");
});
test('escHtml escapes ampersand before entities (order matters)', () => {
    // & must be escaped first so an already-injected &lt; becomes &amp;lt;
    assert.equal(escHtml('&lt;'), '&amp;lt;');
});
test('escHtml coerces non-strings', () => {
    assert.equal(escHtml(42), '42');
    assert.equal(escHtml(null), 'null');
});

test('pct computes one-decimal percentage', () => {
    assert.equal(pct(25, 100), '25.0');
    assert.equal(pct(1, 3), '33.3');
});
test('pct returns 0.0 on zero/falsey total (no divide-by-zero)', () => {
    assert.equal(pct(5, 0), '0.0');
    assert.equal(pct(5, null), '0.0');
});
