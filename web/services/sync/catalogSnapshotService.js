import { prisma } from "../../Config/database.js";
import * as catalogSnapshotRepository from "../../repositories/catalogSnapshotRepository.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { logBatchEvent } from "../../utils/batchObservability.js";
import * as syncRunService from "./syncRunService.js";

/**
 * Catalog snapshot orchestration service.
 *
 * Responsibilities:
 * - create BUILDING snapshots
 * - validate activation prerequisites
 * - activate snapshots
 * - mirror active batch to Store temporarily for compatibility
 * - mark failed snapshots
 * - expose active snapshot lookup for read paths
 *
 * Not responsible for:
 * - Shopify API calls
 * - JSONL ingestion
 * - controller response shaping
 */

const PRODUCT_SYNC_CACHE_KEY = (shop) => `${shop}:sync_details`;

const SNAPSHOT_STATUS = {
  BUILDING: "BUILDING",
  ACTIVE: "ACTIVE",
  SUPERSEDED: "SUPERSEDED",
  FAILED: "FAILED",
};

const CATALOG_SNAPSHOT_SCHEMA_VERSION = "catalog-snapshot-v1";

const assertShop = (shop) => {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required");
  }
};

const assertSnapshotId = (snapshotId) => {
  if (!snapshotId || typeof snapshotId !== "string") {
    throw new Error("snapshotId is required");
  }
};

const assertCatalogBatchId = (catalogBatchId) => {
  if (!catalogBatchId || typeof catalogBatchId !== "string") {
    throw new Error("catalogBatchId is required");
  }
};

const assertSnapshotSchemaVersion = (snapshot) => {
  if (snapshot?.schemaVersion && snapshot.schemaVersion !== CATALOG_SNAPSHOT_SCHEMA_VERSION) {
    throw buildConflictError("Catalog snapshot schema version is not compatible", {
      snapshotId: snapshot.id || snapshot.snapshotId || null,
      schemaVersion: snapshot.schemaVersion,
      expectedSchemaVersion: CATALOG_SNAPSHOT_SCHEMA_VERSION,
    });
  }
};

const buildNotFoundError = (message, code = "NOT_FOUND") => {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = 404;
  return error;
};

const buildConflictError = (message, details = null) => {
  const error = new Error(message);
  error.code = "SNAPSHOT_CONFLICT";
  error.httpStatus = 409;
  error.details = details;
  return error;
};

export class MirrorNotReadyError extends Error {
  constructor(shop, details = {}) {
    super("Active catalog snapshot is not ready for mirror reads");
    this.name = "MirrorNotReadyError";
    this.code = "MIRROR_NOT_READY";
    this.httpStatus = 409;
    this.details = {
      shop,
      ...details,
    };
  }
}

