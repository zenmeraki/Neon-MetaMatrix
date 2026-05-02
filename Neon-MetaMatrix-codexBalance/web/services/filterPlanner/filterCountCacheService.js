import { getCache, setCache } from "../../utils/cacheUtils.js";

const DEFAULT_COUNT_CACHE_TTL_SECONDS = Number(
  process.env.FILTER_COUNT_CACHE_TTL_SECONDS || 60,
);

function buildCountCacheKey({ shop, mirrorBatchId, canonicalFilterKey }) {
  return [
    shop,
    "filterCount",
    mirrorBatchId,
    canonicalFilterKey || "empty",
  ].join(":");
}

export const filterCountCacheService = {
  async get({ shop, mirrorBatchId, canonicalFilterKey }) {
    const cached = await getCache(
      buildCountCacheKey({ shop, mirrorBatchId, canonicalFilterKey }),
    );

    return Number.isFinite(Number(cached)) ? Number(cached) : null;
  },

  async set({ shop, mirrorBatchId, canonicalFilterKey, count, ttlSeconds }) {
    try {
      await setCache(
        buildCountCacheKey({ shop, mirrorBatchId, canonicalFilterKey }),
        Number(count) || 0,
        ttlSeconds || DEFAULT_COUNT_CACHE_TTL_SECONDS,
      );
    } catch {
      // Count caching must never fail the primary SQL path.
    }
  },
};
