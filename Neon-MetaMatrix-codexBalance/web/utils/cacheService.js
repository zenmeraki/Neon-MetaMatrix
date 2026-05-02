// web/services/cacheService.js - PRODUCTION-GRADE
import crypto from "crypto";
import { redisClient, redisMetrics } from "../Config/redis.js";
import { LRUCache } from "lru-cache";


export const lruCache = new LRUCache({
  max: 1000, // Store up to 1000 items
  maxSize: 100 * 1024 * 1024, // 100MB max
  sizeCalculation: (value) => {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  },
  ttl: 1000 * 60 * 5, // 5 minutes default
  allowStale: true, // Return stale data if Redis is down
  updateAgeOnGet: true,
  updateAgeOnHas: false,
});

// ============================================
// 🔥 CACHE KEY PATTERNS
// ============================================

const CachePrefix = {
  PRODUCT: "prod",
  PRODUCTS_LIST: "prods",
  VARIANT: "var",
  VARIANTS_LIST: "vars",
  EDIT_HISTORY: "edit",
  CHANGE_RECORDS: "changes",
  FILTER: "filter",
  COUNT: "count",
  SEARCH: "search",
  SYNC_DETAILS: "sync",
};

// ============================================
// 🔥 CACHE KEY GENERATOR
// ============================================

class CacheKeyBuilder {
  static product(shopDomain, productId) {
    return `${shopDomain}:${CachePrefix.PRODUCT}:${productId}`;
  }

  static productsList(shopDomain, filters = {}, page = 1, limit = 50) {
    const filterHash = this.hashFilters(filters);
    return `${shopDomain}:${CachePrefix.PRODUCTS_LIST}:${filterHash}:${page}:${limit}`;
  }

  static variant(shopDomain, variantId) {
    return `${shopDomain}:${CachePrefix.VARIANT}:${variantId}`;
  }

  static variantsList(shopDomain, productId) {
    return `${shopDomain}:${CachePrefix.VARIANTS_LIST}:${productId}`;
  }

  static editHistory(shopDomain, editHistoryId) {
    return `${shopDomain}:${CachePrefix.EDIT_HISTORY}:${editHistoryId}`;
  }

  static changeRecords(shopDomain, editHistoryId, page = 1) {
    return `${shopDomain}:${CachePrefix.CHANGE_RECORDS}:${editHistoryId}:${page}`;
  }

  static productCount(shopDomain, filters = {}) {
    const filterHash = this.hashFilters(filters);
    return `${shopDomain}:${CachePrefix.COUNT}:${filterHash}`;
  }

  static search(shopDomain, query, page = 1) {
    const normalizedQuery = query.trim().toLowerCase();
    const queryHash = crypto
      .createHash("md5")
      .update(normalizedQuery)
      .digest("hex")
      .substring(0, 8);
    return `${shopDomain}:${CachePrefix.SEARCH}:${queryHash}:${page}`;
  }

  static filterCombination(shopDomain, filterHash) {
    return `${shopDomain}:${CachePrefix.FILTER}:${filterHash}`;
  }

  static syncDetails(shopDomain) {
    return `${shopDomain}:${CachePrefix.SYNC_DETAILS}`;
  }

  // Hash filters for cache key
  static hashFilters(filters) {
    if (!filters || Object.keys(filters).length === 0) {
      return "all";
    }

    const sortedFilters = Object.keys(filters)
      .sort()
      .reduce((acc, key) => {
        acc[key] = filters[key];
        return acc;
      }, {});

    return crypto
      .createHash("md5")
      .update(JSON.stringify(sortedFilters))
      .digest("hex")
      .substring(0, 8);
  }
}

// ============================================
// 🔥 CACHE SERVICE
// ============================================

class CacheService {
  // === GET WITH FALLBACK ===
  async get(key, shopDomain, category = "general") {
    const localValue = lruCache.get(key);
    if (localValue !== undefined) {
      return localValue;
    }

    const cached = await redisClient.get(key, shopDomain, category);

    if (cached === null) {
      return null;
    }

    try {
      const parsed = JSON.parse(cached);
      lruCache.set(key, parsed);
      return parsed;
    } catch (err) {
      // Return as-is if not JSON
      lruCache.set(key, cached);
      return cached;
    }
  }

  // === SET WITH TTL ===
  async set(key, value, ttl = 300, shopDomain, category = "general") {
    const serialized =
      typeof value === "string" ? value : JSON.stringify(value);
    lruCache.set(key, value, { ttl: ttl * 1000 });
    return redisClient.setEx(key, ttl, serialized, shopDomain, category);
  }

  // === DELETE ===
  async del(key, shopDomain, category = "general") {
    lruCache.delete(key);
    return redisClient.del(key, shopDomain, category);
  }

