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
import { prisma } from "../../config/database.js";
import {
  markRepairRequired,
  markWebhookProcessed,
  MIRROR_STALE_REASONS,
} from "../../services/mirrorHealthService.js";
import { recordMirrorAnomaly } from "../../services/mirrorAnomalyService.js";
import { addShopSyncJob } from "../Queues/shopSyncJob.js";

const QueueName =
  process.env.NODE_ENV === "production"
    ? "product-update"
    : "product-update-job-dev";

const productUpdateWorker = new Worker(
  QueueName,
  async (job) => {
    try {
      const { shop, id, ...payload } = job.data;
      const transformedData = transformWebhookPayload(payload, shop);
      const incomingUpdatedAt = transformedData.updatedAt
        ? new Date(transformedData.updatedAt)
        : null;
      const store = await prisma.store.findUnique({
        where: { shopUrl: shop },
        select: { activeMirrorBatchId: true },
      });
      const activeBatchId = store?.activeMirrorBatchId || "legacy";

      const existingScoped = await prisma.product.findFirst({
        where: {
          shop,
          id,
          mirrorBatchId: activeBatchId,
        },
        select: {
          updatedAt: true,
          mirrorBatchId: true,
        },
      });

      if (
        existingScoped?.updatedAt &&
        incomingUpdatedAt &&
        incomingUpdatedAt < new Date(existingScoped.updatedAt)
      ) {
        await recordMirrorAnomaly({
          shop,
          severity: "medium",
          type: "webhook_out_of_order",
          entityType: "product",
          entityId: id,
          message: "Ignored older product update webhook payload",
          details: {
            existingUpdatedAt: existingScoped.updatedAt,
            incomingUpdatedAt,
          },
        });

        return { skipped: true, reason: "out_of_order_webhook" };
      }

      const variants = Array.isArray(payload.variants)
        ? extractVariantsForPrisma(payload, id, shop)
        : null;

      if (!variants) {
        await markRepairRequired({
          shop,
          reason: MIRROR_STALE_REASONS.PRODUCT_WEBHOOK_MISSING_VARIANTS,
          summary: "Product update webhook missing variants payload; repair sync required",
          details: { productId: id },
        }).catch(() => {});

        await addShopSyncJob({
          shop,
          syncType: "product",
          reason: "product_update_missing_variants",
        }).catch(() => {});
      }

      await prisma.$transaction(async (tx) => {
        const updated = await tx.product.updateMany({
          where: {
            shop,
            id,
            mirrorBatchId: activeBatchId,
          },
          data: {
            ...transformedData,
          },
        });

        if (!updated.count) {
          await tx.product.create({
            data: {
              shop,
              id,
              mirrorBatchId: activeBatchId,
              ...transformedData,
            },
          });
        }

        if (variants) {
          await tx.variant.deleteMany({
            where: {
              shop,
              productId: id,
              mirrorBatchId: activeBatchId,
            },
          });

          if (variants.length > 0) {
            await tx.variant.createMany({
              data: variants.map((variant) => ({
                shop,
                id: variant.id,
                productId: id,
                mirrorBatchId: activeBatchId,
                title: variant.title ?? null,
                sku: variant.sku ?? null,
                barcode: variant.barcode ?? null,
                price: variant.price ?? null,
                compareAtPrice: variant.compareAtPrice ?? null,
                inventoryQuantity: variant.inventoryQuantity ?? null,
                inventoryPolicy: variant.inventoryPolicy ?? null,
                taxable: variant.taxable ?? null,
                taxCode: variant.taxCode ?? null,
                position: variant.position ?? null,
                selectedOptionsJson: variant.selectedOptionsJson ?? null,
              })),
            });
          }
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
        triggerReference: `product_update:${id}:${payload.updated_at || payload.created_at || ""}`,
        triggerSource: "WEBHOOK",
      });

      return { success: true, productId: id };
    } catch (err) {
      await recordMirrorAnomaly({
        shop: job.data?.shop || "unknown",
        severity: "high",
        type: "product_update_worker_failure",
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
  productUpdateWorker
    .on("error", (err) => {
      logger.error(
        `${logTime()} Queue Error in productUpdateWorker: ${err.message}`,
        { stack: err.stack },
      );
    })
    .on("waiting", (jobId) => {
      logger.info(
        `${logTime()} productUpdateWorker - Waiting | Job ID: ${jobId}`,
      );
    })
    .on("active", (job) => {
      logger.info(
        `${logTime()} productUpdateWorker - Started | Job ID: ${job.id}`,
        { message: "active" },
      );
    })
    .on("completed", (job, result) => {
      logger.info(
        `${logTime()} productUpdateWorker - Completed | Job ID: ${job.id}`,
        { result },
      );
    })
    .on("failed", (job, err) => {
      logger.error(
        `${logTime()} productUpdateWorker - Failed | Job ID: ${job.id} | Error: ${err.message}`,
        { error: err },
      );
    });
}

export default productUpdateWorker;