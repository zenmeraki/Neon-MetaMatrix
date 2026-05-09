import { Worker } from "bullmq";
import { connection } from "../../config/redis.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { prisma } from "../../config/database.js";
import logger from "../../utils/loggerUtils.js";
import { logWorkerError } from "../../utils/errorLogUtils.js";
import { markWebhookProcessed } from "../../services/mirrorHealthService.js";
import { recordMirrorAnomaly } from "../../services/mirrorAnomalyService.js";

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
      await prisma.$transaction(async (tx) => {
        await tx.variant.deleteMany({
          where: {
            shop,
            productId,
          },
        });

        await tx.product.deleteMany({
          where: {
            shop,
            id: productId,
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