import test from "node:test";
import assert from "node:assert/strict";
import * as refreshLock from "./services/productService/productTypeRefreshLockService.js";
import { classifyRetry } from "./utils/errorTaxonomy.js";

class FakeRedis {
  constructor() {
    this.map = new Map();
  }

  async set(key, value, ...args) {
    const mode = String(args[2] || "").toUpperCase();
    if (mode === "NX" && this.map.has(key)) {
      return null;
    }
    this.map.set(key, String(value));
    return "OK";
  }

  async eval(_script, _numKeys, key, token, ttlOrUndefined) {
    const current = this.map.get(key);
    if (current !== String(token)) return 0;
    if (ttlOrUndefined !== undefined) return 1;
    this.map.delete(key);
    return 1;
  }

  async get(key) {
    return this.map.get(key) || null;
  }
}

test("lock ownership contract: only owner token can release lock", async () => {
  const redis = new FakeRedis();
  const key = "s:lock";
  const owner = "owner-a";
  const other = "owner-b";
  const acquired = await refreshLock.acquireRedisLock(redis, key, owner, 30);
  assert.equal(acquired, true);

  await refreshLock.releaseRedisLock(redis, key, other);
  assert.equal(await redis.get(key), owner);

  await refreshLock.releaseRedisLock(redis, key, owner);
  assert.equal(await redis.get(key), null);
});

test("stale lock contract: expired/missing token cannot be heartbeated by another owner", async () => {
  const redis = new FakeRedis();
  const key = "s:lock";
  const owner = "owner-a";
  await refreshLock.acquireRedisLock(redis, key, owner, 30);

  const refreshedByOther = await refreshLock.refreshRedisLock(redis, key, "owner-b", 30);
  assert.equal(refreshedByOther, false);

  const refreshedByOwner = await refreshLock.refreshRedisLock(redis, key, owner, 30);
  assert.equal(refreshedByOwner, true);
});

test("retry-class contract: force cooldown maps to RETRY_BLOCKED", () => {
  assert.equal(classifyRetry("FORCE_SYNC_COOLDOWN_ACTIVE"), "RETRY_BLOCKED");
});
