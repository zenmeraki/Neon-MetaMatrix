import { redisClient } from "../Config/redis.js";
import { LRUCache } from "lru-cache";

const localQueryCache = new LRUCache({
  max: 500,
  ttl: 1000 * 5,
  allowStale: false,
});

export const normalizeQuery = (query) => {
  if (!query) return "";
  return query.trim().toLowerCase();
};

export const setCache = async (key, data, ttl = 3600) => {
  try {
    localQueryCache.set(key, data, { ttl: Math.max(Number(ttl) || 1, 1) * 1000 });

    // Store the data
    await redisClient.setEx(key, ttl, JSON.stringify(data));

    // Index the products included in this query result
    if (Array.isArray(data)) {
      const pipeline = redisClient.getRawConnection().pipeline();

      for (const product of data) {
        if (product.id) {
          // Strip any prefixes from product ID if needed
          const cleanProductId = product.id.includes("/")
            ? product.id.split("/").pop()
            : product.id;

          // Add this query key to the product's index set
          pipeline.sadd(`index:product:${cleanProductId}`, key);
          // Set expiration on the index to match the cache TTL
          pipeline.expire(`index:product:${cleanProductId}`, ttl);
        }
      }

      await pipeline.exec();
    }

    // logger.debug(`Cache set for key: ${key}`, { ttl });
  } catch (error) {
    // logger.error("Failed to set cache", { key, error: error.message });
    throw error;
  }
};

// Get cached data
export const getCache = async (key) => {
  try {
    const localValue = localQueryCache.get(key);
    if (localValue !== undefined) {
      return localValue;
    }

    const cachedData = await redisClient.get(key);
    const parsed = cachedData ? JSON.parse(cachedData) : null;

    if (parsed !== null) {
      localQueryCache.set(key, parsed);
    }

    return parsed;
  } catch (error) {
    // logger.error("Failed to get cache", { key, error: error.message });
    return null; // Fail gracefully with cache misses
  }
};

// Clear all product caches
export const clearAllCachesForShop = async (shop) => {
  try {
    for (const key of localQueryCache.keys()) {
      if (key.startsWith(`${shop}`)) {
        localQueryCache.delete(key);
      }
    }

    await redisClient.scanDelete(`${shop}*`);
    return true;
  } catch (error) {
    // logger.error("Failed to clear caches", { error: error.message });
    throw error;
  }
};

// Clear all product caches
export const clearKeyCaches = async (key) => {
  try {
    for (const cacheKey of localQueryCache.keys()) {
      if (cacheKey.startsWith(key)) {
        localQueryCache.delete(cacheKey);
      }
    }

    await redisClient.scanDelete(`${key}*`);
    return true;
  } catch (error) {
    // logger.error("Failed to clear caches", { error: error.message });
    throw error;
  }
};

export const clearKeyCachesBatch = async (keys = []) => {
  const safeKeys = [...new Set((Array.isArray(keys) ? keys : []).filter(Boolean))];

  if (!safeKeys.length) {
    return 0;
  }

  for (const prefix of safeKeys) {
    for (const cacheKey of localQueryCache.keys()) {
      if (cacheKey.startsWith(prefix)) {
        localQueryCache.delete(cacheKey);
      }
    }
  }

  const deletions = await Promise.all(
    safeKeys.map((prefix) => redisClient.scanDelete(`${prefix}*`)),
  );

  return deletions.reduce((sum, count) => sum + (Number(count) || 0), 0);
};

export const getRedisClient = () => redisClient.getRawConnection();
