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
  async get(key) {
    return safeRedisOp("get", key, () => connection.get(key));
  },
  async setEx(key, ttl, value) {
    return safeRedisOp("setEx", key, () => connection.setex(key, ttl, value));
  },
  async del(key) {
    return safeRedisOp("del", key, () => connection.del(key));
  },
};