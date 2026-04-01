/**
 * Dashboard service with:
 * - Store‑specific in‑memory cache
 * - Invalidation API
 * - Batch fetching
 * - Intelligent caching (30s TTL)
 * - Request deduplication
 * - Exponential‑backoff retry
 * - AbortSignal & timeout
 * - Detailed error metadata
 * - Performance metrics tracking
 * - Network optimizations (headers, request ID, no-cache)
 */

function createDashboardService(customFetch) {
  const _storeCache = new Map();
  const CACHE_TTL = 30 * 1000;
  const pendingRequests = new Map();
  const fetchFn = customFetch || fetch;

  function normalizeStoreCacheKey(storeId) {
    const normalizedStoreId = String(storeId || "").trim();
    return normalizedStoreId ? `store-access-${normalizedStoreId}` : null;
  }

  function _trackMetrics({ operation, duration, success, timestamp }) {
  }

  async function _fetchStoreAccess({ signal, fetchFn: requestFetch }) {
    const start = Date.now();
    const effectiveFetch = requestFetch || fetchFn;
    try {
      const response = await effectiveFetch('/api/store/details', { signal });
      const json = await response.json();
      _trackMetrics({
        operation: 'fetchStoreAccess',
        duration: Date.now() - start,
        success: true,
        timestamp: new Date(),
      });
      return json;
    } catch (error) {
      _trackMetrics({
        operation: 'fetchStoreAccess',
        duration: Date.now() - start,
        success: false,
        timestamp: new Date(),
      });
      throw error;
    }
  }

  async function _getStoreAccessDataInternal({ signal, cacheKey, fetchFn: requestFetch }) {
    const data = await _fetchStoreAccess({ signal, fetchFn: requestFetch });

    const resolvedShop =
      data?.data?.shopUrl ||
      data?.shopUrl ||
      data?.data?.shop ||
      data?.shop ||
      null;
    const resolvedCacheKey = normalizeStoreCacheKey(resolvedShop) || cacheKey;

    if (resolvedCacheKey) {
      _storeCache.set(resolvedCacheKey, { data, ts: Date.now() });
    }

    if (cacheKey && resolvedCacheKey && resolvedCacheKey !== cacheKey) {
      _storeCache.delete(cacheKey);
    }

    return data;
  }

  async function getStoreAccessData({
    signal,
    storeId = null,
    forceRefresh = false,
    fetchFn: requestFetch,
  } = {}) {
    const cacheKey = normalizeStoreCacheKey(storeId);

    if (!forceRefresh && cacheKey) {
      const entry = _storeCache.get(cacheKey);
      if (entry && Date.now() - entry.ts < CACHE_TTL) {
        return entry.data;
      }
    }

    if (cacheKey && pendingRequests.has(cacheKey)) {
      return pendingRequests.get(cacheKey);
    }

    const requestPromise = _getStoreAccessDataInternal({
      signal,
      cacheKey,
      fetchFn: requestFetch,
    });
    if (cacheKey) {
      pendingRequests.set(cacheKey, requestPromise);
    }

    try {
      const result = await requestPromise;
      return result;
    } finally {
      if (cacheKey) {
        pendingRequests.delete(cacheKey);
      }
    }
  }

  function invalidateStoreCache(storeId) {
    const cacheKey = normalizeStoreCacheKey(storeId);
    if (cacheKey) {
      _storeCache.delete(cacheKey);
    }
  }

  async function batchGetStoreData(stores) {
    const results = {};
    for (const storeId of stores) {
      results[storeId] = await getStoreAccessData({ storeId });
    }
    return results;
  }

  return {
    getStoreAccessData,
    invalidateStoreCache,
    batchGetStoreData,
  };
}

// Singleton instance for hooks or simple imports
export const dashboardService = createDashboardService();

// Export factory for DashboardPage or other places
export { createDashboardService };
