// web/Config/redis.js
import IORedis from "ioredis";
import { Counter, Histogram } from "prom-client";

// ------------------------------------
// Base Redis Connection (for BullMQ too)
// ------------------------------------
export const connection = new IORedis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null, // ✅ Required by BullMQ
  enableReadyCheck: true,
});

export async function waitForRedisReady(timeoutMs = 15000) {
  if (connection.status === "ready") {
    return connection;
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Redis did not become ready within ${timeoutMs}ms`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      connection.off("ready", onReady);
      connection.off("error", onError);
    }

    function onReady() {
      cleanup();
      resolve();
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    connection.once("ready", onReady);
    connection.once("error", onError);
  });

  return connection;
}

// Connection health logging
connection.on("connect", () => {
  console.log("✅ Redis connected successfully");
});
connection.on("error", (err) => {
  console.error("❌ Redis connection error:", err.message);
});

// ------------------------------------
// Metrics (Prometheus)
// ------------------------------------
export const redisMetrics = {
  hits: new Counter({
    name: "redis_cache_hits_total",
    help: "Total Redis cache hits",
    labelNames: ["key"],
  }),
  misses: new Counter({
    name: "redis_cache_misses_total",
    help: "Total Redis cache misses",
    labelNames: ["key"],
  }),
  errors: new Counter({
    name: "redis_cache_errors_total",
    help: "Total Redis cache errors",
    labelNames: ["operation"],
  }),
  invalidations: new Counter({
    name: "redis_cache_invalidations_total",
    help: "Total Redis cache invalidations",
    labelNames: ["shop", "pattern"],
  }),
  latency: new Histogram({
    name: "redis_cache_latency_seconds",
    help: "Redis cache operation latency",
    labelNames: ["operation"],
    buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1],
  }),
};

// ------------------------------------
// Circuit Breaker State
// ------------------------------------
let circuitOpen = false;
let lastFailure = 0;
let failureCount = 0;
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 30_000;

// ------------------------------------
// Safe Redis Wrapper
// ------------------------------------
async function safeRedisOp(op, key, fn) {
  const end = redisMetrics.latency.startTimer({ operation: op });

  // If breaker is open, skip
  if (circuitOpen && Date.now() - lastFailure < COOLDOWN_MS) {
    redisMetrics.errors.inc({ operation: op });
    end();
    return null;
  }

  try {
    const result = await fn();

    // Track cache hits/misses
    if (op === "get") {
      if (result) redisMetrics.hits.inc({ key });
      else redisMetrics.misses.inc({ key });
    }

    // Reset breaker after success
    failureCount = 0;
    end();
    return result;
  } catch (err) {
    failureCount++;
    lastFailure = Date.now();
    if (failureCount >= FAILURE_THRESHOLD) {
      circuitOpen = true;
    }
    redisMetrics.errors.inc({ operation: op });
    console.error(`Redis ${op} failed:`, err.message);
    end();
    return null; // fallback
  }
}

export const redisClient = {
  getRawConnection() {
    return connection;
  },
  isAvailable() {
    return connection.status === "ready" && !circuitOpen;
  },
  getStats() {
    return {
      status: connection.status,
      circuitOpen,
      failureCount,
      lastFailure,
    };
  },
  async get(key) {
    return safeRedisOp("get", key, () => connection.get(key));
  },
  async setEx(key, ttl, value) {
    return safeRedisOp("setEx", key, () => connection.setex(key, ttl, value));
  },
  async del(key) {
    return safeRedisOp("del", key, () => connection.del(key));
  },
  async mget(keys = []) {
    if (!Array.isArray(keys) || keys.length === 0) return [];
    return safeRedisOp("mget", "batch", () => connection.mget(keys));
  },
  async mset(flattened = []) {
    if (!Array.isArray(flattened) || flattened.length === 0) return null;
    return safeRedisOp("mset", "batch", () => connection.mset(flattened));
  },
  async scanKeys(pattern, count = 500) {
    return safeRedisOp("scan", pattern, async () => {
      const keys = [];
      let cursor = "0";

      do {
        const [nextCursor, batch] = await connection.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          count,
        );
        cursor = nextCursor;
        keys.push(...batch);
      } while (cursor !== "0");

      return keys;
    });
  },
  async scanDelete(pattern, count = 500) {
    return safeRedisOp("scanDelete", pattern, async () => {
      let deleted = 0;
      let cursor = "0";

      do {
        const [nextCursor, keys] = await connection.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          count,
        );
        cursor = nextCursor;

        if (keys.length) {
          deleted += await connection.unlink(...keys);
        }
      } while (cursor !== "0");

      return deleted;
    });
  },
};
