import { prisma } from "../../Config/database.js";
import * as catalogSnapshotService from "./catalogSnapshotService.js";
import * as domainFreshnessService from "./domainFreshnessService.js";
import * as syncRunService from "./syncRunService.js";

/**
 * Catalog ingest finalization service.
 *
 * Responsibilities:
 * - validate staged catalog batches after JSONL ingest
 * - publish CatalogSnapshot only after validation succeeds
 * - mark CatalogSnapshot / SyncRun failed when ingest fails
 *
 * Not responsible for:
 * - downloading JSONL
 * - parsing JSONL
 * - writing mirror rows
 * - controller response shaping
 */

const FULL_BASELINE_RUN_TYPE = "FULL_BASELINE";
const PRODUCT_DOMAIN = "PRODUCT";

const assertShop = (shop) => {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required");
  }
};

const assertBatchId = (catalogBatchId) => {
  if (!catalogBatchId || typeof catalogBatchId !== "string") {
    throw new Error("catalogBatchId is required");
  }
};

const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const buildValidationError = (message, details = {}) => {
  const error = new Error(message);
  error.code = "CATALOG_BATCH_VALIDATION_FAILED";
  error.httpStatus = 400;
  error.details = details;
  return error;
};

const resolveSyncRun = async ({ shop, syncRunId = null }) => {
  if (syncRunId) {
    return { id: syncRunId };
  }

  return syncRunService.getLatestSyncRun({
    shop,
    runType: FULL_BASELINE_RUN_TYPE,
    domain: PRODUCT_DOMAIN,
    status: "RUNNING",
  });
};

export const validateCatalogBatchAfterIngest = async ({
  shop,
  catalogBatchId,
  expectedProductCount = null,
  requireVariants = false,
}) => {
  assertShop(shop);
  assertBatchId(catalogBatchId);

  const [
    productCount,
    variantCount,
    collectionCount,
    collectionMembershipCount,
    orphanCollectionMembershipRows,
    productMetafieldCount,
    variantMetafieldCount,
    inventoryLevelCount,
  ] = await Promise.all([
    prisma.product.count({
      where: {
        shop,
        catalogBatchId,
      },
    }),
    prisma.variant.count({
      where: {
        shop,
        catalogBatchId,
      },
    }),
    prisma.collection.count({
      where: {
        shop,
        catalogBatchId,
      },
    }),
    prisma.productCollectionMembership.count({
      where: {
        shop,
        catalogBatchId,
      },
    }),
    prisma.$queryRaw`
      SELECT COUNT(*)::integer AS count
      FROM "ProductCollectionMembership" membership
      WHERE membership."shop" = ${shop}
        AND membership."catalogBatchId" = ${catalogBatchId}
        AND NOT EXISTS (
          SELECT 1
          FROM "Collection" collection
          WHERE collection."shop" = membership."shop"
            AND collection."catalogBatchId" = membership."catalogBatchId"
            AND collection."shopifyId" = membership."collectionId"
        )
    `,
    prisma.productTrackedMetafield.count({
      where: {
        shop,
        catalogBatchId,
      },
    }),
    prisma.variantTrackedMetafield.count({
      where: {
        shop,
        catalogBatchId,
      },
    }),
    prisma.variantInventoryLevel.count({
      where: {
        shop,
        catalogBatchId,
      },
    }),
  ]);

  const expected = toSafeNumber(expectedProductCount);
  const details = {
    shop,
    catalogBatchId,
    expectedProductCount: expected || null,
    productCount,
    variantCount,
    collectionCount,
    collectionMembershipCount,
    orphanCollectionMembershipCount:
      Number(orphanCollectionMembershipRows?.[0]?.count || 0),
    productMetafieldCount,
    variantMetafieldCount,
    inventoryLevelCount,
  };

  if (expected <= 0) {
    throw buildValidationError("Expected product count is required before publishing catalog batch", details);
  }

  if (productCount <= 0) {
    throw buildValidationError("Cannot publish an empty product batch", details);
  }

  if (productCount !== expected) {
    throw buildValidationError(
      "Product batch count does not match expected ingest count",
      details,
    );
  }

  if (requireVariants && variantCount <= 0) {
    throw buildValidationError("Cannot publish a product batch with zero variants", details);
  }

  if (collectionMembershipCount > 0 && collectionCount <= 0) {
    throw buildValidationError(
      "Cannot publish collection memberships without collection authority rows",
      details,
    );
  }

  if (details.orphanCollectionMembershipCount > 0) {
    throw buildValidationError(
      "Collection membership batch references collections outside the same catalog batch",
      details,
    );
  }

  return {
    valid: true,
    isConsistent: true,
    ...details,
    actualProductCount: productCount,
    expectedVariantCount: variantCount,
    actualVariantCount: variantCount,
    expectedCollectionMembershipCount: collectionMembershipCount,
    actualCollectionMembershipCount: collectionMembershipCount,
    expectedInventoryLevelCount: inventoryLevelCount,
    actualInventoryLevelCount: inventoryLevelCount,
  };
};

