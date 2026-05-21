/**
 * api.js — Shared HTTP/JSON helpers for the dashboard.
 *
 * Two consumers:
 *   - dataFetcher.js (sync flow, treemap, permissions, scan_status)
 *   - any future renderer that needs idempotent GET dedup + short-window cache
 *
 * Note: features/group-user/groupUserManager.js has its own fetchJson with a
 * legacy base64-payload fallback. That fallback is specific to that flow and
 * intentionally kept there — do NOT route group-user calls through this module.
 */

/**
 * Create a fetch helper with a per-instance cache + inflight-dedup map.
 *
 * Behavior:
 *   - GET requests with cacheTimeMs > 0 are served from cache when fresh.
 *   - Concurrent identical requests share one in-flight Promise.
 *   - Non-cacheable requests (cacheTimeMs = 0) bypass both caches.
 *   - Throws Error('HTTP <status> from <url>') on non-2xx.
 *
 * @returns {{ fetchJson: (url:string, opts?:{signal?:AbortSignal, cacheTimeMs?:number}) => Promise<any>,
 *             clearCache: () => void }}
 */
export function createApiClient() {
    const cache = new Map();     // url -> { time, data }
    const inflight = new Map();  // url -> Promise

    async function fetchJson(url, { signal, cacheTimeMs = 0 } = {}) {
        if (cacheTimeMs > 0) {
            const hit = cache.get(url);
            if (hit && (Date.now() - hit.time) < cacheTimeMs) return hit.data;
            const pending = inflight.get(url);
            if (pending) return pending;
        }

        const exec = (async () => {
            const res = await fetch(url, { signal });
            if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
            const data = await res.json();
            if (cacheTimeMs > 0) cache.set(url, { time: Date.now(), data });
            return data;
        })();

        if (cacheTimeMs > 0) {
            inflight.set(url, exec);
            exec.finally(() => inflight.delete(url));
        }
        return exec;
    }

    function clearCache() {
        cache.clear();
        inflight.clear();
    }

    return { fetchJson, clearCache };
}
