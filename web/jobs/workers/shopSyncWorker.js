import { Worker } from "bullmq";
import { connection } from "../../config/redis.js";
import { prisma } from "../../config/database.js";
import logger from "../../utils/loggerUtils.js";
import { getSession } from "../../utils/sessionHandler.js";
import { getCurrentBulkOperationStatus } from "../../modules/bulkOperations/bulkOperationHelper.js";
import { productFilterService } from "../../services/productService/productFilterService.js";
import { CollectionService } from "../../services/collectionService/CollectionService.js";
import shopify from "../../shopify.js";
import {
  markCollectionReconciliationPending,
  markInventoryReconciliationPending,
  markRepairRequired,
  MIRROR_STALE_REASONS,
} from "../../services/mirrorHealthService.js";
import { recordMirrorAnomaly } from "../../services/mirrorAnomalyService.js";
import {
  acquireExclusiveShopWork,
  extendExclusiveShopWork,
  releaseExclusiveShopWork,
} from "../../services/shopWorkLeaseService.js";
import { getJobAttempt, isRetryExhausted, recordRetryExhausted } from "../../utils/workerTelemetry.js";

const QUEUE_NAME = process.env.SHOP_SYNC_QUEUE || "shop-sync-trigger";
const SHOP_SYNC_LEASE_HEARTBEAT_MS = Math.max(
  Number(process.env.SHOP_SYNC_LEASE_HEARTBEAT_MS || 30_000),
  5_000,
);

const collectionService = new CollectionService(shopify);

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const shopSyncWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { shop, syncType, reason } = job.data;
    if (!shop || !syncType) {
      throw codedError("SHOP_SYNC_PAYLOAD_INVALID", "shop-sync job requires shop and syncType");
    }

    const store = await prisma.store.findUnique({
      where: { shopUrl: shop },
      select: { isUnInstalled: true },
    });

    if (!store || store.isUnInstalled) {
      return {
        skipped: true,
        reason: "shop_unavailable",
      };
    }

    let exclusiveShopLockKey = null;
    let leaseHeartbeat = null;
    const executionId =
      job.data.syncRunId ||
      job.data.operationId ||
      `shop-sync:${syncType}:${shop}:${job.id || "unknown"}`;

    try {
      const exclusiveLock = await acquireExclusiveShopWork({
        shop,
        activity: `shop_${syncType}_sync`,
        worker: "shopSyncWorker",
        queue: QUEUE_NAME,
        jobId: job.id,
        entityType: "store",
        entityId: shop,
        executionId,
      });

      if (!exclusiveLock.acquired) {
        throw codedError(
          "SHOP_WORK_LEASE_CONFLICT",
          "Another heavy job is already running for this shop",
        );
      }

      exclusiveShopLockKey = exclusiveLock.lockKey;
      leaseHeartbeat = setInterval(() => {
        extendExclusiveShopWork(exclusiveShopLockKey).catch((error) => {
          logger.warn("Shop sync lease heartbeat failed", {
            worker: "shopSyncWorker",
            queue: QUEUE_NAME,
            jobId: job.id,
            shop,
            syncType,
            executionId,
            message: error.message,
          });
        });
      }, SHOP_SYNC_LEASE_HEARTBEAT_MS);
      leaseHeartbeat.unref?.();

      if (syncType === "product") {
        await markInventoryReconciliationPending(shop).catch(() => {});
      }

      if (syncType === "collection") {
        await markCollectionReconciliationPending(shop).catch(() => {});
      }

      const session = await getSession(shop);
      const { status } = await getCurrentBulkOperationStatus(session, "QUERY");

      if (status === "RUNNING") {
        throw codedError(
          "SHOPIFY_QUERY_BULK_RUNNING",
          "A Shopify query bulk operation is already running for this shop",
        );
      }

      if (syncType === "product") {
        await productFilterService.startBulkOperationToFetchProducts({ session });
      } else if (syncType === "collection") {
        await collectionService.clearCollections(session);
      } else {
        throw codedError("SHOP_SYNC_TYPE_UNSUPPORTED", `Unsupported syncType: ${syncType}`);
      }

      logger.info("Webhook-triggered sync queued", {
        worker: "shopSyncWorker",
        jobId: job.id,
        shop,
        syncType,
        reason,
      });

      return {
        success: true,
        shop,
        syncType,
      };
    } catch (error) {
      await recordMirrorAnomaly({
        shop,
        severity: "medium",
        type: "shop_sync_worker_failure",
        entityType: "store",
        entityId: shop,
        message: error.message,
        details: { syncType, reason, code: error.code || null, executionId },
      }).catch(() => {});

      await markRepairRequired({
        shop,
        reason:
          syncType === "collection"
            ? MIRROR_STALE_REASONS.COLLECTION_RECONCILIATION_PENDING
            : MIRROR_STALE_REASONS.INVENTORY_RECONCILIATION_PENDING,
        summary: error.message,
        severity: "medium",
        details: { syncType, reason, code: error.code || null, executionId },
      }).catch(() => {});

      throw error;
    } finally {
      if (leaseHeartbeat) {
        clearInterval(leaseHeartbeat);
      }
      await releaseExclusiveShopWork(exclusiveShopLockKey);
    }
  },
  {
    connection,
    concurrency: 2,
  },
);

shopSyncWorker.on("failed", (job, error) => {
  logger.error("Shop sync worker failed", {
    worker: "shopSyncWorker",
    queue: QUEUE_NAME,
    jobId: job?.id,
    shop: job?.data?.shop,
      syncType: job?.data?.syncType,
      attempt: getJobAttempt(job),
      code: error.code || null,
      message: error.message,
    });
});

shopSyncWorker.on("completed", (job, result) => {
  logger.info("Shop sync worker completed", {
    worker: "shopSyncWorker",
    queue: QUEUE_NAME,
    jobId: job?.id,
    shop: job?.data?.shop,
    syncType: job?.data?.syncType,
    attempt: getJobAttempt(job),
    result,
  });
});

shopSyncWorker.on("failed", async (job) => {
  if (isRetryExhausted(job)) {
    await recordRetryExhausted({
      job,
      shop: job?.data?.shop,
      worker: "shopSyncWorker",
      queue: QUEUE_NAME,
      entityType: "store",
      entityId: job?.data?.shop,
      executionId:
        job?.data?.syncRunId ||
        job?.data?.operationId ||
        `shop-sync:${job?.data?.syncType || "sync"}:${job?.data?.shop || "unknown"}:${job?.id || "unknown"}`,
      message: "Shop sync worker exhausted retries",
      details: {
        syncType: job?.data?.syncType || null,
      },
    });
  }
});

export default shopSyncWorker;