const normalizeExpectedCount = (value) => {
  if (value === null || typeof value === "undefined") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const requireExpectedCount = (value, label, details) => {
  const normalized = normalizeExpectedCount(value);
  if (normalized === null) {
    const error = new Error(`${label} expected count is required for snapshot activation`);
    error.code = "CATALOG_EXPECTED_COUNT_MISSING";
    error.httpStatus = 400;
    error.details = {
      ...details,
      domain: label,
    };
    throw error;
  }

  return normalized;
};

const assertExpectedCountMatches = ({
  expected,
  actual,
  label,
  details,
}) => {
  if (expected !== null && actual !== expected) {
    const error = new Error(`${label} count does not match expected count`);
    error.code = "CATALOG_DOMAIN_COUNT_MISMATCH";
    error.httpStatus = 400;
    error.details = {
      ...details,
      expected,
      actual,
      domain: label,
    };
    throw error;
  }
};

const buildConsistencyPayload = ({
  reason,
  expectedProductCount,
  actualProductCount,
  expectedVariantCount,
  actualVariantCount,
  expectedCollectionMembershipCount,
  actualCollectionMembershipCount,
  expectedInventoryLevelCount,
  actualInventoryLevelCount,
  isConsistent = true,
}) => ({
  isConsistent: Boolean(isConsistent),
  reason: reason || null,
  expectedProductCount: normalizeExpectedCount(expectedProductCount),
  actualProductCount,
  expectedVariantCount: normalizeExpectedCount(expectedVariantCount),
  actualVariantCount,
  expectedCollectionMembershipCount: normalizeExpectedCount(
    expectedCollectionMembershipCount,
  ),
  actualCollectionMembershipCount,
  expectedInventoryLevelCount: normalizeExpectedCount(
    expectedInventoryLevelCount,
  ),
  actualInventoryLevelCount,
});

const buildSkippedValidationPayload = (reason = "activation validation skipped") =>
  buildConsistencyPayload({
    reason,
    actualProductCount: null,
    actualVariantCount: null,
    actualCollectionMembershipCount: null,
    actualInventoryLevelCount: null,
    isConsistent: false,
  });

const validateCatalogBatchForActivation = async ({
  shop,
  catalogBatchId,
  expectedProductCount = null,
  expectedVariantCount = null,
  expectedCollectionMembershipCount = null,
  expectedInventoryLevelCount = null,
  reason = null,
}) => {
  const [
    productCount,
    variantCount,
    collectionCount,
    collectionMembershipCount,
    orphanCollectionMembershipRows,
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
    prisma.variantInventoryLevel.count({
      where: {
        shop,
        catalogBatchId,
      },
    }),
  ]);

  const details = {
    shop,
    catalogBatchId,
    productCount,
    variantCount,
    collectionCount,
    collectionMembershipCount,
    orphanCollectionMembershipCount:
      Number(orphanCollectionMembershipRows?.[0]?.count || 0),
    inventoryLevelCount,
  };

  if (productCount <= 0) {
    const error = new Error("Cannot activate snapshot with zero products");
    error.code = "EMPTY_PRODUCT_BATCH";
    error.httpStatus = 400;
    error.details = {
      ...details,
    };
    throw error;
  }

  const missingRequiredDomains = [];

  if (variantCount <= 0) {
    missingRequiredDomains.push("variants");
  }

  if (collectionMembershipCount <= 0) {
    missingRequiredDomains.push("collection_memberships");
  }

  if (collectionCount <= 0) {
    missingRequiredDomains.push("collections");
  }

  if (details.orphanCollectionMembershipCount > 0) {
    missingRequiredDomains.push("collection_membership_authority");
  }

  if (inventoryLevelCount <= 0) {
    missingRequiredDomains.push("inventory_levels");
  }

  if (missingRequiredDomains.length > 0) {
    const error = new Error("Cannot activate snapshot with missing required catalog domains");
    error.code = "CATALOG_REQUIRED_DOMAIN_MISSING";
    error.httpStatus = 400;
    error.details = {
      ...details,
      missingRequiredDomains,
    };
    throw error;
  }

  const normalizedExpectedProductCount = requireExpectedCount(
    expectedProductCount,
    "product",
    details,
  );
  const normalizedExpectedVariantCount = requireExpectedCount(
    expectedVariantCount,
    "variant",
    details,
  );
  const normalizedExpectedCollectionMembershipCount = requireExpectedCount(
    expectedCollectionMembershipCount,
    "collection membership",
    details,
  );
  const normalizedExpectedInventoryLevelCount = requireExpectedCount(
    expectedInventoryLevelCount,
    "inventory level",
    details,
  );

  assertExpectedCountMatches({
    expected: normalizedExpectedProductCount,
    actual: productCount,
    label: "product",
    details,
  });
  assertExpectedCountMatches({
    expected: normalizedExpectedVariantCount,
    actual: variantCount,
    label: "variant",
    details,
  });
  assertExpectedCountMatches({
    expected: normalizedExpectedCollectionMembershipCount,
    actual: collectionMembershipCount,
    label: "collection membership",
    details,
  });
  assertExpectedCountMatches({
    expected: normalizedExpectedInventoryLevelCount,
    actual: inventoryLevelCount,
    label: "inventory level",
    details,
  });

  return buildConsistencyPayload({
    reason,
    expectedProductCount: normalizedExpectedProductCount,
    actualProductCount: productCount,
    expectedVariantCount: normalizedExpectedVariantCount,
    actualVariantCount: variantCount,
    expectedCollectionMembershipCount:
      normalizedExpectedCollectionMembershipCount,
    actualCollectionMembershipCount: collectionMembershipCount,
    expectedInventoryLevelCount: normalizedExpectedInventoryLevelCount,
    actualInventoryLevelCount: inventoryLevelCount,
    isConsistent: true,
  });
};

