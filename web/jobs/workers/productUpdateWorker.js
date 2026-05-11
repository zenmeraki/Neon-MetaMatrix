import logger from "../../utils/loggerUtils.js";
import dayjs from "dayjs";
import crypto from "crypto";
import { Worker } from "bullmq";
import { connection } from "../../config/redis.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import {
  extractVariantsForPrisma,
  transformWebhookPayload,
} from "../../modules/productSync/webhookTransformers.js";
import { enqueueAutomaticProductRuleSignalJob } from "../../services/automaticProductRuleExecutionService.js";
import { prisma } from "../../config/database.js";
import {
  markRepairRequired,
  markWebhookProcessed,
  MIRROR_STALE_REASONS,
} from "../../services/mirrorHealthService.js";
import { recordMirrorAnomaly } from "../../services/mirrorAnomalyService.js";
import { addShopSyncJob } from "../queues/shopSyncJob.js";
import {
  createWebhookPayloadHash,
  webhookDeliveryRepository,
} from "../../repositories/webhookDeliveryRepository.js";
import { requireJobData } from "../../utils/jobPayloadValidation.js";

const QueueName =
  process.env.NODE_ENV === "production"
    ? "product-update"
    : "product-update-job-dev";

function buildSourceEvent({ job, shop, productId, payload, transformedData }) {
  const topic = job.data?.topic || "PRODUCTS_UPDATE";
  const webhookId =
    job.data?.webhookId ||
    job.data?.webhook_id ||
    job.data?.deliveryId ||
    job.id ||
    null;
  const payloadHash = createWebhookPayloadHash({
    shop,
    productId,
    payload,
  });
  const sourceEventId =
    webhookId || `${topic}:${shop}:${productId}:${payloadHash.slice(0, 16)}`;
  const sourceOccurredAt =
    transformedData.updatedAt ||
    (payload.updated_at ? new Date(payload.updated_at) : null) ||
    (payload.created_at ? new Date(payload.created_at) : null) ||
    new Date();
  const explicitSequence =
    job.data?.sourceSequence ||
    job.data?.source_sequence ||
    payload.sourceSequence ||
    payload.source_sequence ||
    null;
  const hashSuffix = BigInt(
    parseInt(
      crypto
        .createHash("sha256")
        .update(sourceEventId)
        .digest("hex")
        .slice(0, 8),
      16,
    ) % 1_000_000,
  );
  const sourceSequence =
    explicitSequence != null
      ? BigInt(explicitSequence)
      : BigInt(sourceOccurredAt.getTime()) * 1_000_000n + hashSuffix;

  return {
    topic,
    webhookId,
    sourceEventId,
    sourceOccurredAt,
    sourceSequence,
    payloadHash,
  };
}

function shouldApply(existingSequence, incomingSequence) {
  if (existingSequence == null) return true;
  return BigInt(incomingSequence) > BigInt(existingSequence);
}

function variantData({ variant, shop, productId, activeBatchId, sourceEvent }) {
  return {
    shop,
    id: variant.id,
    productId,
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
    deletedAt: null,
    sourceEventId: sourceEvent.sourceEventId,
    sourceOccurredAt: sourceEvent.sourceOccurredAt,
    sourceSequence: sourceEvent.sourceSequence,
    mirrorVersion: { increment: 1 },
  };
}

