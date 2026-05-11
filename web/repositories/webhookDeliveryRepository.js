import crypto from "crypto";
import { prisma } from "../config/database.js";

function getClient(db) {
  return db || prisma;
}

export function buildWebhookDeliveryId({ topic, shop, webhookId, entityId }) {
  return webhookId || `${topic}:${shop}:${entityId || "unknown"}`;
}

export function buildWebhookDedupeKey({ topic, shop, webhookId, entityId }) {
  return `webhook:${topic}:${shop}:${webhookId || entityId || "unknown"}`;
}

export function createWebhookPayloadHash(payload) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload || {}))
    .digest("hex");
}

export const webhookDeliveryRepository = {
  async reserve({
    topic,
    shop,
    webhookId,
    entityId,
    payload,
    sourceSequence = null,
    sourceOccurredAt = null,
  }, db = prisma) {
    const id = buildWebhookDeliveryId({ topic, shop, webhookId, entityId });
    const dedupeKey = buildWebhookDedupeKey({ topic, shop, webhookId, entityId });
    const payloadHash = createWebhookPayloadHash(payload);

    try {
      await getClient(db).webhookDelivery.create({
        data: {
          id,
          topic,
          shop,
          webhookId: webhookId || null,
          entityId: entityId || null,
          dedupeKey,
          payloadHash,
          payload: payload || null,
          sourceSequence,
          sourceOccurredAt,
          status: "RECEIVED",
          attemptCount: 1,
        },
      });

      return { accepted: true, deliveryId: id, payloadHash };
    } catch (error) {
      if (error.code === "P2002") {
        await getClient(db).webhookDelivery
          .updateMany({
            where: { id },
            data: {
              attemptCount: { increment: 1 },
              updatedAt: new Date(),
            },
          })
          .catch(() => {});
        return { accepted: false, deliveryId: id, payloadHash };
      }

      throw error;
    }
  },

  async markProcessed(deliveryId, db = prisma) {
    if (!deliveryId) return { count: 0 };
    return getClient(db).webhookDelivery.updateMany({
      where: { id: deliveryId },
      data: {
        status: "PROCESSED",
        processedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      },
    });
  },

  async markSkipped(deliveryId, reason, db = prisma) {
    if (!deliveryId) return { count: 0 };
    return getClient(db).webhookDelivery.updateMany({
      where: { id: deliveryId },
      data: {
        status: "SKIPPED",
        processedAt: new Date(),
        lastError: reason || null,
        updatedAt: new Date(),
      },
    });
  },

  async markFailed(deliveryId, error, db = prisma) {
    if (!deliveryId) return { count: 0 };
    return getClient(db).webhookDelivery.updateMany({
      where: { id: deliveryId },
      data: {
        status: "FAILED",
        lastError: error?.message || String(error || "Webhook processing failed"),
        updatedAt: new Date(),
      },
    });
  },
};
