import crypto from "crypto";
import { prisma } from "../config/database.js";
import { withAdvisoryLock } from "../utils/idempotencyUtils.js";

function createPayloadHash(body) {
  if (!body) {
    return null;
  }

  return crypto.createHash("sha256").update(String(body)).digest("hex");
}

function createWebhookDedupeKey({
  topic,
  shop,
  webhookId,
  entityId,
  payloadHash,
}) {
  return `webhook:${topic}:${shop}:${webhookId || entityId || payloadHash || "unknown"}`;
}

async function markProcessed(dedupeKey) {
  await prisma.$executeRaw`
    UPDATE "WebhookDelivery"
    SET
      "status" = 'PROCESSED',
      "processedAt" = CURRENT_TIMESTAMP,
      "lastError" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "dedupeKey" = ${dedupeKey}
  `;
}

async function markFailed(dedupeKey, error) {
  await prisma.$executeRaw`
    UPDATE "WebhookDelivery"
    SET
      "status" = 'FAILED',
      "lastError" = ${String(error?.message || error || "Unknown webhook failure").slice(0, 1000)},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "dedupeKey" = ${dedupeKey}
  `;
}

export async function processWebhookOnce({
  topic,
  shop,
  webhookId,
  entityId,
  body,
  handler,
}) {
  const payloadHash = createPayloadHash(body);
  const dedupeKey = createWebhookDedupeKey({
    topic,
    shop,
    webhookId,
    entityId,
    payloadHash,
  });

  const { locked, result } = await withAdvisoryLock(
    `webhook-delivery:${dedupeKey}`,
    async () => {
      const existingRows = await prisma.$queryRaw`
        SELECT "id", "status", "webhookId", "entityId", "payloadHash"
        FROM "WebhookDelivery"
        WHERE "dedupeKey" = ${dedupeKey}
        LIMIT 1
      `;
      const existing = existingRows[0] || null;

      if (existing?.status === "PROCESSED") {
        return {
          success: true,
          message: "Duplicate ignored",
        };
      }

      if (existing) {
        await prisma.$executeRaw`
          UPDATE "WebhookDelivery"
          SET
            "topic" = ${topic},
            "shop" = ${shop},
            "webhookId" = ${webhookId ?? existing.webhookId},
            "entityId" = ${entityId ?? existing.entityId},
            "payloadHash" = ${payloadHash ?? existing.payloadHash},
            "status" = 'PROCESSING',
            "lastError" = NULL,
            "attemptCount" = "attemptCount" + 1,
            "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${existing.id}
        `;
      } else {
        const recordId = crypto.randomUUID();

        await prisma.$executeRaw`
          INSERT INTO "WebhookDelivery" (
            "id",
            "topic",
            "shop",
            "webhookId",
            "entityId",
            "dedupeKey",
            "payloadHash",
            "status",
            "attemptCount",
            "createdAt",
            "updatedAt"
          )
          VALUES (
            ${recordId},
            ${topic},
            ${shop},
            ${webhookId},
            ${entityId},
            ${dedupeKey},
            ${payloadHash},
            'PROCESSING',
            1,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
        `;
      }

      try {
        const response = await handler();
        await markProcessed(dedupeKey);
        return response;
      } catch (error) {
        await markFailed(dedupeKey, error);
        throw error;
      }
    },
  );

  if (!locked) {
    return {
      success: true,
      message: "Webhook already processing",
    };
  }

  return result;
}
