import crypto from "crypto";
import { prisma } from "../config/database.js";

const ENTITY_TYPE_PRODUCT = "product";
const STALE_PROCESSING_MS = 10 * 60 * 1000;

function normalizeTimestamp(value) {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function recordProductReconcileSignal({
  shop,
  productId,
  topic = null,
  webhookId = null,
  payloadHash = null,
  sourceUpdatedAt = null,
  sourceEventAt = null,
  sourceKind = null,
  client = prisma,
}) {
  const normalizedSourceUpdatedAt = normalizeTimestamp(sourceUpdatedAt);
  const normalizedSourceEventAt = normalizeTimestamp(sourceEventAt);

  await client.$executeRaw`
    INSERT INTO "MirrorReconcileSignal" (
      "id",
      "shop",
      "entityType",
      "entityId",
      "topic",
      "status",
      "signalCount",
      "latestWebhookId",
      "latestPayloadHash",
      "latestEventAt",
      "latestSourceUpdatedAt",
      "latestSourceKind",
      "processingToken",
      "processingStartedAt",
      "reconciledAt",
      "lastError",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${crypto.randomUUID()},
      ${shop},
      ${ENTITY_TYPE_PRODUCT},
      ${productId},
      ${topic},
      'pending',
      1,
      ${webhookId},
      ${payloadHash},
      ${normalizedSourceEventAt},
      ${normalizedSourceUpdatedAt},
      ${sourceKind},
      NULL,
      NULL,
      NULL,
      NULL,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("shop", "entityType", "entityId")
    DO UPDATE SET
      "topic" = EXCLUDED."topic",
      "status" = 'pending',
      "signalCount" = "MirrorReconcileSignal"."signalCount" + 1,
      "latestWebhookId" = COALESCE(EXCLUDED."latestWebhookId", "MirrorReconcileSignal"."latestWebhookId"),
      "latestPayloadHash" = COALESCE(EXCLUDED."latestPayloadHash", "MirrorReconcileSignal"."latestPayloadHash"),
      "latestEventAt" = CASE
        WHEN EXCLUDED."latestEventAt" IS NULL THEN "MirrorReconcileSignal"."latestEventAt"
        WHEN "MirrorReconcileSignal"."latestEventAt" IS NULL THEN EXCLUDED."latestEventAt"
        ELSE GREATEST("MirrorReconcileSignal"."latestEventAt", EXCLUDED."latestEventAt")
      END,
      "latestSourceUpdatedAt" = CASE
        WHEN EXCLUDED."latestSourceUpdatedAt" IS NULL THEN "MirrorReconcileSignal"."latestSourceUpdatedAt"
        WHEN "MirrorReconcileSignal"."latestSourceUpdatedAt" IS NULL THEN EXCLUDED."latestSourceUpdatedAt"
        ELSE GREATEST("MirrorReconcileSignal"."latestSourceUpdatedAt", EXCLUDED."latestSourceUpdatedAt")
      END,
      "latestSourceKind" = COALESCE(EXCLUDED."latestSourceKind", "MirrorReconcileSignal"."latestSourceKind"),
      "processingToken" = NULL,
      "processingStartedAt" = NULL,
      "lastError" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
  `;
}

export async function claimProductReconcileSignal({
  shop,
  productId,
  client = prisma,
}) {
  const token = crypto.randomUUID();
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);

  const rows = await client.$queryRaw`
    UPDATE "MirrorReconcileSignal"
    SET
      "status" = 'processing',
      "processingToken" = ${token},
      "processingStartedAt" = CURRENT_TIMESTAMP,
      "lastError" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "shop" = ${shop}
      AND "entityType" = ${ENTITY_TYPE_PRODUCT}
      AND "entityId" = ${productId}
      AND (
        "status" = 'pending'
        OR "status" = 'failed'
        OR (
          "status" = 'processing'
          AND (
            "processingStartedAt" IS NULL
            OR "processingStartedAt" < ${staleBefore}
          )
        )
      )
    RETURNING *
  `;

  const signal = rows?.[0] || null;
  if (!signal) {
    return null;
  }

  return {
    ...signal,
    processingToken: token,
  };
}

export async function markProductReconcileSignalProcessed({
  shop,
  productId,
  processingToken,
  client = prisma,
}) {
  const rows = await client.$queryRaw`
    UPDATE "MirrorReconcileSignal"
    SET
      "status" = 'reconciled',
      "processingToken" = NULL,
      "processingStartedAt" = NULL,
      "reconciledAt" = CURRENT_TIMESTAMP,
      "lastError" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "shop" = ${shop}
      AND "entityType" = ${ENTITY_TYPE_PRODUCT}
      AND "entityId" = ${productId}
      AND "processingToken" = ${processingToken}
    RETURNING *
  `;

  return rows?.[0] || null;
}

export async function markProductReconcileSignalFailed({
  shop,
  productId,
  processingToken = null,
  error,
  client = prisma,
}) {
  const rows = await client.$queryRaw`
    UPDATE "MirrorReconcileSignal"
    SET
      "status" = 'failed',
      "processingToken" = NULL,
      "processingStartedAt" = NULL,
      "lastError" = ${String(error?.message || error || "Unknown reconcile failure").slice(0, 1000)},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "shop" = ${shop}
      AND "entityType" = ${ENTITY_TYPE_PRODUCT}
      AND "entityId" = ${productId}
      AND (${processingToken} IS NULL OR "processingToken" = ${processingToken})
    RETURNING *
  `;

  return rows?.[0] || null;
}

export async function getPendingProductReconcileSignals({
  limit = 100,
  client = prisma,
}) {
  return client.$queryRaw`
    SELECT *
    FROM "MirrorReconcileSignal"
    WHERE "entityType" = ${ENTITY_TYPE_PRODUCT}
      AND "status" IN ('pending', 'failed')
    ORDER BY "updatedAt" ASC
    LIMIT ${limit}
  `;
}

export async function getReconcileSignalStatus({
  shop,
  productId,
  client = prisma,
}) {
  const rows = await client.$queryRaw`
    SELECT *
    FROM "MirrorReconcileSignal"
    WHERE "shop" = ${shop}
      AND "entityType" = ${ENTITY_TYPE_PRODUCT}
      AND "entityId" = ${productId}
    LIMIT 1
  `;

  return rows?.[0] || null;
}
