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
    const keyPrefix = String(key || "");
    const shopPrefix = keyPrefix.includes(":") ? keyPrefix.split(":")[0] : null;

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
          if (!shopPrefix) {
            continue;
          }

          multi.sAdd(`${shopPrefix}:index:product:${cleanProductId}`, key);
          // Set expiration on the index to match the cache TTL
          multi.expire(`${shopPrefix}:index:product:${cleanProductId}`, ttl);
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

// Clear all product caches
export const clearAllCachesForShop = async (shop) => {
  try {
    const keys = await redis.keys(`${shop}*`);
    if (keys.length > 0) {
      await redis.del(keys);
      // logger.info(`Cleared ${keys.length} cache keys`);
    }
    return true;
  } catch (error) {
    // logger.error("Failed to clear caches", { error: error.message });
    throw error;
  }
};

// Clear all product caches
export const clearKeyCaches = async (key) => {
  try {
    const normalizedKey = String(key || "").trim();

    if (!normalizedKey) {
      return true;
    }

    // Get all keys starting with 
    const keys = await redis.keys(`${normalizedKey}*`);

    if (keys.length > 0) {
      await redis.del(keys);
    } else {
    }
    return true;
  } catch (error) {
    // logger.error("Failed to clear caches", { error: error.message });
    throw error;
  }
};

export const getRedisClient = () => redis;
