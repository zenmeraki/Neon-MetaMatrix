import crypto from "crypto";
import { prisma } from "../config/database.js";

export const MIRROR_SOURCE_KINDS = {
  BULK_SYNC: "bulk_sync",
  WEBHOOK_CREATE: "webhook_create",
  WEBHOOK_UPDATE: "webhook_update",
  WEBHOOK_DELETE: "webhook_delete",
  WEBHOOK_SIGNAL: "webhook_signal",
  INCREMENTAL_RECONCILE: "incremental_reconcile",
  DIRECT_RECONCILE: "direct_reconcile",
  REPAIR_SYNC: "repair_sync",
  TOMBSTONE_DELETE: "tombstone_delete",
};

const TOMBSTONE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeTimestamp(value) {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractFreshnessTimestamp(record) {
  return (
    normalizeTimestamp(record?.lastSourceUpdatedAt) ||
    normalizeTimestamp(record?.sourceUpdatedAt) ||
    normalizeTimestamp(record?.updatedAt) ||
    normalizeTimestamp(record?.deletedAt) ||
    normalizeTimestamp(record?.lastSourceEventAt) ||
    normalizeTimestamp(record?.sourceEventAt) ||
    normalizeTimestamp(record?.lastReconciledAt)
  );
}

function isIncomingFresherThanRecord(record, incomingUpdatedAt = null, incomingEventAt = null) {
  const candidate =
    normalizeTimestamp(incomingUpdatedAt) || normalizeTimestamp(incomingEventAt);

  if (!candidate) {
    return true;
  }

  const current = extractFreshnessTimestamp(record);
  if (!current) {
    return true;
  }

  return candidate.getTime() >= current.getTime();
}

export function buildMirrorFreshnessMetadata({
  sourceKind,
  sourceUpdatedAt = null,
  sourceEventAt = null,
  lastReconciledAt = null,
} = {}) {
  return {
    sourceKind: sourceKind || null,
    sourceUpdatedAt: normalizeTimestamp(sourceUpdatedAt),
    sourceEventAt: normalizeTimestamp(sourceEventAt),
    lastReconciledAt: normalizeTimestamp(lastReconciledAt) || new Date(),
  };
}

export async function getLatestProductFreshness({
  shop,
  productId,
  client = prisma,
}) {
  const rows = await client.$queryRaw`
    SELECT *
    FROM (
      SELECT
        "id",
        "shop",
        "mirrorBatchId",
        "updatedAt",
        "lastSourceUpdatedAt",
        "lastSourceEventAt",
        "lastSourceKind",
        "lastReconciledAt",
        NULL::TIMESTAMP(3) AS "deletedAt",
        'product'::TEXT AS "recordType"
      FROM "Product"
      WHERE "shop" = ${shop}
        AND "id" = ${productId}

      UNION ALL

      SELECT
        "productId" AS "id",
        "shop",
        NULL::TEXT AS "mirrorBatchId",
        "updatedAt",
        "sourceUpdatedAt" AS "lastSourceUpdatedAt",
        "sourceEventAt" AS "lastSourceEventAt",
        "sourceKind" AS "lastSourceKind",
        "lastReconciledAt",
        "deletedAt",
        'tombstone'::TEXT AS "recordType"
      FROM "ProductTombstone"
      WHERE "shop" = ${shop}
        AND "productId" = ${productId}
    ) AS freshness
    ORDER BY
      COALESCE(
        "lastSourceUpdatedAt",
        "deletedAt",
        "lastSourceEventAt",
        "updatedAt",
        "lastReconciledAt"
      ) DESC NULLS LAST,
      "updatedAt" DESC NULLS LAST
    LIMIT 1
  `;

  return rows?.[0] || null;
}

export function isIncomingProductStateFresh({
  latest = null,
  sourceUpdatedAt = null,
  sourceEventAt = null,
}) {
  if (!latest) {
    return true;
  }

  return isIncomingFresherThanRecord(latest, sourceUpdatedAt, sourceEventAt);
}

export async function backfillMirrorBatchFreshness({
  shop,
  mirrorBatchId,
  sourceKind = MIRROR_SOURCE_KINDS.BULK_SYNC,
  client = prisma,
}) {
  await client.$executeRaw`
    UPDATE "Product"
    SET
      "lastSourceUpdatedAt" = COALESCE("lastSourceUpdatedAt", "updatedAt"),
      "lastSourceEventAt" = COALESCE("lastSourceEventAt", "updatedAt"),
      "lastSourceKind" = COALESCE("lastSourceKind", ${sourceKind}),
      "lastReconciledAt" = COALESCE("lastReconciledAt", CURRENT_TIMESTAMP),
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "shop" = ${shop}
      AND "mirrorBatchId" = ${mirrorBatchId}
  `;
}

export async function applyProductFreshness({
  shop,
  productId,
  mirrorBatchId = null,
  sourceKind,
  sourceUpdatedAt = null,
  sourceEventAt = null,
  lastReconciledAt = null,
  client = prisma,
}) {
  const freshness = buildMirrorFreshnessMetadata({
    sourceKind,
    sourceUpdatedAt,
    sourceEventAt,
    lastReconciledAt,
  });

  const targetBatchId = mirrorBatchId || "legacy";

  await client.$executeRaw`
    UPDATE "Product"
    SET
      "lastSourceUpdatedAt" = ${freshness.sourceUpdatedAt},
      "lastSourceEventAt" = ${freshness.sourceEventAt},
      "lastSourceKind" = ${freshness.sourceKind},
      "lastReconciledAt" = ${freshness.lastReconciledAt},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "shop" = ${shop}
      AND "id" = ${productId}
      AND "mirrorBatchId" = ${targetBatchId}
  `;
}

export async function upsertProductTombstone({
  shop,
  productId,
  sourceUpdatedAt = null,
  sourceEventAt = null,
  sourceKind = MIRROR_SOURCE_KINDS.TOMBSTONE_DELETE,
  deletedAt = null,
  lastReconciledAt = null,
  client = prisma,
}) {
  const freshness = buildMirrorFreshnessMetadata({
    sourceKind,
    sourceUpdatedAt,
    sourceEventAt,
    lastReconciledAt,
  });
  const normalizedDeletedAt =
    normalizeTimestamp(deletedAt) ||
    freshness.sourceUpdatedAt ||
    freshness.sourceEventAt ||
    new Date();
  const purgeAfter = new Date(normalizedDeletedAt.getTime() + TOMBSTONE_RETENTION_MS);

  await client.$executeRaw`
    INSERT INTO "ProductTombstone" (
      "id",
      "shop",
      "productId",
      "sourceUpdatedAt",
      "sourceEventAt",
      "deletedAt",
      "sourceKind",
      "lastReconciledAt",
      "purgeAfter",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${crypto.randomUUID()},
      ${shop},
      ${productId},
      ${freshness.sourceUpdatedAt},
      ${freshness.sourceEventAt},
      ${normalizedDeletedAt},
      ${freshness.sourceKind},
      ${freshness.lastReconciledAt},
      ${purgeAfter},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("shop", "productId")
    DO UPDATE SET
      "sourceUpdatedAt" = CASE
        WHEN EXCLUDED."sourceUpdatedAt" IS NULL THEN "ProductTombstone"."sourceUpdatedAt"
        WHEN "ProductTombstone"."sourceUpdatedAt" IS NULL THEN EXCLUDED."sourceUpdatedAt"
        ELSE GREATEST("ProductTombstone"."sourceUpdatedAt", EXCLUDED."sourceUpdatedAt")
      END,
      "sourceEventAt" = CASE
        WHEN EXCLUDED."sourceEventAt" IS NULL THEN "ProductTombstone"."sourceEventAt"
        WHEN "ProductTombstone"."sourceEventAt" IS NULL THEN EXCLUDED."sourceEventAt"
        ELSE GREATEST("ProductTombstone"."sourceEventAt", EXCLUDED."sourceEventAt")
      END,
      "deletedAt" = CASE
        WHEN "ProductTombstone"."deletedAt" IS NULL THEN EXCLUDED."deletedAt"
        ELSE GREATEST("ProductTombstone"."deletedAt", EXCLUDED."deletedAt")
      END,
      "sourceKind" = EXCLUDED."sourceKind",
      "lastReconciledAt" = EXCLUDED."lastReconciledAt",
      "purgeAfter" = EXCLUDED."purgeAfter",
      "updatedAt" = CURRENT_TIMESTAMP
  `;
}

export async function clearProductTombstone({
  shop,
  productId,
  client = prisma,
}) {
  await client.$executeRaw`
    DELETE FROM "ProductTombstone"
    WHERE "shop" = ${shop}
      AND "productId" = ${productId}
  `;
}

export async function purgeExpiredProductTombstones({
  limit = 1000,
  client = prisma,
}) {
  const rows = await client.$queryRaw`
    SELECT "id"
    FROM "ProductTombstone"
    WHERE "purgeAfter" IS NOT NULL
      AND "purgeAfter" < CURRENT_TIMESTAMP
    ORDER BY "purgeAfter" ASC
    LIMIT ${limit}
  `;

  const ids = rows.map((row) => row.id).filter(Boolean);
  if (!ids.length) {
    return 0;
  }

  await client.$executeRaw`
    DELETE FROM "ProductTombstone"
    WHERE "id" = ANY(${ids})
  `;

  return ids.length;
}

export async function getProductTombstonesByIds({
  shop,
  productIds = [],
  client = prisma,
}) {
  const ids = Array.from(
    new Set((productIds || []).map((id) => String(id || "").trim()).filter(Boolean)),
  );

  if (!ids.length) {
    return new Map();
  }

  const rows = await client.$queryRaw`
    SELECT
      "shop",
      "productId",
      "sourceUpdatedAt",
      "sourceEventAt",
      "deletedAt",
      "sourceKind",
      "lastReconciledAt",
      "updatedAt"
    FROM "ProductTombstone"
    WHERE "shop" = ${shop}
      AND "productId" = ANY(${ids})
  `;

  return new Map(rows.map((row) => [row.productId, row]));
}

export async function splitProductRowsAgainstTombstones({
  shop,
  productRows = [],
  variantRows = [],
  client = prisma,
}) {
  if (!productRows.length) {
    return {
      productRows,
      variantRows,
      blockedProductIds: [],
    };
  }

  const tombstones = await getProductTombstonesByIds({
    shop,
    productIds: productRows.map((row) => row.id),
    client,
  });

  if (!tombstones.size) {
    return {
      productRows,
      variantRows,
      blockedProductIds: [],
    };
  }

  const allowedProductIds = new Set();
  const blockedProductIds = [];

  for (const row of productRows) {
    const tombstone = tombstones.get(row.id);
    if (
      tombstone &&
      !isIncomingFresherThanRecord(
        tombstone,
        row.lastSourceUpdatedAt || row.updatedAt || null,
        row.lastSourceEventAt || null,
      )
    ) {
      blockedProductIds.push(row.id);
      continue;
    }

    allowedProductIds.add(row.id);
  }

  return {
    productRows: productRows.filter((row) => allowedProductIds.has(row.id)),
    variantRows: variantRows.filter((row) => allowedProductIds.has(row.productId)),
    blockedProductIds,
  };
}
