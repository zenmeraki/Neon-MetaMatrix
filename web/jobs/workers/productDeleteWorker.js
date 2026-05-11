import { Worker } from "bullmq";
import crypto from "crypto";
import { connection } from "../../config/redis.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { prisma } from "../../config/database.js";
import logger from "../../utils/loggerUtils.js";
import { logWorkerError } from "../../utils/errorLogUtils.js";
import { markWebhookProcessed } from "../../services/mirrorHealthService.js";
import { recordMirrorAnomaly } from "../../services/mirrorAnomalyService.js";
import {
  createWebhookPayloadHash,
  webhookDeliveryRepository,
} from "../../repositories/webhookDeliveryRepository.js";

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

function buildSourceEvent({ job, shop, productId }) {
  const payload = job.data || {};
  const topic = payload.topic || "PRODUCTS_DELETE";
  const webhookId =
    payload.webhookId ||
    payload.webhook_id ||
    payload.deliveryId ||
    job.id ||
    null;
  const payloadHash = createWebhookPayloadHash({ shop, productId, payload });
  const sourceEventId =
    webhookId || `${topic}:${shop}:${productId}:${payloadHash.slice(0, 16)}`;
  const sourceOccurredAt =
    (payload.updated_at ? new Date(payload.updated_at) : null) ||
    (payload.created_at ? new Date(payload.created_at) : null) ||
    new Date();
  const explicitSequence =
    payload.sourceSequence || payload.source_sequence || null;
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
    payload,
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

const productDeleteWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const shop = job.data?.shop;
    const productId = normalizeProductId(job.data?.id);
    let deliveryId = null;

    if (!shop || !productId) {
      throw new Error("product-delete job requires shop and id");
    }

    try {
      const sourceEvent = buildSourceEvent({ job, shop, productId });
      const reservation = await webhookDeliveryRepository.reserve({
        topic: sourceEvent.topic,
        shop,
        webhookId: sourceEvent.webhookId,
        entityId: productId,
        payload: sourceEvent.payload,
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

      const deletedAt = sourceEvent.sourceOccurredAt;

      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(hashtext(${`product-delete-webhook:${shop}:${productId}`}))
        `;

        const store = await tx.store.findUnique({
          where: { shopUrl: shop },
          select: { activeMirrorBatchId: true },
        });

        if (!store?.activeMirrorBatchId) {
          throw new Error("ACTIVE_MIRROR_BATCH_REQUIRED");
        }

        const mirrorBatchId = store.activeMirrorBatchId;

        const existingTombstone = await tx.productTombstone.findUnique({
          where: {
            shop_productId: {
              shop,
              productId,
            },
          },
          select: {
            sourceSequence: true,
            sourceEventId: true,
          },
        });

        if (
          existingTombstone &&
          !shouldApply(existingTombstone.sourceSequence, sourceEvent.sourceSequence)
        ) {
          return {
            applied: false,
            reason: "stale_source_sequence",
            existingSourceSequence:
              existingTombstone.sourceSequence?.toString() || null,
            incomingSourceSequence: sourceEvent.sourceSequence.toString(),
          };
        }

        await tx.productTombstone.upsert({
          where: {
            shop_productId: {
              shop,
              productId,
            },
          },
          update: {
            deletedAt,
            sourceEventId: sourceEvent.sourceEventId,
            sourceEventAt: deletedAt,
            sourceSequence: sourceEvent.sourceSequence,
            sourceKind: "WEBHOOK_PRODUCT_DELETE",
            lastReconciledAt: deletedAt,
          },
          create: {
            id: `${shop}:${productId}`,
            shop,
            productId,
            deletedAt,
            sourceEventId: sourceEvent.sourceEventId,
            sourceEventAt: deletedAt,
            sourceSequence: sourceEvent.sourceSequence,
            sourceKind: "WEBHOOK_PRODUCT_DELETE",
            lastReconciledAt: deletedAt,
          },
        });

        await tx.variant.updateMany({
          where: {
            shop,
            productId,
            mirrorBatchId,
            deletedAt: null,
            OR: [
              { sourceSequence: null },
              { sourceSequence: { lt: sourceEvent.sourceSequence } },
            ],
          },
          data: {
            deletedAt,
            sourceEventId: sourceEvent.sourceEventId,
            sourceOccurredAt: deletedAt,
            sourceSequence: sourceEvent.sourceSequence,
            mirrorVersion: { increment: 1 },
          },
        });

        await tx.product.updateMany({
          where: {
            shop,
            id: productId,
            mirrorBatchId,
            deletedAt: null,
            OR: [
              { sourceSequence: null },
              { sourceSequence: { lt: sourceEvent.sourceSequence } },
            ],
          },
          data: {
            deletedAt,
            sourceEventId: sourceEvent.sourceEventId,
            sourceOccurredAt: deletedAt,
            sourceSequence: sourceEvent.sourceSequence,
            lastSourceEventAt: deletedAt,
            lastSourceKind: "WEBHOOK_PRODUCT_DELETE",
            lastReconciledAt: deletedAt,
            mirrorVersion: { increment: 1 },
          },
        });

        return {
          applied: true,
          sourceEventId: sourceEvent.sourceEventId,
          sourceSequence: sourceEvent.sourceSequence.toString(),
          mirrorBatchId,
        };
      });

      if (!result.applied) {
        await webhookDeliveryRepository.markSkipped(deliveryId, result.reason);
        await recordMirrorAnomaly({
          shop,
          severity: "medium",
          type: "product_delete_stale_sequence",
          entityType: "product",
          entityId: productId,
          message: "Ignored stale product delete webhook payload",
          details: result,
        }).catch(() => {});

        return { skipped: true, ...result };
      }

      await webhookDeliveryRepository.markProcessed(deliveryId).catch(() => {});

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
        deliveryId,
        sourceEventId: result.sourceEventId,
        sourceSequence: result.sourceSequence,
      };
    } catch (error) {
      await webhookDeliveryRepository.markFailed(deliveryId, error).catch(() => {});

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
