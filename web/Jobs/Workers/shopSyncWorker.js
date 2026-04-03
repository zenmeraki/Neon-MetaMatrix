import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import { prisma } from "../../config/database.js";
import logger from "../../utils/loggerUtils.js";
import { getSession } from "../../utils/sessionHandler.js";
import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";
import { Services } from "../../services/productService/productFilterService.js";
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
  releaseExclusiveShopWork,
} from "../../services/shopWorkLeaseService.js";
import { getJobAttempt, isRetryExhausted, recordRetryExhausted } from "../../utils/workerTelemetry.js";
import {
  RetryableWorkerError,
  assertShopActiveForWorker,
  isSkippableWorkerError,
} from "../../services/workerSafetyService.js";

const QUEUE_NAME = process.env.SHOP_SYNC_QUEUE || "shop-sync-trigger";

const productService = new Services();
const collectionService = new CollectionService(shopify);

async function tryAdvisoryLock(client, lockKey, transactional = true) {
  if (transactional) {
    const rows = await client.$queryRaw`
      SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS locked
    `;
    return Boolean(rows?.[0]?.locked);
  }

  const rows = await client.$queryRaw`
    SELECT pg_try_advisory_lock(hashtext(${lockKey})) AS locked
  `;
  return Boolean(rows?.[0]?.locked);
}

async function unlockAdvisoryLock(client, lockKey) {
  await client.$queryRaw`
    SELECT pg_advisory_unlock(hashtext(${lockKey}))
  `;
}

const shopSyncWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { shop, syncType, reason } = job.data;
    if (!shop || !syncType) {
      throw new Error("shop-sync job requires shop and syncType");
    }

    const store = await assertShopActiveForWorker(shop);

    if (
      syncType === "product" &&
      (store?.isProductSyncing ||
        (await prisma.syncHistory.findFirst({
          where: {
            shop,
            operationType: "Product",
            status: "processing",
          },
          select: { id: true },
        })))
    ) {
      return {
        skipped: true,
        reason: "local_product_sync_in_progress",
      };
    }

    const lockKey = `shop-sync:${shop}:${syncType}`;
    const hasLock = await tryAdvisoryLock(prisma, lockKey, false);
    if (!hasLock) {
      throw new Error(`Another ${syncType} sync is already queued for this shop`);
    }

    let exclusiveShopLockKey = null;

    try {
      const exclusiveLock = await acquireExclusiveShopWork({
        shop,
        activity: `shop_${syncType}_sync`,
        worker: "shopSyncWorker",
        queue: QUEUE_NAME,
        jobId: job.id,
        entityType: "store",
        entityId: shop,
        executionId: `${syncType}:${shop}`,
      });

      if (!exclusiveLock.acquired) {
        throw new Error("Another heavy job is already running for this shop");
      }

      exclusiveShopLockKey = exclusiveLock.lockKey;

      if (syncType === "product") {
        await markInventoryReconciliationPending(shop).catch(() => {});
      }

      if (syncType === "collection") {
        await markCollectionReconciliationPending(shop).catch(() => {});
      }

      const session = await getSession(shop);
      const { status } = await getCurrentBulkOperationStatus(session, "QUERY");

      if (status === "RUNNING") {
        throw new RetryableWorkerError(
          "A Shopify query bulk operation is already running for this shop",
          "shopify_bulk_busy",
        );
      }

      if (syncType === "product") {
        await productService.startBulkOperationToFetchProducts({ session });
      } else if (syncType === "collection") {
        await collectionService.clearCollections(session);
      } else {
        throw new Error(`Unsupported syncType: ${syncType}`);
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
      if (isSkippableWorkerError(error)) {
        return {
          skipped: true,
          reason: error.code,
          shop,
          syncType,
        };
      }

      await recordMirrorAnomaly({
        shop,
        severity: "medium",
        type: "shop_sync_worker_failure",
        entityType: "store",
        entityId: shop,
        message: error.message,
        details: { syncType, reason },
      }).catch(() => {});

      await markRepairRequired({
        shop,
        reason:
          syncType === "collection"
            ? MIRROR_STALE_REASONS.COLLECTION_RECONCILIATION_PENDING
            : MIRROR_STALE_REASONS.INVENTORY_RECONCILIATION_PENDING,
        summary: error.message,
        severity: "medium",
        details: { syncType, reason },
      }).catch(() => {});

      throw error;
    } finally {
      await releaseExclusiveShopWork(exclusiveShopLockKey);
      await unlockAdvisoryLock(prisma, lockKey).catch(() => {});
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
      executionId: `${job?.data?.syncType || "sync"}:${job?.data?.shop || "unknown"}`,
      message: "Shop sync worker exhausted retries",
      details: {
        syncType: job?.data?.syncType || null,
      },
    });
  }
});

export default shopSyncWorker;
