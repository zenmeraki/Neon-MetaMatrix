import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import { prisma } from "../../Config/database.js";
import logger from "../../utils/loggerUtils.js";
import { getSession } from "../../utils/sessionHandler.js";
import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";
import { startProductCatalogSync } from "../../services/sync/catalogSyncService.js";
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
  assertExclusiveShopWorkLeaseActive,
  releaseExclusiveShopWork,
  startExclusiveShopWorkRenewal,
} from "../../services/shopWorkLeaseService.js";
import { getJobAttempt, isRetryExhausted, recordRetryExhausted } from "../../utils/workerTelemetry.js";

const QUEUE_NAME = process.env.SHOP_SYNC_QUEUE || "shop-sync-trigger";

const collectionService = new CollectionService(shopify);

const shopSyncWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { shop, syncType, reason, payload = {} } = job.data;
    if (!shop || !syncType) {
      throw new Error("shop-sync job requires shop and syncType");
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

    let shopLease = null;
    let leaseRenewal = null;

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

      shopLease = exclusiveLock;
      leaseRenewal = startExclusiveShopWorkRenewal(exclusiveLock, {
        onRenewalError: (error) => {
          logger.error("Failed to renew shop sync lease", {
            worker: "shopSyncWorker",
            shop,
            syncType,
            error: error.message,
          });
        },
      });

      if (syncType === "shop") {
        await prisma.store.updateMany({
          where: { shopUrl: shop },
          data: {
            shopEmail: payload.email || undefined,
            updatedAt: new Date(),
            lastActivityAt: new Date(),
          },
        });

        logger.info("Webhook-triggered shop metadata reconciliation completed", {
          worker: "shopSyncWorker",
          jobId: job.id,
          shop,
          reason,
        });

        return {
          success: true,
          shop,
          syncType,
        };
      }

      if (syncType === "product") {
        await markInventoryReconciliationPending(shop).catch(() => {});
      }

      if (syncType === "collection") {
        await markCollectionReconciliationPending(shop).catch(() => {});
      }

      const session = await getSession(shop);
      assertExclusiveShopWorkLeaseActive(shopLease);
      const { status } = await getCurrentBulkOperationStatus(session, "QUERY");

      if (["CREATED", "RUNNING", "CANCELING"].includes(status)) {
        throw new Error("A Shopify query bulk operation is already running for this shop");
      }

      assertExclusiveShopWorkLeaseActive(shopLease);
      if (syncType === "product") {
        await startProductCatalogSync({ shop, session });
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
            : syncType === "product"
              ? MIRROR_STALE_REASONS.INVENTORY_RECONCILIATION_PENDING
              : MIRROR_STALE_REASONS.SHOP_RECONCILIATION_PENDING ||
                "SHOP_RECONCILIATION_PENDING",
        summary: error.message,
        severity: "medium",
        details: { syncType, reason },
      }).catch(() => {});

      throw error;
    } finally {
      if (leaseRenewal) {
        clearInterval(leaseRenewal);
      }

      await releaseExclusiveShopWork(shopLease);
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
