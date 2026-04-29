import crypto from "crypto";
import { connection as redis } from "../../Config/redis.js";
import { buildShopLockKey } from "../../constants/lockNamespaces.js";

const DEFAULT_LOCK_TTL_MS = 15 * 60 * 1000;

export const storeLockService = {
  async acquire(shop, namespace, ttlMs = DEFAULT_LOCK_TTL_MS) {
    const key = buildShopLockKey(shop, namespace);
    const token = crypto.randomUUID();

    const result = await redis.set(key, token, "PX", ttlMs, "NX");

    if (result !== "OK") {
      return { acquired: false, key };
    }

    return { acquired: true, key, token };
  },

  async release(key, token) {
    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      end
      return 0
    `;

    return redis.eval(script, 1, key, token);
  },
};
