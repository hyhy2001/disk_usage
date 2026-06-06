import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractExt, normalizeDirRow, normalizeFileRow } from '../../js/services/normalize.js';

test('extractExt lowercases the trailing extension', () => {
    assert.equal(extractExt('/a/b/File.TXT'), 'txt');
    assert.equal(extractExt('archive.tar.GZ'), 'gz');
});
test('extractExt returns ? when no extension', () => {
    assert.equal(extractExt('/a/b/noext'), '?');
    assert.equal(extractExt(''), '?');
    assert.equal(extractExt(null), '?');
});

test('normalizeDirRow maps legacy keys path/p/n and used/s/size', () => {
    assert.deepEqual(normalizeDirRow({ p: '/x', s: 50 }), { path: '/x', used: 50 });
    assert.deepEqual(normalizeDirRow({ path: '/y', used: 9 }), { path: '/y', used: 9 });
    assert.deepEqual(normalizeDirRow({ n: '/z', size: 3 }), { path: '/z', used: 3 });
});
test('normalizeDirRow defaults for bad input', () => {
    assert.deepEqual(normalizeDirRow(null), { path: '', used: 0 });
    assert.deepEqual(normalizeDirRow('nope'), { path: '', used: 0 });
});

test('normalizeFileRow derives xt from path when no ext field (path case preserved)', () => {
    assert.deepEqual(
        normalizeFileRow({ path: '/d/report.LOG', size: 12 }),
        { path: '/d/report.LOG', size: 12, used: 12, xt: 'log' }
    );
});
test('normalizeFileRow prefers explicit xt/x/ext field', () => {
    assert.equal(normalizeFileRow({ path: '/d/x', xt: 'BIN' }).xt, 'bin');
    assert.equal(normalizeFileRow({ path: '/d/x', ext: 'CFG' }).xt, 'cfg');
});
test('normalizeFileRow size aliases s/used and sets used==size', () => {
    const r = normalizeFileRow({ p: '/d/f.txt', s: 7 });
    assert.equal(r.size, 7);
    assert.equal(r.used, 7);
});
test('normalizeFileRow defaults for bad input', () => {
    assert.deepEqual(normalizeFileRow(undefined), { path: '', size: 0, used: 0, xt: '' });
});
