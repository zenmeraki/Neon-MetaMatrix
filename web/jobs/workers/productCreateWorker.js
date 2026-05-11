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
import {
  createWebhookPayloadHash,
  webhookDeliveryRepository,
} from "../../repositories/webhookDeliveryRepository.js";
import { requireJobData } from "../../utils/jobPayloadValidation.js";

const QueueName =
  process.env.NODE_ENV === "production"
    ? "product-create"
    : "product-create-job-dev";

function buildSourceEvent({ job, shop, productId, payload, transformedData }) {
  const topic = job.data?.topic || "PRODUCTS_CREATE";
  const webhookId =
    job.data?.webhookId ||
    job.data?.webhook_id ||
    job.data?.deliveryId ||
    job.id ||
    null;
  const payloadHash = createWebhookPayloadHash({ shop, productId, payload });
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
    payloadHash,
    sourceEventId,
    sourceOccurredAt,
    sourceSequence,
  };
}

function shouldApply(existingSequence, incomingSequence) {
  if (existingSequence == null) return true;
  return BigInt(incomingSequence) > BigInt(existingSequence);
}

function variantData({ variant, shop, productId, mirrorBatchId, sourceEvent }) {
  return {
    shop,
    id: variant.id,
    productId,
    mirrorBatchId,
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

const productCreateWorker = new Worker(
  QueueName,
  async (job) => {
    let deliveryId = null;

    try {
      const { shop, id } = requireJobData(
        job,
        ["shop", "id"],
        "product create webhook",
      );
      const { shop: _shop, id: _id, ...payload } = job.data;

      const store = await prisma.store.findUnique({
        where: { shopUrl: shop },
        select: { activeMirrorBatchId: true },
      });
      const activeMirrorBatchId = store?.activeMirrorBatchId;

      if (!activeMirrorBatchId) {
        const error = new Error("ACTIVE_MIRROR_BATCH_REQUIRED");
        error.code = "ACTIVE_MIRROR_BATCH_REQUIRED";
        throw error;
      }

      const product = transformWebhookPayload(payload, shop);
      const sourceEvent = buildSourceEvent({
        job,
        shop,
        productId: id,
        payload,
        transformedData: product,
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

      const variants = Array.isArray(payload.variants)
        ? extractVariantsForPrisma(payload, id, shop).filter((variant) =>
            Boolean(variant?.id),
          )
        : null;

      if (!variants) {
        await markRepairRequired({
          shop,
          reason: MIRROR_STALE_REASONS.PRODUCT_WEBHOOK_MISSING_VARIANTS,
          summary: "Product create webhook missing variants payload; repair sync required",
          details: { productId: id },
        }).catch(() => {});
      }

      const reconciliation = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(hashtext(${`product-create-webhook:${shop}:${activeMirrorBatchId}:${id}`}))
        `;

        const [existingProduct, existingTombstone] = await Promise.all([
          tx.product.findUnique({
            where: {
              shop_id_mirrorBatchId: {
                shop,
                id,
                mirrorBatchId: activeMirrorBatchId,
              },
            },
            select: {
              sourceSequence: true,
            },
          }),
          tx.productTombstone.findUnique({
            where: {
              shop_productId: {
                shop,
                productId: id,
              },
            },
            select: {
              sourceSequence: true,
            },
          }),
        ]);

        const blockingSequence =
          existingProduct?.sourceSequence != null &&
          !shouldApply(existingProduct.sourceSequence, sourceEvent.sourceSequence)
            ? existingProduct.sourceSequence
            : existingTombstone?.sourceSequence != null &&
                !shouldApply(existingTombstone.sourceSequence, sourceEvent.sourceSequence)
              ? existingTombstone.sourceSequence
              : null;

        if (blockingSequence != null) {
          return {
            applied: false,
            reason: "stale_source_sequence",
            existingSourceSequence: blockingSequence.toString(),
            incomingSourceSequence: sourceEvent.sourceSequence.toString(),
          };
        }

        const productData = {
          ...product,
          deletedAt: null,
          sourceEventId: sourceEvent.sourceEventId,
          sourceOccurredAt: sourceEvent.sourceOccurredAt,
          sourceSequence: sourceEvent.sourceSequence,
          lastSourceEventAt: sourceEvent.sourceOccurredAt,
          lastSourceUpdatedAt: product.updatedAt || sourceEvent.sourceOccurredAt,
          lastSourceKind: "WEBHOOK_PRODUCT_CREATE",
          lastReconciledAt: new Date(),
          mirrorVersion: { increment: 1 },
        };

        if (existingProduct) {
          const updated = await tx.product.updateMany({
            where: {
              shop,
              id,
              mirrorBatchId: activeMirrorBatchId,
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
              mirrorBatchId: activeMirrorBatchId,
              ...product,
              deletedAt: null,
              sourceEventId: sourceEvent.sourceEventId,
              sourceOccurredAt: sourceEvent.sourceOccurredAt,
              sourceSequence: sourceEvent.sourceSequence,
              lastSourceEventAt: sourceEvent.sourceOccurredAt,
              lastSourceUpdatedAt: product.updatedAt || sourceEvent.sourceOccurredAt,
              lastSourceKind: "WEBHOOK_PRODUCT_CREATE",
              lastReconciledAt: new Date(),
              mirrorVersion: 1n,
            },
          });
        }

        await tx.productTombstone.upsert({
          where: {
            shop_productId: {
              shop,
              productId: id,
            },
          },
          update: {
            deletedAt: null,
            sourceEventId: sourceEvent.sourceEventId,
            sourceEventAt: sourceEvent.sourceOccurredAt,
            sourceSequence: sourceEvent.sourceSequence,
            sourceKind: "WEBHOOK_PRODUCT_CREATE",
            lastReconciledAt: sourceEvent.sourceOccurredAt,
          },
          create: {
            id: `${shop}:${id}`,
            shop,
            productId: id,
            deletedAt: null,
            sourceEventId: sourceEvent.sourceEventId,
            sourceEventAt: sourceEvent.sourceOccurredAt,
            sourceSequence: sourceEvent.sourceSequence,
            sourceKind: "WEBHOOK_PRODUCT_CREATE",
            lastReconciledAt: sourceEvent.sourceOccurredAt,
          },
        });

        if (variants) {
          const existingVariants = await tx.variant.findMany({
            where: {
              shop,
              productId: id,
              mirrorBatchId: activeMirrorBatchId,
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
              mirrorBatchId: activeMirrorBatchId,
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
                  mirrorBatchId: activeMirrorBatchId,
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
                mirrorBatchId: activeMirrorBatchId,
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
              mirrorBatchId: activeMirrorBatchId,
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
          sourceEventId: sourceEvent.sourceEventId,
          sourceSequence: sourceEvent.sourceSequence.toString(),
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
          type: "product_create_stale_sequence",
          entityType: "product",
          entityId: id,
          message: "Ignored stale product create webhook payload",
          details: reconciliation,
        }).catch(() => {});

        return { skipped: true, ...reconciliation };
      }

      if (!reconciliation.verified) {
        await markRepairRequired({
          shop,
          reason: MIRROR_STALE_REASONS.PRODUCT_WEBHOOK_MISSING_VARIANTS,
          summary: "Product create webhook reconciliation verification failed",
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
          triggerReference: `product_create:${id}:${sourceEvent.sourceEventId}`,
          triggerSource: "WEBHOOK",
        });
      }

      return {
        success: true,
        productId: id,
        deliveryId,
        sourceEventId: reconciliation.sourceEventId,
        sourceSequence: reconciliation.sourceSequence,
      };
    } catch (err) {
      await webhookDeliveryRepository.markFailed(deliveryId, err).catch(() => {});
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