/**
 * Create a BUILDING snapshot for a catalog batch.
 *
 * Safe to call when a new baseline sync begins or after staging completes.
 */
export const createBuildingSnapshot = async ({
  shop,
  catalogBatchId,
  syncRunId = null,
  schemaVersion = CATALOG_SNAPSHOT_SCHEMA_VERSION,
  reason = null,
}) => {
  assertShop(shop);
  assertCatalogBatchId(catalogBatchId);

  const existing = await catalogSnapshotRepository.findSnapshotByBatchId(
    shop,
    catalogBatchId,
  );

  if (existing) {
    const error = new Error("Catalog snapshot already exists for this batch");
    error.code = "CATALOG_SNAPSHOT_ALREADY_EXISTS";
    error.httpStatus = 409;
    error.details = {
      shop,
      catalogBatchId,
      existingSnapshotId: existing.id,
      existingSyncRunId: existing.syncRunId || null,
      requestedSyncRunId: syncRunId,
    };
    throw error;
  }

  return catalogSnapshotRepository.createBuildingSnapshot({
    shop,
    catalogBatchId,
    syncRunId,
    schemaVersion,
    reason,
  });
};

/**
 * Mark snapshot as failed.
 */
export const markSnapshotFailed = async ({
  snapshotId,
  reason = null,
}) => {
  assertSnapshotId(snapshotId);

  const existing = await catalogSnapshotRepository.findSnapshotById(snapshotId);

  if (!existing) {
    throw buildNotFoundError("CatalogSnapshot not found", "SNAPSHOT_NOT_FOUND");
  }

  const failed = await catalogSnapshotRepository.markSnapshotFailed(snapshotId, {
    reason,
  });

  if (existing.syncRunId) {
    await syncRunService.markSyncRunFailed({
      syncRunId: existing.syncRunId,
      stage: "SNAPSHOT_FAILED",
      failureCode: "CATALOG_SNAPSHOT_FAILED",
      failureMessage: reason || "Catalog snapshot failed",
    }).catch(() => {});
  }

  return failed;
};

/**
 * Return the current active snapshot.
 *
 * This becomes the future canonical read entrypoint.
 */
export const getActiveCatalogSnapshot = async ({ shop }) => {
  return getActiveBatchIds({ shop, path: "active_catalog_snapshot" });
};

const buildActiveSnapshotReadContract = (snapshot) => ({
  catalogBatchId: snapshot.catalogBatchId,
  snapshotId: snapshot.snapshotId || null,
  catalogSnapshotId: snapshot.snapshotId || null,
  productBatchId: snapshot.catalogBatchId,
  variantBatchId: snapshot.catalogBatchId,
  collectionBatchId: snapshot.catalogBatchId,
  inventoryBatchId: snapshot.catalogBatchId,
  isConsistent: snapshot.isConsistent === true,
  consistencyCheckedAt: snapshot.consistencyCheckedAt || null,
  activatedAt: snapshot.activatedAt || null,
  consistencyReason: snapshot.reason || null,
});

export const getActiveBatchIds = async ({ shop, path = "batch_resolution" }) => {
  assertShop(shop);

  const snapshot =
    await catalogSnapshotRepository.findActiveCatalogSnapshotPointer(shop, {
      select: {
        shop: true,
        catalogBatchId: true,
        snapshotId: true,
        isConsistent: true,
        consistencyCheckedAt: true,
        reason: true,
        activatedAt: true,
      },
    });

  if (!snapshot?.catalogBatchId || !snapshot?.snapshotId) {
    logBatchEvent("catalog_batch_resolution", {
      shop,
      path,
      extra: {
        source: "ACTIVE_CATALOG_SNAPSHOT",
        status: "missing",
        reason: snapshot?.reason || "active_catalog_snapshot_missing",
      },
    });

    throw new MirrorNotReadyError(shop, {
      reason: snapshot?.reason || "active_catalog_snapshot_missing",
      catalogBatchId: snapshot?.catalogBatchId || null,
      snapshotId: snapshot?.snapshotId || null,
    });
  }

  if (snapshot.isConsistent !== true) {
    logBatchEvent("catalog_batch_resolution", {
      shop,
      resolvedCatalogBatchId: snapshot.catalogBatchId,
      path,
      extra: {
        source: "ACTIVE_CATALOG_SNAPSHOT",
        status: "inconsistent",
        snapshotId: snapshot.snapshotId || null,
        reason: snapshot.reason || null,
      },
    });

    throw new MirrorNotReadyError(shop, {
      reason: snapshot.reason || "active_catalog_snapshot_inconsistent",
      catalogBatchId: snapshot.catalogBatchId,
      snapshotId: snapshot.snapshotId || null,
      isConsistent: false,
      consistencyCheckedAt: snapshot.consistencyCheckedAt || null,
      activatedAt: snapshot.activatedAt || null,
    });
  }

  logBatchEvent("catalog_batch_resolution", {
    shop,
    resolvedCatalogBatchId: snapshot.catalogBatchId,
    path,
    extra: {
      source: "ACTIVE_CATALOG_SNAPSHOT",
      status: "ready",
      snapshotId: snapshot.snapshotId || null,
    },
  });

  return buildActiveSnapshotReadContract(snapshot);
};