  // === WRAP PATTERN ===
  async wrap(key, fetchFn, ttl = 300, shopDomain, category = "general") {
    // Try cache first
    const cached = await this.get(key, shopDomain, category);
    if (cached !== null) {
      return cached;
    }

    // Fetch fresh data
    const fresh = await fetchFn();

    // Store in cache
    if (fresh !== null && fresh !== undefined) {
      await this.set(key, fresh, ttl, shopDomain, category);
    }

    return fresh;
  }

  // ============================================
  // 🔥 PRODUCT CACHING
  // ============================================

  async getProduct(shopDomain, productId) {
    const key = CacheKeyBuilder.product(shopDomain, productId);
    return this.get(key, shopDomain, "product");
  }

  async setProduct(shopDomain, productId, product, ttl = 600) {
    const key = CacheKeyBuilder.product(shopDomain, productId);
    return this.set(key, product, ttl, shopDomain, "product");
  }

  async getProductsList(shopDomain, filters, page, limit) {
    const key = CacheKeyBuilder.productsList(shopDomain, filters, page, limit);
    return this.get(key, shopDomain, "products_list");
  }

  async setProductsList(shopDomain, filters, page, limit, products, ttl = 300) {
    const key = CacheKeyBuilder.productsList(shopDomain, filters, page, limit);
    return this.set(key, products, ttl, shopDomain, "products_list");
  }

  // ============================================
  // 🔥 EFFICIENT INVALIDATION (No .keys())
  // ============================================

  // Invalidate single product and related lists
  async invalidateProduct(shopDomain, productId) {
    // Delete single product cache
    const productKey = CacheKeyBuilder.product(shopDomain, productId);
    await this.del(productKey, shopDomain, "product");

    // Invalidate all product lists for this shop
    // Use Redis SET to track active list keys
    const listTrackingKey = `${shopDomain}:${CachePrefix.PRODUCTS_LIST}:tracking`;
    const listKeys = await redisClient
      .getRawConnection()
      .smembers(listTrackingKey);

    if (listKeys && listKeys.length > 0) {
      // Delete in batches
      const pipeline = redisClient.getRawConnection().pipeline();
      listKeys.forEach((key) => pipeline.del(key));
      await pipeline.exec();

      // Clear tracking set
      await redisClient.getRawConnection().del(listTrackingKey);
    }

    // Also clear LRU entries
    lruCache.delete(productKey);

    redisMetrics.invalidations.inc({
      shop: shopDomain,
      pattern: "product",
    });
  }

  // Invalidate all products for a shop
  async invalidateAllProducts(shopDomain) {
    // Use tracking set approach
    const trackingKey = `${shopDomain}:tracking`;
    const allKeys = await redisClient.getRawConnection().smembers(trackingKey);

    if (allKeys && allKeys.length > 0) {
      const pipeline = redisClient.getRawConnection().pipeline();
      allKeys.forEach((key) => pipeline.del(key));
      await pipeline.exec();

      await redisClient.getRawConnection().del(trackingKey);
    }

    // Clear LRU for this shop
    // LRU doesn't support pattern deletion, so we have to iterate
    for (const key of lruCache.keys()) {
      if (key.startsWith(`${shopDomain}:`)) {
        lruCache.delete(key);
      }
    }

    redisMetrics.invalidations.inc({
      shop: shopDomain,
      pattern: "all",
    });
  }

  // ============================================
  // 🔥 CACHE TRACKING (Solves .keys() Problem)
  // ============================================

  // When setting cache, also add to tracking set
  async setWithTracking(key, value, ttl, shopDomain, category = "general") {
    // Set the cache
    await this.set(key, value, ttl, shopDomain, category);

    // Add to tracking set
    const trackingKey = `${shopDomain}:tracking`;
    await redisClient.getRawConnection().sadd(trackingKey, key);

    // Set TTL on tracking set (same as cache)
    await redisClient.getRawConnection().expire(trackingKey, ttl);
  }

  // ============================================
  // 🔥 BATCH OPERATIONS
  // ============================================

  async mget(keys, shopDomain, category = "general") {
    const values = await redisClient.mget(keys, shopDomain, category);

    if (!values) return [];

    return values.map((v) => {
      if (v === null) return null;
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    });
  }

  async mset(keyValuePairs, ttl, shopDomain, category = "general") {
    // Convert to flat array for Redis MSET
    const flattened = [];
    for (const [key, value] of Object.entries(keyValuePairs)) {
      flattened.push(key);
      flattened.push(typeof value === "string" ? value : JSON.stringify(value));
    }

    await redisClient.mset(flattened, shopDomain, category);

    // Set TTL for each key
    const pipeline = redisClient.getRawConnection().pipeline();
    Object.keys(keyValuePairs).forEach((key) => {
      pipeline.expire(key, ttl);
    });
    await pipeline.exec();

    return true;
  }

  // ============================================
  // 🔥 STATS & MONITORING
  // ============================================

  getStats() {
    return redisClient.getStats();
  }

  isAvailable() {
    return redisClient.isAvailable();
  }
}

export default new CacheService();
export { CacheKeyBuilder };
