import { LOCK_NS } from "../../constants/lockNamespaces.js";
import { storeLockService } from "./storeLockService.js";

export const storeExecutionLockService = {
  async acquireWriteLock({ shop, operationId, ttlMs = 15 * 60 * 1000 }) {
    const lock = await storeLockService.acquire(shop, LOCK_NS.WRITE_CATALOG, ttlMs);

    return {
      ...lock,
      shop,
      operationId,
    };
  },

  async releaseWriteLock(lock) {
    if (!lock?.key || !lock?.token) {
      return 0;
    }

    return storeLockService.release(lock.key, lock.token);
  },

  async withSyncLock({ shop, syncRunId }, fn) {
    const lock = await storeLockService.acquire(
      shop,
      LOCK_NS.PRODUCT_SYNC,
      30 * 60 * 1000,
    );

    if (!lock.acquired) {
      const error = new Error("SYNC_LOCK_HELD");
      error.code = "SYNC_LOCK_HELD";
      throw error;
    }

    try {
      return await fn({ ...lock, shop, syncRunId });
    } finally {
      await storeLockService.release(lock.key, lock.token);
    }
  },

  async withSnapshotActivationLock({ shop, syncRunId }, fn) {
    const lock = await storeLockService.acquire(
      shop,
      LOCK_NS.PRODUCT_SYNC,
      15 * 60 * 1000,
    );

    if (!lock.acquired) {
      const error = new Error("SNAPSHOT_ACTIVATION_LOCK_HELD");
      error.code = "SNAPSHOT_ACTIVATION_LOCK_HELD";
      throw error;
    }

    try {
      return await fn({ ...lock, shop, syncRunId });
    } finally {
      await storeLockService.release(lock.key, lock.token);
    }
  },
};
