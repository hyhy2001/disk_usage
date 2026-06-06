import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CSS layout-regression guard.
//
// Background: merging bar-rows.css into detail-page.css (commit 1216da1)
// accidentally hoisted several rules OUT of an @media block into global scope,
// and dropped a few global properties entirely — changing the desktop layout
// of the General System block and the filter sidebar. The render-invariance
// "oracle" used at merge time missed it because its CSS parser advanced two
// tokens past a rule body (k+=2), which made the closing `}` of a rule look
// like the close of the enclosing @media — so every rule after the first in a
// media block was mis-attributed to global scope.
//
// This guard re-implements the parser CORRECTLY (skip `{`, body, AND `}`) and
// asserts a handful of known desktop (global-scope) layout invariants. It will
// fail if any of these rules leak into / out of a media query again, or get
// dropped during a future CSS refactor. Keep the list small and specific so it
// stays false-positive-free.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARTS = path.resolve(__dirname, '../../css/components/parts');

// Files in the order _index.css imports them (cascade order).
function importOrder() {
    const idx = fs.readFileSync(path.join(PARTS, '_index.css'), 'utf8');
    return [...idx.matchAll(/@import\s+['"]\.\/([^'"]+)['"]/g)].map(m => m[1]);
}

// Computed value of (selector, prop) at GLOBAL scope (outside every @media),
// last-wins across all part files in cascade order. Returns null if unset.
function globalWinner(selector, prop) {
    let val = null;
    for (const fn of importOrder()) {
        const fp = path.join(PARTS, fn);
        if (!fs.existsSync(fp)) continue;
        const css = fs.readFileSync(fp, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        const toks = css.split(/(\{|\})/);
        let k = 0, ctx = [], buf = '';
        while (k < toks.length) {
            const t = toks[k];
            if (t === '{') {
                const head = buf.trim(); buf = '';
                if (head.startsWith('@')) { ctx.push(head); k++; continue; }
                const body = toks[k + 1] || '';
                if (ctx.length === 0) {
                    for (const s of head.split(',')) {
                        if (s.trim() !== selector) continue;
                        for (const d of body.split(';')) {
                            const c = d.indexOf(':');
                            if (c > 0 && d.slice(0, c).trim() === prop) val = d.slice(c + 1).trim();
                        }
                    }
                }
                k += 3; buf = ''; continue; // skip `{`, body, `}`
            } else if (t === '}') {
                if (ctx.length) ctx.pop();
                buf = ''; k++; continue;
            } else { buf += t; k++; }
        }
    }
    return val;
}

// Desktop (global-scope) layout invariants for the General System block and
// the filter sidebar — the rules that regressed in 1216da1.
const INVARIANTS = [
    ['.general-val-col', 'flex-direction', 'column'],     // value col stacks on desktop
    ['.general-val-col', 'align-items', 'flex-end'],      // values right-aligned
    ['.general-row.sbar-row', 'grid-template-columns',
        'minmax(0, 70px) 1fr minmax(0, 54px) minmax(0, auto)'], // General uses its own 3-col grid
    ['.filter-sidebar', 'max-height', 'calc(100vh - 64px)'], // sidebar can scroll (paired w/ overflow-y)
];

for (const [sel, prop, expected] of INVARIANTS) {
    test(`global ${sel} { ${prop} } === ${expected}`, () => {
        assert.equal(globalWinner(sel, prop), expected,
            `${sel} ${prop} changed at global scope — a rule may have leaked into/out of @media or been dropped`);
    });
}

// Sanity: the parser must NOT see a known mobile-only override at global scope.
// .general-row .sbar-pct{display:none} lives ONLY inside @media(max-width:640px).
test('mobile-only .general-row .sbar-pct display:none does NOT apply at global scope', () => {
    assert.equal(globalWinner('.general-row .sbar-pct', 'display'), null);
});
