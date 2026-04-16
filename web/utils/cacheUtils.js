import { createClient } from "redis";
import logger from "../utils/loggerUtils.js";

// Initialize Redis client
const redis = createClient({
  socket: {
    host: process.env.REDIS_HOST || "localhost",
    port: process.env.REDIS_PORT || 6379,
  },
  password: process.env.REDIS_PASSWORD || "",
  prefix: "shopify:products:",
});
// Initialize Redis connection
(async () => {
  try {
    await redis.connect();
    logger.info("Redis connection established.");
  } catch (err) {
    logger.error("Redis connection failed:", { error: err.message });
  }
})();

export const normalizeQuery = (query) => {
  if (!query) return "";
  return query.trim().toLowerCase();
};

export const setCache = async (key, data, ttl = 3600) => {
  try {
    // Store the data
    await redis.set(key, JSON.stringify(data), { EX: ttl });

    // Index the products included in this query result
    if (Array.isArray(data)) {
      // Start a Redis multi for better performance
      const multi = redis.multi();

      for (const product of data) {
        if (product.id) {
          // Strip any prefixes from product ID if needed
          const cleanProductId = product.id.includes("/")
            ? product.id.split("/").pop()
            : product.id;

          // Add this query key to the product's index set
          multi.sAdd(`index:product:${cleanProductId}`, key);
          // Set expiration on the index to match the cache TTL
          multi.expire(`index:product:${cleanProductId}`, ttl);
        }
      }

      await multi.exec();
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
    const cachedData = await redis.get(key);
    return cachedData ? JSON.parse(cachedData) : null;
  } catch (error) {
    // logger.error("Failed to get cache", { key, error: error.message });
    return null; // Fail gracefully with cache misses
  }
};

/**
 * Delete all Redis keys matching a glob pattern using non-blocking SCAN.
 * redis.keys() is O(N) and blocks the server; scanIterator pages through
 * the keyspace incrementally so it is safe under production load.
 */
const scanAndDelete = async (pattern) => {
  const pending = [];

  for await (const key of redis.scanIterator({ MATCH: pattern, COUNT: 200 })) {
    pending.push(key);
    if (pending.length >= 500) {
      await redis.del(pending.splice(0, pending.length));
    }
  }

  if (pending.length > 0) {
    await redis.del(pending);
  }
};

export const clearAllCachesForShop = async (shop) => {
  try {
    await scanAndDelete(`${shop}*`);
    return true;
  } catch (error) {
    throw error;
  }
};

export const clearKeyCaches = async (key) => {
  try {
    await scanAndDelete(`${key}*`);
    return true;
  } catch (error) {
    throw error;
  }
};

export const getRedisClient = () => redis;