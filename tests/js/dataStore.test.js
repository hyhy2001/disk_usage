import './setup.mjs'; // MUST be first: dataStore.js -> main.js touches document at load
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataStore } from '../../js/core/dataStore.js';

// Minimal report fixture matching the aggregate payload shape (date in seconds).
function report(date, total, used, teams = [], users = [], other = []) {
    return {
        date, directory: '/srv',
        general_system: { total, used, available: total - used },
        team_usage: teams, user_usage: users, other_usage: other,
    };
}

test('processChunk builds timeline points (date*1000)', () => {
    const ds = new DataStore();
    ds.processChunk([report(100, 1000, 400), report(200, 1000, 600)]);
    const tl = ds.getTimelineData();
    assert.equal(tl.length, 2);
    assert.equal(tl[0].timestamp, 100 * 1000);
    assert.equal(tl[0].used, 400);
});

test('processChunk tracks latest snapshot by newest date', () => {
    const ds = new DataStore();
    // Feed out of order; latest (date=300) must win.
    ds.processChunk([report(300, 2000, 900), report(100, 1000, 400)]);
    const snap = ds.getLatestSnapshot();
    assert.equal(snap.general.total, 2000);
    assert.equal(snap.general.used, 900);
    assert.equal(snap.general.free, 1100);
});

test('processChunk skips malformed reports (no general_system)', () => {
    const ds = new DataStore();
    ds.processChunk([{ date: 1 }, null, report(2, 10, 5)]);
    assert.equal(ds.getTimelineData().length, 1); // only the valid one
});

test('processChunk aggregates team usage and names', () => {
    const ds = new DataStore();
    ds.processChunk([report(100, 1000, 500,
        [{ name: 'Alpha', used: 300, team_id: 1 }, { name: 'Beta', used: 200, team_id: 2 }])]);
    const dist = ds.getTeamDistribution();
    // getTeamDistribution returns sorted name/used pairs — assert both present.
    const names = dist.map(d => d.name ?? d[0]).sort();
    assert.deepEqual(names, ['Alpha', 'Beta']);
    assert.deepEqual(ds.getAllTeamNames(), ['Alpha', 'Beta']);
});

test('processChunk links users to teams via team_id', () => {
    const ds = new DataStore();
    ds.processChunk([report(100, 1000, 500, [],
        [{ name: 'alice', used: 100, team_id: 7 }, { name: 'bob', used: 50, team_id: 7 }])]);
    // getUsersByTeamId returns the user objects for that team (sorted by used desc).
    const teamUsers = ds.getUsersByTeamId(7);
    assert.deepEqual(teamUsers.map(u => u.name), ['alice', 'bob']);
});

test('finalizeProcessing sorts timeline ascending by timestamp', () => {
    const ds = new DataStore();
    ds.processChunk([report(300, 1, 1), report(100, 1, 1), report(200, 1, 1)]);
    ds.finalizeProcessing();
    const ts = ds.getTimelineData().map(p => p.timestamp);
    assert.deepEqual(ts, [100000, 200000, 300000]);
});

test('latest stats reflect newest date across chunks', () => {
    const ds = new DataStore();
    ds.processChunk([report(100, 1000, 400)]);
    ds.processChunk([report(250, 3000, 1500)]);
    const snap = ds.getLatestSnapshot();
    assert.equal(snap.general.used, 1500);
});