const productUpdateWorker = new Worker(
  QueueName,
  async (job) => {
    let deliveryId = null;

    try {
      const { shop, id } = requireJobData(
        job,
        ["shop", "id"],
        "product update webhook",
      );
      const { shop: _shop, id: _id, ...payload } = job.data;
      const transformedData = transformWebhookPayload(payload, shop);
      const sourceEvent = buildSourceEvent({
        job,
        shop,
        productId: id,
        payload,
        transformedData,
      });

      const reservation = await webhookDeliveryRepository.reserve({
        topic: sourceEvent.topic,
        shop,
        webhookId: sourceEvent.webhookId,
        entityId: id,
        payload,
        sourceSequence: sourceEvent.sourceSequence,
        sourceOccurredAt: sourceEvent.sourceOccurredAt,
      });
      deliveryId = reservation.deliveryId;

      if (!reservation.accepted) {
        return {
          skipped: true,
          reason: "duplicate_webhook_delivery",
          deliveryId,
        };
      }

      const store = await prisma.store.findUnique({
        where: { shopUrl: shop },
        select: { activeMirrorBatchId: true },
      });
      const activeBatchId = store?.activeMirrorBatchId;

      if (!activeBatchId) {
        const error = new Error("ACTIVE_MIRROR_BATCH_REQUIRED");
        error.code = "ACTIVE_MIRROR_BATCH_REQUIRED";
        throw error;
      }

      const variants = Array.isArray(payload.variants)
        ? extractVariantsForPrisma(payload, id, shop)
            .filter((variant) => Boolean(variant?.id))
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

      const reconciliation = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(hashtext(${`product-webhook:${shop}:${activeBatchId}:${id}`}))
        `;

        const existingProduct = await tx.product.findUnique({
          where: {
            shop_id_mirrorBatchId: {
              shop,
              id,
              mirrorBatchId: activeBatchId,
            },
          },
          select: {
            sourceSequence: true,
            sourceEventId: true,
            mirrorVersion: true,
          },
        });

        if (
          existingProduct &&
          !shouldApply(existingProduct.sourceSequence, sourceEvent.sourceSequence)
        ) {
          return {
            applied: false,
            reason: "stale_source_sequence",
            existingSourceSequence: existingProduct.sourceSequence?.toString() || null,
            incomingSourceSequence: sourceEvent.sourceSequence.toString(),
          };
        }

        const productData = {
          ...transformedData,
          sourceEventId: sourceEvent.sourceEventId,
          sourceOccurredAt: sourceEvent.sourceOccurredAt,
          sourceSequence: sourceEvent.sourceSequence,
          lastSourceEventAt: sourceEvent.sourceOccurredAt,
          lastSourceUpdatedAt: transformedData.updatedAt || sourceEvent.sourceOccurredAt,
          lastSourceKind: "WEBHOOK",
          lastReconciledAt: new Date(),
          mirrorVersion: { increment: 1 },
        };

        if (existingProduct) {
          const updated = await tx.product.updateMany({
            where: {
              shop,
              id,
              mirrorBatchId: activeBatchId,
              OR: [
                { sourceSequence: null },
                { sourceSequence: { lt: sourceEvent.sourceSequence } },
              ],
            },
            data: productData,
          });

          if (updated.count !== 1) {
            return {
              applied: false,
              reason: "product_sequence_conflict",
            };
          }
        } else {
          await tx.product.create({
            data: {
              shop,
              id,
              mirrorBatchId: activeBatchId,
              ...transformedData,
              sourceEventId: sourceEvent.sourceEventId,
              sourceOccurredAt: sourceEvent.sourceOccurredAt,
              sourceSequence: sourceEvent.sourceSequence,
              lastSourceEventAt: sourceEvent.sourceOccurredAt,
              lastSourceUpdatedAt: transformedData.updatedAt || sourceEvent.sourceOccurredAt,
              lastSourceKind: "WEBHOOK",
              lastReconciledAt: new Date(),
              mirrorVersion: 1n,
            },
          });
        }

        if (variants) {
          const existingVariants = await tx.variant.findMany({
            where: {
              shop,
              productId: id,
              mirrorBatchId: activeBatchId,
            },
            select: {
              id: true,
              sourceSequence: true,
            },
          });
          const existingById = new Map(
            existingVariants.map((variant) => [variant.id, variant]),
          );
          const incomingById = new Map(
            variants.map((variant) => [variant.id, variant]),
          );

          for (const variant of incomingById.values()) {
            const existingVariant = existingById.get(variant.id);
            const data = variantData({
              variant,
              shop,
              productId: id,
              activeBatchId,
              sourceEvent,
            });

            if (existingVariant) {
              if (
                !shouldApply(
                  existingVariant.sourceSequence,
                  sourceEvent.sourceSequence,
                )
              ) {
                continue;
              }

              await tx.variant.updateMany({
                where: {
                  shop,
                  id: variant.id,
                  mirrorBatchId: activeBatchId,
                  OR: [
                    { sourceSequence: null },
                    { sourceSequence: { lt: sourceEvent.sourceSequence } },
                  ],
                },
                data,
              });
            } else {
              await tx.variant.create({
                data: {
                  ...data,
                  mirrorVersion: 1n,
                },
              });
            }
          }

          const removedVariantIds = existingVariants
            .map((variant) => variant.id)
            .filter((variantId) => !incomingById.has(variantId));

          if (removedVariantIds.length > 0) {
            await tx.variant.updateMany({
              where: {
                shop,
                productId: id,
                mirrorBatchId: activeBatchId,
                id: { in: removedVariantIds },
                deletedAt: null,
                OR: [
                  { sourceSequence: null },
                  { sourceSequence: { lt: sourceEvent.sourceSequence } },
                ],
              },
              data: {
                deletedAt: sourceEvent.sourceOccurredAt,
                sourceEventId: sourceEvent.sourceEventId,
                sourceOccurredAt: sourceEvent.sourceOccurredAt,
                sourceSequence: sourceEvent.sourceSequence,
                mirrorVersion: { increment: 1 },
              },
            });
          }

          const activeVariantCount = await tx.variant.count({
            where: {
              shop,
              productId: id,
              mirrorBatchId: activeBatchId,
              deletedAt: null,
            },
          });

          if (activeVariantCount !== incomingById.size) {
            return {
              applied: true,
              verified: false,
              reason: "variant_count_mismatch",
              expectedVariantCount: incomingById.size,
              actualVariantCount: activeVariantCount,
            };
          }
        }

        return {
          applied: true,
          verified: true,
          sourceSequence: sourceEvent.sourceSequence.toString(),
          sourceEventId: sourceEvent.sourceEventId,
        };
      });

      if (!reconciliation.applied) {
        await webhookDeliveryRepository.markSkipped(
          deliveryId,
          reconciliation.reason,
        );
        await recordMirrorAnomaly({
          shop,
          severity: "medium",
          type: "webhook_stale_sequence",
          entityType: "product",
          entityId: id,
          message: "Ignored stale product update webhook payload",
          details: reconciliation,
        }).catch(() => {});

        return { skipped: true, ...reconciliation };
      }

      if (!reconciliation.verified) {
        await markRepairRequired({
          shop,
          reason: MIRROR_STALE_REASONS.PRODUCT_WEBHOOK_MISSING_VARIANTS,
          summary: "Product update webhook reconciliation verification failed",
          details: { productId: id, reconciliation },
        }).catch(() => {});
        await webhookDeliveryRepository.markProcessed(deliveryId).catch(() => {});
        return {
          success: true,
          verified: false,
          productId: id,
          reconciliation,
        };
      }

      await webhookDeliveryRepository.markProcessed(deliveryId).catch(() => {});

      await markWebhookProcessed(shop, {
        lastIncrementalSyncAt: new Date(),
      }).catch(() => {});

      await clearKeyCaches(`${shop}:ProductFetch:`);
      await clearKeyCaches(`${shop}:productTypes:`);
      await clearKeyCaches(`${shop}:ProductFilterValues:`);
      if (variants) {
        await enqueueAutomaticProductRuleSignalJob({
          shop,
          productIds: [id],
          triggerReference: `product_update:${id}:${sourceEvent.sourceEventId}`,
          triggerSource: "WEBHOOK",
        });
      }

      return { success: true, productId: id };
    } catch (err) {
      await webhookDeliveryRepository.markFailed(deliveryId, err).catch(() => {});
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
