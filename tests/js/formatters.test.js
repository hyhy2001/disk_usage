import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmt, smartFmt, smartFmtTick, pickUnit } from '../../js/utils/formatters.js';

test('fmt returns em-dash for null/undefined', () => {
    assert.equal(fmt(null), '—');
    assert.equal(fmt(undefined), '—');
});
test('fmt picks TB/GB/MB/KB/B thresholds (decimal units)', () => {
    assert.equal(fmt(2e12), '2.00 TB');
    assert.equal(fmt(3e9), '3.0 GB');
    assert.equal(fmt(5e6), '5 MB');
    assert.equal(fmt(7e3), '7 KB');
    assert.equal(fmt(512), '512 B');
});

test('smartFmt uses decimal (1e3) units and handles zero', () => {
    assert.equal(smartFmt(0), '0 B');
    assert.equal(smartFmt(1e12), '1.00 TB');
    assert.equal(smartFmt(1.5e9), '1.50 GB');
});

test('smartFmtTick compact labels with sign', () => {
    assert.equal(smartFmtTick(0), '0');
    assert.equal(smartFmtTick(1e12), '1.0T');
    assert.equal(smartFmtTick(-2e9), '-2.0G');
});

test('pickUnit selects divisor+unit from max magnitude', () => {
    assert.deepEqual(pickUnit([1e12, 5e11]), { divisor: 1e12, unit: 'TB' });
    assert.deepEqual(pickUnit([100, 200]), pickUnit([100, 200])); // stable
    assert.equal(pickUnit([5e9]).unit, 'GB');
});
