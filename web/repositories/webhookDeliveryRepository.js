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
  async reserve({ topic, shop, webhookId, entityId, payload }, db = prisma) {
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
          status: "RECEIVED",
          attemptCount: 1,
        },
      });

      return { accepted: true, deliveryId: id, payloadHash };
    } catch (error) {
      if (error.code === "P2002") {
        return { accepted: false, deliveryId: id, payloadHash };
      }

      throw error;
    }
  },
};