export const getCatalogSnapshotReadFlags = async ({ shop }) => {
  assertShop(shop);

  return {
    catalogSnapshotReadEnabled: true,
    catalogSnapshotExecutionEnabled: true,
    catalogSnapshotSchedulerEnabled: true,
  };
};

export const isCatalogSnapshotReadEnabledForPath = async ({
  shop,
  path = "preview",
}) => {
  const flags = await getCatalogSnapshotReadFlags({ shop });

  return {
    enabled: true,
    flagName: "catalogSnapshotReadEnabled",
    flags,
  };
};

export const resolveActiveCatalogSnapshot = async ({
  shop,
  path = "batch_resolution",
} = {}) => {
  assertShop(shop);

  const activeSnapshot =
    await catalogSnapshotRepository.findActiveCatalogSnapshotPointer(shop, {
      select: {
        shop: true,
        catalogBatchId: true,
        isConsistent: true,
        reason: true,
        snapshotId: true,
      },
    });

  if (!activeSnapshot?.catalogBatchId || activeSnapshot.isConsistent !== true) {
    logBatchEvent("catalog_batch_resolution", {
      shop,
      resolvedCatalogBatchId: activeSnapshot?.catalogBatchId || null,
      path,
      extra: {
        source: "ACTIVE_CATALOG_SNAPSHOT",
        status: activeSnapshot?.catalogBatchId ? "inconsistent" : "missing",
        snapshotId: activeSnapshot?.snapshotId || null,
        reason: activeSnapshot?.reason || "active_catalog_snapshot_missing",
      },
    });

    throw new MirrorNotReadyError(shop, {
      reason: activeSnapshot?.reason || "active_catalog_snapshot_missing",
      catalogBatchId: activeSnapshot?.catalogBatchId || null,
      snapshotId: activeSnapshot?.snapshotId || null,
      isConsistent: activeSnapshot?.isConsistent === true,
    });
  }

  logBatchEvent("catalog_batch_resolution", {
    shop,
    newCatalogBatchId: activeSnapshot.catalogBatchId,
    resolvedCatalogBatchId: activeSnapshot.catalogBatchId,
    path,
    extra: {
      source: "ACTIVE_CATALOG_SNAPSHOT",
      snapshotId: activeSnapshot.snapshotId || null,
      isConsistent: true,
    },
  });

  return {
    catalogBatchId: activeSnapshot.catalogBatchId,
    snapshotId: activeSnapshot.snapshotId || null,
  };
};

/**
 * Resolve active catalog batch id safely.
 *
 * Resolve active catalog batch id.
 *
 * CatalogSnapshot is the canonical publish point. Store fallback is available
 * only for explicit legacy callers while old installs are repaired.
 */
export const getActiveCatalogBatchId = async ({
  shop,
  path = "batch_resolution",
} = {}) => {
  return resolveActiveCatalogSnapshot({
    shop,
    path,
  });
};

/**
 * Activate a snapshot after validating the batch.
 *
 * This is the critical publish point.
 */
