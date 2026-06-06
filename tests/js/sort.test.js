import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareDiskCards, extractFromApiDisk } from '../../js/utils/sort.js';

test('extractFromApiDisk computes name/usedPct/free from general_system', () => {
    const r = extractFromApiDisk({ _disk_name: 'Disk-A', general_system: { total: 200, used: 50 } });
    assert.equal(r.name, 'disk-a');
    assert.equal(r.usedPct, 25);
    assert.equal(r.free, 150);
});
test('extractFromApiDisk guards missing/zero total', () => {
    assert.deepEqual(extractFromApiDisk({}), { name: '', usedPct: 0, free: 0 });
    const r = extractFromApiDisk({ _disk_name: 'X', general_system: { total: 0, used: 5 } });
    assert.equal(r.usedPct, 0);
    assert.equal(r.free, 0); // Math.max(0, 0-5)
});

// Sort an array of API disks through compareDiskCards + extractFromApiDisk.
function disks() {
    return [
        { _disk_name: 'Bravo', general_system: { total: 100, used: 90 } }, // 90%
        { _disk_name: 'Alpha', general_system: { total: 100, used: 10 } }, // 10%
        { _disk_name: 'Charlie', general_system: { total: 100, used: 50 } }, // 50%
    ];
}
const names = arr => arr.map(d => d._disk_name);

test('sort alpha-asc by name', () => {
    const out = disks().sort((a, b) => compareDiskCards(a, b, 'alpha-asc', extractFromApiDisk));
    assert.deepEqual(names(out), ['Alpha', 'Bravo', 'Charlie']);
});
test('sort usage-desc by used percentage', () => {
    const out = disks().sort((a, b) => compareDiskCards(a, b, 'usage-desc', extractFromApiDisk));
    assert.deepEqual(names(out), ['Bravo', 'Charlie', 'Alpha']);
});
test('sort free-desc by free space', () => {
    const out = disks().sort((a, b) => compareDiskCards(a, b, 'free-desc', extractFromApiDisk));
    assert.deepEqual(names(out), ['Alpha', 'Charlie', 'Bravo']);
});
test('unknown sort key keeps order (returns 0)', () => {
    assert.equal(compareDiskCards(disks()[0], disks()[1], 'nope', extractFromApiDisk), 0);
});
