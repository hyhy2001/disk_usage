import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../../js/services/api.js';

// Helper: install a counting fetch mock returning JSON, restore after.
function withFetch(handler, fn) {
    const orig = globalThis.fetch;
    globalThis.fetch = handler;
    return Promise.resolve(fn()).finally(() => { globalThis.fetch = orig; });
}
function jsonResponse(data, ok = true, status = 200) {
    return { ok, status, json: async () => data };
}

test('fetchJson returns parsed JSON', async () => {
    const { fetchJson } = createApiClient();
    await withFetch(async () => jsonResponse({ hello: 'world' }), async () => {
        const d = await fetchJson('/x');
        assert.deepEqual(d, { hello: 'world' });
    });
});

test('throws HTTP <status> on non-2xx', async () => {
    const { fetchJson } = createApiClient();
    await withFetch(async () => jsonResponse(null, false, 503), async () => {
        await assert.rejects(() => fetchJson('/boom'), /HTTP 503/);
    });
});

test('caches GET within cacheTimeMs (one network call)', async () => {
    const { fetchJson } = createApiClient();
    let calls = 0;
    await withFetch(async () => { calls++; return jsonResponse({ n: calls }); }, async () => {
        const a = await fetchJson('/c', { cacheTimeMs: 1000 });
        const b = await fetchJson('/c', { cacheTimeMs: 1000 });
        assert.equal(calls, 1, 'second call served from cache');
        assert.deepEqual(a, b);
    });
});

test('non-cacheable requests always hit network', async () => {
    const { fetchJson } = createApiClient();
    let calls = 0;
    await withFetch(async () => { calls++; return jsonResponse({ n: calls }); }, async () => {
        await fetchJson('/n');           // cacheTimeMs defaults to 0
        await fetchJson('/n');
        assert.equal(calls, 2);
    });
});

test('dedupes concurrent identical inflight requests', async () => {
    const { fetchJson } = createApiClient();
    let calls = 0;
    let resolveFetch;
    const gate = new Promise(r => { resolveFetch = r; });
    await withFetch(async () => { calls++; await gate; return jsonResponse({ ok: true }); }, async () => {
        const p1 = fetchJson('/d', { cacheTimeMs: 1000 });
        const p2 = fetchJson('/d', { cacheTimeMs: 1000 });
        resolveFetch();
        await Promise.all([p1, p2]);
        assert.equal(calls, 1, 'two concurrent calls share one fetch');
    });
});

test('clearCache forces a fresh network call', async () => {
    const { fetchJson, clearCache } = createApiClient();
    let calls = 0;
    await withFetch(async () => { calls++; return jsonResponse({ n: calls }); }, async () => {
        await fetchJson('/k', { cacheTimeMs: 1000 });
        clearCache();
        await fetchJson('/k', { cacheTimeMs: 1000 });
        assert.equal(calls, 2);
    });
});