export const activateCatalogSnapshot = async ({
  shop,
  snapshotId,
  validation = null,
}) => {
  assertShop(shop);
  assertSnapshotId(snapshotId);

  const snapshot = await catalogSnapshotRepository.findSnapshotById(snapshotId, {
    select: {
      id: true,
      shop: true,
      catalogBatchId: true,
      syncRunId: true,
      schemaVersion: true,
      status: true,
      reason: true,
      expectedProductCount: true,
      expectedVariantCount: true,
      expectedCollectionMembershipCount: true,
      expectedInventoryLevelCount: true,
      createdAt: true,
    },
  });

  if (!snapshot) {
    throw buildNotFoundError("CatalogSnapshot not found", "SNAPSHOT_NOT_FOUND");
  }

  assertSnapshotSchemaVersion(snapshot);

  if (snapshot.shop !== shop) {
    throw buildConflictError("Snapshot does not belong to the provided shop", {
      snapshotShop: snapshot.shop,
      requestedShop: shop,
      snapshotId,
    });
  }

  if (snapshot.syncRunId) {
    const syncRun = await syncRunService.getSyncRunById({
      syncRunId: snapshot.syncRunId,
    });

    if (!syncRun || syncRun.catalogBatchId !== snapshot.catalogBatchId) {
      throw buildConflictError("Snapshot ownership does not match its SyncRun", {
        snapshotId,
        syncRunId: snapshot.syncRunId,
        catalogBatchId: snapshot.catalogBatchId,
        syncRunCatalogBatchId: syncRun?.catalogBatchId || null,
      });
    }

    if (syncRun.stage !== "STAGED_COMPLETE") {
      throw buildConflictError("Cannot activate snapshot before ingestion is staged complete", {
        snapshotId,
        syncRunId: snapshot.syncRunId,
        syncRunStage: syncRun.stage || null,
      });
    }
  }

  if (snapshot.status === SNAPSHOT_STATUS.ACTIVE) {
    logBatchEvent("catalog_batch_activation", {
      shop,
      newCatalogBatchId: snapshot.catalogBatchId,
      resolvedCatalogBatchId: snapshot.catalogBatchId,
      path: "activation",
      extra: {
        snapshotId,
        status: "already_active",
      },
    });

    const activePointer =
      await catalogSnapshotRepository.findActiveCatalogSnapshotPointer(shop);

    if (
      activePointer?.catalogBatchId === snapshot.catalogBatchId &&
      activePointer?.snapshotId === snapshot.id &&
      activePointer?.isConsistent === true
    ) {
      return snapshot;
    }

    const consistency = await validateCatalogBatchForActivation({
      shop,
      catalogBatchId: snapshot.catalogBatchId,
      expectedProductCount: validation?.expectedProductCount ?? snapshot.expectedProductCount,
      expectedVariantCount: validation?.expectedVariantCount ?? snapshot.expectedVariantCount,
      expectedCollectionMembershipCount:
        validation?.expectedCollectionMembershipCount ??
        snapshot.expectedCollectionMembershipCount,
      expectedInventoryLevelCount:
        validation?.expectedInventoryLevelCount ?? snapshot.expectedInventoryLevelCount,
      reason: validation?.reason || snapshot.reason,
    });

    return catalogSnapshotRepository.activateCatalogSnapshot(snapshotId, {
      shop,
      consistency,
    });
  }

  if (snapshot.status === SNAPSHOT_STATUS.FAILED) {
    throw buildConflictError("Cannot activate a failed snapshot", {
      snapshotId,
      shop,
      status: snapshot.status,
    });
  }

  const newerSnapshot = await prisma.catalogSnapshot.findFirst({
    where: {
      shop,
      createdAt: {
        gt: snapshot.createdAt,
      },
      status: {
        in: [SNAPSHOT_STATUS.BUILDING, SNAPSHOT_STATUS.ACTIVE],
      },
      NOT: {
        id: snapshot.id,
      },
    },
    select: {
      id: true,
      status: true,
      catalogBatchId: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (newerSnapshot) {
    throw buildConflictError("Cannot activate an older catalog snapshot while a newer snapshot exists", {
      snapshotId,
      newerSnapshotId: newerSnapshot.id,
      newerCatalogBatchId: newerSnapshot.catalogBatchId,
      newerStatus: newerSnapshot.status,
    });
  }

  const consistency = await validateCatalogBatchForActivation({
    shop,
    catalogBatchId: snapshot.catalogBatchId,
    expectedProductCount: validation?.expectedProductCount ?? snapshot.expectedProductCount,
    expectedVariantCount: validation?.expectedVariantCount ?? snapshot.expectedVariantCount,
    expectedCollectionMembershipCount:
      validation?.expectedCollectionMembershipCount ??
      snapshot.expectedCollectionMembershipCount,
    expectedInventoryLevelCount:
      validation?.expectedInventoryLevelCount ?? snapshot.expectedInventoryLevelCount,
    reason: validation?.reason || snapshot.reason,
  });

  logBatchEvent("catalog_batch_activation", {
    shop,
    newCatalogBatchId: snapshot.catalogBatchId,
    resolvedCatalogBatchId: snapshot.catalogBatchId,
    path: "activation",
    extra: {
      snapshotId,
      status: "activating",
    },
  });

  const activated = await catalogSnapshotRepository.activateCatalogSnapshot(
    snapshotId,
    { shop, consistency },
  );

  // Release any reconcile signals that were held while this snapshot was
  // BUILDING. They arrive here with status "pendingActivation" and must be
  // reset to "pending" so the reconcile worker picks them up against the
  // newly active snapshot.
  await prisma.mirrorReconcileSignal.updateMany({
    where: { shop, status: "pendingActivation" },
    data: { status: "pending", updatedAt: new Date() },
  });

  logBatchEvent("catalog_batch_activation", {
    shop,
    newCatalogBatchId: activated.catalogBatchId,
    resolvedCatalogBatchId: activated.catalogBatchId,
    path: "activation",
    extra: {
      snapshotId,
      status: "activated",
    },
  });

  await clearKeyCaches(PRODUCT_SYNC_CACHE_KEY(shop));

  return activated;
};

/**
 * Create a BUILDING snapshot if needed, then activate it.
 *
 * This is a convenient one-shot publish path for current sync flows.
 */
export const createAndActivateCatalogSnapshot = async ({
  shop,
  catalogBatchId,
  syncRunId = null,
  reason = null,
  validation = null,
}) => {
  assertShop(shop);
  assertCatalogBatchId(catalogBatchId);

  const snapshot = await createBuildingSnapshot({
    shop,
    catalogBatchId,
    syncRunId,
    reason,
  });

  return activateCatalogSnapshot({
    shop,
    snapshotId: snapshot.id,
    validation,
  });
};

/**
 * Return snapshot information for a given batch, or create BUILDING if missing.
 *
 * Useful during phased migration when some flows know batch id but do not yet
 * explicitly create snapshots earlier in the pipeline.
 */
export const getOrCreateBuildingSnapshot = async ({
  shop,
  catalogBatchId,
  syncRunId = null,
  reason = null,
}) => {
  assertShop(shop);
  assertCatalogBatchId(catalogBatchId);

  const existing = await catalogSnapshotRepository.findSnapshotByBatchId(
    shop,
    catalogBatchId,
  );

  if (existing) {
    if (syncRunId && existing.syncRunId === syncRunId) {
      return existing;
    }

    const error = new Error("Catalog snapshot already exists for this batch");
    error.code = "CATALOG_SNAPSHOT_ALREADY_EXISTS";
    error.httpStatus = 409;
    error.details = {
      shop,
      catalogBatchId,
      existingSnapshotId: existing.id,
      existingSyncRunId: existing.syncRunId || null,
      requestedSyncRunId: syncRunId,
    };
    throw error;
  }

  return createBuildingSnapshot({
    shop,
    catalogBatchId,
    syncRunId,
    reason,
  });
};

/**
 * Safe helper for status screens / diagnostics.
 */
export const getCatalogSnapshotStatus = async ({ shop }) => {
  assertShop(shop);

  const [activeSnapshot, latestSnapshot] = await Promise.all([
    catalogSnapshotRepository.findActiveCatalogSnapshot(shop),
    catalogSnapshotRepository.findLatestSnapshot(shop, {
      status: {
        not: SNAPSHOT_STATUS.FAILED,
      },
    }),
  ]);

  return {
    shop,
    activeSnapshot,
    latestSnapshot,
  };
};

/**
 * Transitional helper for sync finalization.
 *
 * When a sync successfully finishes mirror staging, call this.
 */
export const finalizeSuccessfulCatalogBatch = async ({
  shop,
  catalogBatchId,
  syncRunId = null,
  reason = null,
  validation = null,
}) => {
  return createAndActivateCatalogSnapshot({
    shop,
    catalogBatchId,
    syncRunId,
    reason,
    validation,
  });
};
