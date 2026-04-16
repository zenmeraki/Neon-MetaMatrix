import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { prisma } from "../../Config/database.js";
import logger from "../../utils/loggerUtils.js";
import { logWorkerError } from "../../utils/errorLogUtils.js";
import { markWebhookProcessed } from "../../services/mirrorHealthService.js";
import { recordMirrorAnomaly } from "../../services/mirrorAnomalyService.js";
import { getActiveCatalogBatchId } from "../../services/sync/catalogSnapshotService.js";

const QUEUE_NAME =
  process.env.NODE_ENV === "production"
    ? "product-delete"
    : "product-delete-job-dev";

function normalizeProductId(id) {
  if (!id) {
    return null;
  }

  return String(id).startsWith("gid://shopify/Product/")
    ? String(id)
    : `gid://shopify/Product/${id}`;
}

const productDeleteWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const shop = job.data?.shop;
    const productId = normalizeProductId(job.data?.id);

    if (!shop || !productId) {
      throw new Error("product-delete job requires shop and id");
    }

    try {
      const activeCatalogBatch = await getActiveCatalogBatchId({ shop });
      const activeCatalogBatchId = activeCatalogBatch.catalogBatchId || null;

      if (!activeCatalogBatchId) {
        await recordMirrorAnomaly({
          shop,
          severity: "medium",
          type: "product_delete_webhook_without_active_batch",
          entityType: "product",
          entityId: productId,
          message: "Product delete webhook skipped because the shop has no active catalog batch",
        }).catch(() => {});
        await markWebhookProcessed(shop, {
          lastIncrementalSyncAt: new Date(),
        }).catch(() => {});
        return { skipped: true, reason: "active_catalog_batch_missing", productId };
      }

      await prisma.$transaction(async (tx) => {
        await tx.variant.deleteMany({
          where: {
            shop,
            productId,
            mirrorBatchId: activeCatalogBatchId,
          },
        });

        await tx.product.deleteMany({
          where: {
            shop,
            id: productId,
            mirrorBatchId: activeCatalogBatchId,
          },
        });
      });

      await markWebhookProcessed(shop, {
        lastIncrementalSyncAt: new Date(),
      }).catch(() => {});

      await clearKeyCaches(`${shop}:ProductFetch`);
      await clearKeyCaches(`${shop}:productTypes:`);
      await clearKeyCaches(`${shop}:ProductFilterValues:`);

      logger.info("Product delete webhook processed", {
        worker: "productDeleteWorker",
        jobId: job.id,
        shop,
        productId,
      });

      return {
        success: true,
        shop,
        productId,
      };
    } catch (error) {
      await recordMirrorAnomaly({
        shop,
        severity: "high",
        type: "product_delete_worker_failure",
        entityType: "product",
        entityId: productId,
        message: error.message,
      }).catch(() => {});

      await logWorkerError({
        shop,
        err: error,
        source: "productDeleteWorker",
      });
      throw error;
    }
  },
  {
    connection,
    concurrency: 5,
    limiter: {
      max: 10,
      duration: 1000,
    },
  },
);

productDeleteWorker.on("failed", (job, error) => {
  logger.error("Product delete worker failed", {
    worker: "productDeleteWorker",
    jobId: job?.id,
    shop: job?.data?.shop,
    productId: job?.data?.id,
    message: error.message,
  });
});

export default productDeleteWorker;
