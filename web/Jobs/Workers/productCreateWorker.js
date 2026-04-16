import logger from "../../utils/loggerUtils.js";
import dayjs from "dayjs";
import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import {
  extractVariantsForPrisma,
  transformWebhookPayload,
} from "../../utils/webhookTransformers.js";
import { enqueueAutomaticProductRuleSignalJob } from "../../services/automaticProductRuleExecutionService.js";
import { prisma } from "../../Config/database.js";
import { markWebhookProcessed } from "../../services/mirrorHealthService.js";
import { recordMirrorAnomaly } from "../../services/mirrorAnomalyService.js";
import { getActiveCatalogBatchId } from "../../services/sync/catalogSnapshotService.js";

const QueueName =
  process.env.NODE_ENV === "production"
    ? "product-create"
    : "product-create-job-dev";

const productCreateWorker = new Worker(
  QueueName,
  async (job) => {
    try {
      const { shop, id, ...payload } = job.data;

      const activeCatalogBatch = await getActiveCatalogBatchId({ shop });
      const activeCatalogBatchId = activeCatalogBatch.catalogBatchId || null;
      if (!activeCatalogBatchId) {
        await recordMirrorAnomaly({
          shop,
          severity: "medium",
          type: "product_create_webhook_without_active_batch",
          entityType: "product",
          entityId: id,
          message: "Product create webhook skipped because the shop has no active catalog batch",
        }).catch(() => {});
        await markWebhookProcessed(shop, {
          lastIncrementalSyncAt: new Date(),
        }).catch(() => {});
        return { skipped: true, reason: "active_catalog_batch_missing", productId: id };
      }

      const product = transformWebhookPayload(payload, shop);
      const variants = extractVariantsForPrisma(payload, id, shop);

      await prisma.$transaction(async (tx) => {
        await tx.variant.deleteMany({
          where: {
            shop,
            productId: id,
            mirrorBatchId: activeCatalogBatchId,
          },
        });

        await tx.product.deleteMany({
          where: {
            shop,
            id,
            mirrorBatchId: activeCatalogBatchId,
          },
        });

        await tx.product.create({
          data: {
            shop,
            id,
            mirrorBatchId: activeCatalogBatchId,
            catalogBatchId: activeCatalogBatchId,
            ...product,
          },
        });

        if (variants.length > 0) {
          await tx.variant.createMany({
            data: variants.map((variant) => ({
              shop,
              id: variant.id,
              productId: id,
              mirrorBatchId: activeCatalogBatchId,
              catalogBatchId: activeCatalogBatchId,
              title: variant.title ?? null,
              sku: variant.sku ?? null,
              barcode: variant.barcode ?? null,
              price: variant.price ?? null,
              priceDecimal: variant.price ?? null,
              compareAtPrice: variant.compareAtPrice ?? null,
              compareAtPriceDecimal: variant.compareAtPrice ?? null,
              inventoryQuantity: variant.inventoryQuantity ?? null,
              inventoryPolicy: variant.inventoryPolicy ?? null,
              taxable: variant.taxable ?? null,
              taxCode: variant.taxCode ?? null,
              position: variant.position ?? null,
              selectedOptionsJson: variant.selectedOptionsJson ?? null,
              cost: variant.cost ?? null,
              costDecimal: variant.cost ?? null,
              weight: variant.weight ?? null,
              weightDecimal: variant.weight ?? null,
              profitMargin: variant.profitMargin ?? null,
              profitMarginDecimal: variant.profitMargin ?? null,
            })),
          });
        }
      });

      await markWebhookProcessed(shop, {
        lastIncrementalSyncAt: new Date(),
      }).catch(() => {});

      await clearKeyCaches(`${shop}:ProductFetch:`);
      await clearKeyCaches(`${shop}:productTypes:`);
      await clearKeyCaches(`${shop}:ProductFilterValues:`);
      await enqueueAutomaticProductRuleSignalJob({
        shop,
        productIds: [id],
        triggerReference: `product_create:${id}:${payload.updated_at || payload.created_at || ""}`,
        triggerSource: "WEBHOOK",
      });

      return { success: true, productId: id };
    } catch (err) {
      await recordMirrorAnomaly({
        shop: job.data?.shop || "unknown",
        severity: "high",
        type: "product_create_worker_failure",
        entityType: "product",
        entityId: job.data?.id || null,
        message: err.message,
      }).catch(() => {});
      throw err;
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

const logTime = () => `[${dayjs().format("YYYY-MM-DD HH:mm:ss")}]`;

if (process.env.NODE_ENV !== "production") {
  productCreateWorker
    .on("error", (err) => {
      logger.error(
        `${logTime()} Queue Error in productCreateWorker: ${err.message}`,
        {
          stack: err.stack,
        },
      );
    })
    .on("waiting", (jobId) => {
      logger.info(
        `${logTime()} productCreateWorker - Job waiting | Job ID: ${jobId}`,
      );
    })
    .on("active", (job) => {
      logger.info(
        `${logTime()} productCreateWorker - Job started | Job ID: ${job.id}`,
      );
    })
    .on("completed", (job, result) => {
      logger.info(
        `${logTime()} productCreateWorker - Job completed | Job ID: ${job.id}`,
        { result },
      );
    })
    .on("failed", (job, err) => {
      logger.error(
        `${logTime()} productCreateWorker - Job failed | Job ID: ${job.id} | Error: ${err.message}`,
        { error: err },
      );
    });
}

export default productCreateWorker;
