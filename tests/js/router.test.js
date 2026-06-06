import './setup.mjs'; // MUST be first: router.js -> main.js touches document at load
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDetailTabFromUrl, setRouteContext } from '../../js/core/router.js';

// parseRoute() is module-private; getDetailTabFromUrl() is the exported window
// onto it. It reads window.location.hash, so we set that and assert the parsed
// detail tab. This locks the hash-route -> tab slug mapping.
function withHash(hash, fn) {
    globalThis.window.location = { hash, href: 'http://x/' + hash };
    fn();
}

// NOTE on URL shapes: a bare `#/detail/<slug>` only works for `latest`. For a
// specific tab, parseRoute treats the first two segments as team/disk, so the
// tab slug must come via the deep route `#/<team>/<disk>/detail/<slug>`. These
// tests use that real shape (matching how the app links tabs).
test('empty hash resolves to snapshot tab', () => {
    withHash('', () => assert.equal(getDetailTabFromUrl(), 'snapshot'));
});
test('bare detail/latest -> snapshot', () => {
    withHash('#/detail/latest', () => assert.equal(getDetailTabFromUrl(), 'snapshot'));
});
test('deep route detail/permission -> permissions tab', () => {
    withHash('#/Alpha/disk_sda/detail/permission', () => assert.equal(getDetailTabFromUrl(), 'permissions'));
});
test('deep route detail/detail-user -> user-detail tab', () => {
    withHash('#/Alpha/disk_sda/detail/detail-user', () => assert.equal(getDetailTabFromUrl(), 'user-detail'));
});
test('deep route detail/treemap -> treemap tab', () => {
    withHash('#/Alpha/disk_sda/detail/treemap', () => assert.equal(getDetailTabFromUrl(), 'treemap'));
});
test('deep route detail/inode -> inodes tab', () => {
    withHash('#/Alpha/disk_sda/detail/inode', () => assert.equal(getDetailTabFromUrl(), 'inodes'));
});
test('deep route detail/history -> history tab', () => {
    withHash('#/Alpha/disk_sda/detail/history', () => assert.equal(getDetailTabFromUrl(), 'history'));
});
test('deep route with invalid slug falls back to snapshot', () => {
    withHash('#/Alpha/disk_sda/detail/bogus', () => assert.equal(getDetailTabFromUrl(), 'snapshot'));
});

test('setRouteContext merges without throwing (no DOM needed)', () => {
    // Pure object merge; just assert it is callable and returns undefined.
    assert.equal(setRouteContext({ team: 'X', disk: 'd1' }), undefined);
});
