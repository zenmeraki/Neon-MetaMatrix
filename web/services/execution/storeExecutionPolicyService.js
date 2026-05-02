import { storeOperationRepository } from "../../repositories/storeOperationRepository.js";
import { storeOperationalStateRepository } from "../../repositories/storeOperationalStateRepository.js";
import { connection } from "../../Config/redis.js";
import {
  CURRENT_MIRROR_SCHEMA_VERSION,
  isMirrorSchemaCurrent,
} from "../catalogMirrorSchema.js";

const WRITE_TYPES = new Set([
  "BULK_EDIT",
  "SCHEDULED_EDIT",
  "AUTOMATIC_RULE",
  "UNDO",
  "IMPORT",
]);

const DEFAULT_SHOP_OPS_PER_MINUTE_LIMIT = 10;

async function assertShopRateLimit(shop) {
  const limit = Number(
    process.env.SHOP_OPERATION_RATE_LIMIT_PER_MINUTE ||
      DEFAULT_SHOP_OPS_PER_MINUTE_LIMIT,
  );

  if (!Number.isFinite(limit) || limit <= 0) {
    return { allowed: true };
  }

  const key = `shop:${shop}:ops_per_minute`;
  const count = await connection.incr(key);

  if (count === 1) {
    await connection.expire(key, 60);
  }

  if (count > limit) {
    return {
      allowed: false,
      reason: "RATE_LIMIT_EXCEEDED",
      message: "Too many operations were started for this store in the last minute.",
    };
  }

  return { allowed: true };
}

export const storeExecutionPolicyService = {
  async canStartOperation({ shop, operationType }) {
    const state = await storeOperationalStateRepository.getOrCreate(shop);

    if (WRITE_TYPES.has(operationType)) {
      const rateLimit = await assertShopRateLimit(shop);
      if (!rateLimit.allowed) {
        return rateLimit;
      }

      if (!state.activeCatalogBatchId) {
        return {
          allowed: false,
          reason: "INITIAL_SYNC_REQUIRED",
          message: "Initial catalog sync is required before write operations.",
        };
      }

      if (state.catalogConsistencyStatus !== "READY") {
        return {
          allowed: false,
          reason: "CATALOG_NOT_READY",
          message: "Catalog is not ready for write operations.",
        };
      }

      if (!isMirrorSchemaCurrent(state.mirrorSchemaVersion)) {
        return {
          allowed: false,
          reason: "MIRROR_SCHEMA_VERSION_MISMATCH",
          message: `Catalog mirror schema changed. Run a full resync before write operations. Current version: ${state.mirrorSchemaVersion || 0}; required version: ${CURRENT_MIRROR_SCHEMA_VERSION}.`,
        };
      }

      if (state.activeWriteOperationId) {
        return {
          allowed: false,
          reason: "WRITE_OPERATION_RUNNING",
          message: "Another write operation is already running.",
        };
      }

      const activeWrite = await storeOperationRepository.findActiveWriteByShop(shop);

      if (activeWrite) {
        return {
          allowed: false,
          reason: "WRITE_OPERATION_RUNNING",
          message: "Another write operation is already running.",
        };
      }
    }

    return { allowed: true };
  },
};