export const finalizeSuccessfulBaselineIngest = async ({
  shop,
  catalogBatchId,
  syncRunId = null,
  expectedProductCount = null,
  responseUrl = null,
  reason = "baseline ingest completed",
}) => {
  assertShop(shop);
  assertBatchId(catalogBatchId);

  const syncRun = await resolveSyncRun({ shop, syncRunId });

  if (syncRun?.id) {
    await syncRunService.heartbeatSyncRun({
      syncRunId: syncRun.id,
      stage: "STAGED_COMPLETE",
    });
  }

  const validation = await validateCatalogBatchAfterIngest({
    shop,
    catalogBatchId,
    expectedProductCount,
  });

  const snapshot = await catalogSnapshotService.finalizeSuccessfulCatalogBatch({
    shop,
    catalogBatchId,
    syncRunId: syncRun?.id || null,
    reason,
    validation: {
      ...validation,
      reason,
    },
  });

  if (syncRun?.id) {
    await syncRunService.markSyncRunCompleted({
      syncRunId: syncRun.id,
      stage: "MIRROR_ACTIVATED",
      rowCount: validation.productCount,
      catalogBatchId,
      responseUrl,
    }).catch(() => {});
  }

  await domainFreshnessService.markDomainsFresh({
    shop,
    domains: [
      domainFreshnessService.FRESHNESS_DOMAIN.PRODUCT,
      domainFreshnessService.FRESHNESS_DOMAIN.PRODUCT_TYPE,
    ],
    lastFreshAt: new Date(),
    source: "BASELINE_INGEST",
    sourceRunId: syncRun?.id || null,
    catalogBatchId,
    details: validation,
  }).catch(() => {});

  return {
    snapshot,
    validation,
    syncRunId: syncRun?.id || null,
  };
};

export const markBaselineIngestFailed = async ({
  shop,
  catalogBatchId = null,
  syncRunId = null,
  error,
  responseUrl = null,
}) => {
  assertShop(shop);

  const failureMessage =
    error?.message || "Catalog baseline ingest failed before activation";
  const syncRun = await resolveSyncRun({ shop, syncRunId }).catch(() => null);
  const resolvedBatchId = catalogBatchId || syncRun?.catalogBatchId || null;

  if (syncRun?.id) {
    await syncRunService.markSyncRunFailed({
      syncRunId: syncRun.id,
      stage: "MIRROR_STAGING_FAILED",
      failureCode: error?.code || "CATALOG_BASELINE_INGEST_FAILED",
      failureMessage,
      catalogBatchId: resolvedBatchId,
      responseUrl,
    }).catch(() => {});
  }

  if (resolvedBatchId) {
    const snapshot = await catalogSnapshotService.getOrCreateBuildingSnapshot({
      shop,
      catalogBatchId: resolvedBatchId,
      reason: "baseline ingest failed",
    }).catch(() => null);

    if (snapshot?.id) {
      await catalogSnapshotService.markSnapshotFailed({
        snapshotId: snapshot.id,
        reason: failureMessage,
      }).catch(() => {});
    }
  }

  await domainFreshnessService.markDomainStale({
    shop,
    domain: domainFreshnessService.FRESHNESS_DOMAIN.PRODUCT,
    staleReason: failureMessage,
    repairRequired: true,
    source: "BASELINE_INGEST",
    sourceRunId: syncRun?.id || null,
    catalogBatchId: resolvedBatchId,
  }).catch(() => {});

  return {
    shop,
    catalogBatchId: resolvedBatchId,
    syncRunId: syncRun?.id || null,
    failed: true,
  };
};
