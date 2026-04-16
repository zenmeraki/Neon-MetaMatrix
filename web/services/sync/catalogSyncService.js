import { prisma } from "../../Config/database.js";
import {
  getCurrentBulkOperationStatus,
  runBulkQuery,
} from "../../utils/bulkOperationHelper.js";
import {
  CATALOG_BULK_QUERY_DEFINITIONS,
} from "../../graphql/catalogBulkQueries.js";
import { logBatchEvent } from "../../utils/batchObservability.js";
import { sha256Hex } from "../../utils/deterministicHashUtils.js";
import {
  acquireExclusiveShopWork,
  releaseExclusiveShopWork,
} from "../shopWorkLeaseService.js";
import * as catalogSnapshotService from "./catalogSnapshotService.js";
import { requireActiveCatalogBatchId } from "./catalogBatchKeyService.js";
import * as domainFreshnessService from "./domainFreshnessService.js";
import * as syncRunService from "./syncRunService.js";

/**
 * Transitional catalog sync orchestrator.
 *
 * Current responsibility:
 * - decide whether sync can start
 * - decide whether sync should be skipped
 * - kick off Shopify bulk operation
 * - write compatibility records to existing Store / SyncHistory tables
 * - create/update new SyncRun truth
 * - create BUILDING CatalogSnapshot for the new batch
 *
 * Not this file's responsibility yet:
 * - JSONL ingestion
 * - artifact download
 * - checksum computation
 * - final snapshot activation after validated staging
 *
 * Those will move into dedicated workers/services later.
 */

const ACTIVE_QUERY_RUNNING_STATUSES = new Set([
  "CREATED",
  "RUNNING",
  "CANCELING",
]);

const DEFAULT_OPERATION_TYPE = "Product";
const DEFAULT_COLLECTION_OPERATION_TYPE = "Collection";
const DEFAULT_PRODUCT_TYPE_OPERATION_TYPE = "ProductType";
const DEFAULT_METAFIELD_OPERATION_TYPE = "TrackedMetafield";
const DEFAULT_INVENTORY_OPERATION_TYPE = "InventoryLevel";

const BULK_QUERY = CATALOG_BULK_QUERY_DEFINITIONS;

const SYNC_RUN_TYPE = {
  FULL_BASELINE: "FULL_BASELINE",
  DOMAIN_REPAIR: "DOMAIN_REPAIR",
};

const CATALOG_DOMAIN = {
  COLLECTION: "COLLECTION",
  INVENTORY: "INVENTORY",
  METAFIELD: "METAFIELD",
  PRODUCT: "PRODUCT",
  PRODUCT_TYPE: "PRODUCT_TYPE",
};

const assertShop = (shop) => {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required");
  }
};

const buildSyncBatchId = ({ shop, prefix = "product_sync", timestamp, sequence = 0 }) => {
  const safeShop = String(shop).replace(/[^a-zA-Z0-9_-]/g, "_");
  const issuedAt = timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString();
  const digest = sha256Hex({
    shop,
    prefix,
    issuedAt,
    sequence,
  }).slice(0, 24);

  return `${prefix}_${safeShop}_${issuedAt.replace(/[^0-9TZ]/g, "")}_${digest}`;
};

const acquireSyncStartLease = async ({ shop, syncRunId, activity }) => {
  const lease = await acquireExclusiveShopWork({
    shop,
    activity,
    worker: "catalogSyncService",
    entityType: "SyncRun",
    entityId: syncRunId || null,
    executionId: syncRunId || null,
    ttlMs: 120_000,
  });

  if (!lease.acquired) {
    const error = new Error("Another shop sync operation is already starting");
    error.code = "SHOP_SYNC_START_LOCKED";
    error.httpStatus = 409;
    error.details = {
      shop,
      syncRunId,
      activity,
    };
    throw error;
  }

  return lease;
};

const getStoreSyncState = async (shop) => {
  return prisma.store.findUnique({
    where: { shopUrl: shop },
    select: {
      id: true,
      shopUrl: true,
      isProductSyncing: true,
      isProductInitialySyning: true,
      shopifyBulkJobCompleted: true,
      storeTotalProducts: true,
      lastProductSyncAt: true,
      syncProgressStage: true,
      activeMirrorBatchId: true,
      isCollectionSyncing: true,
      lastCollectionSyncAt: true,
      lastSyncErrorSummary: true,
    },
  });
};

const getCurrentMirrorProductCount = async (shop) => {
  return prisma.product.count({
    where: { shop },
  });
};

const getLatestCompletedProductSync = async (shop) => {
  return syncRunService.getLatestSyncRun({
    shop,
    runType: SYNC_RUN_TYPE.FULL_BASELINE,
    domain: CATALOG_DOMAIN.PRODUCT,
    status: "COMPLETED",
  });
};

const getLatestAnyProductSync = async (shop) => {
  return syncRunService.getLatestSyncRun({
    shop,
    runType: SYNC_RUN_TYPE.FULL_BASELINE,
    domain: CATALOG_DOMAIN.PRODUCT,
  });
};

/**
 * Transitional conflict gate.
 *
 * Current strategy:
 * 1. Check our own new SyncRun truth first.
 * 2. Check Shopify current bulk query status.
 * 3. Check existing Store flags.
 */
const assertNoConflictingProductSync = async ({ shop, session }) => {
  // Check local truth first — no Shopify API call yet.
  const activeSyncRun = await syncRunService.getLatestActiveSyncRun({
    shop,
    runType: SYNC_RUN_TYPE.FULL_BASELINE,
    domain: CATALOG_DOMAIN.PRODUCT,
  });

  if (activeSyncRun) {
    const error = new Error("A product sync run is already active");
    error.code = "SYNC_RUN_ALREADY_ACTIVE";
    error.httpStatus = 409;
    error.details = {
      syncRunId: activeSyncRun.id,
      status: activeSyncRun.status,
      stage: activeSyncRun.stage,
      bulkOperationId: activeSyncRun.bulkOperationId,
      catalogBatchId: activeSyncRun.catalogBatchId,
    };
    throw error;
  }

  // Local checks passed — call Shopify only as a last-resort guard for orphaned
  // operations that have no corresponding SyncRun in our DB.
  const currentBulkOperation = await getCurrentBulkOperationStatus(session, "QUERY");

  if (
    currentBulkOperation?.status &&
    ACTIVE_QUERY_RUNNING_STATUSES.has(currentBulkOperation.status)
  ) {
    const error = new Error("Another bulk query operation is already running");
    error.code = "BULK_QUERY_ALREADY_RUNNING";
    error.httpStatus = 400;
    error.details = {
      bulkOperationId: currentBulkOperation.id || null,
      bulkStatus: currentBulkOperation.status,
    };
    throw error;
  }

  return {
    activeSyncRun,
    currentBulkOperation,
  };
};

const evaluateSkipForProductSync = async ({ shop, force }) => {
  const [productCount, latestCompletedSync, snapshotStatus] = await Promise.all([
    getCurrentMirrorProductCount(shop),
    getLatestCompletedProductSync(shop),
    catalogSnapshotService.getCatalogSnapshotStatus({ shop }),
  ]);

  const alreadySynced =
    latestCompletedSync?.status === "COMPLETED" &&
    snapshotStatus?.activeSnapshot?.status === "ACTIVE" &&
    snapshotStatus.activeSnapshot.catalogBatchId === latestCompletedSync.catalogBatchId &&
    productCount > 0;

  if (!force && alreadySynced) {
    return {
      shouldSkip: true,
      response: {
        message: "Products already synced. Skipping new sync.",
        skipped: true,
        forceAllowed: true,
        data: {
          productCount,
          storeTotalProducts: null,
          lastProductSyncAt: latestCompletedSync?.completedAt || null,
          lastCompletedSyncAt: latestCompletedSync?.completedAt || null,
          lastCompletedRecordCount: latestCompletedSync?.rowCount || null,
          lastCompletedSyncBatchId: latestCompletedSync?.catalogBatchId || null,
        },
      },
    };
  }

  return {
    shouldSkip: false,
    productCount,
    latestCompletedSync,
  };
};

const markStoreProductSyncStarted = async ({
  shop,
  startedAt,
  isInitialSync = false,
}) => {
  await prisma.store.update({
    where: { shopUrl: shop },
    data: {
      isProductSyncing: true,
      isProductInitialySyning: isInitialSync,
      shopifyBulkJobCompleted: false,
      syncProgressStage: "SHOPIFY_BULK_RUNNING",
      lastProductSyncAt: startedAt,
      lastSyncErrorSummary: null,
    },
  });
};

const createCompatibilityProductSyncHistory = async ({
  shop,
  bulkOperationId,
  syncBatchId,
  isInitialSync = false,
}) => {
  return prisma.syncHistory.create({
    data: {
      shop,
      bulkOperationId,
      syncBatchId,
      status: "processing",
      stage: "SHOPIFY_BULK_RUNNING",
      duration: 0,
      recordCount: 0,
      operationType: DEFAULT_OPERATION_TYPE,
      isInitialProductSync: isInitialSync,
      executionState: "running",
      lastHeartbeatAt: new Date(),
    },
    select: {
      id: true,
      bulkOperationId: true,
      syncBatchId: true,
      status: true,
      stage: true,
    },
  });
};

const markStoreProductTypeSyncStarted = async ({ shop, startedAt }) => {
  await prisma.store.update({
    where: { shopUrl: shop },
    data: {
      isProductTypeSyncing: true,
      lastProductTypeSyncAt: startedAt,
    },
  });
};

const createCompatibilityProductTypeSyncHistory = async ({
  shop,
  bulkOperationId,
}) => {
  return prisma.syncHistory.create({
    data: {
      shop,
      bulkOperationId,
      status: "processing",
      duration: 0,
      recordCount: 0,
      operationType: DEFAULT_PRODUCT_TYPE_OPERATION_TYPE,
      executionState: "running",
      lastHeartbeatAt: new Date(),
    },
    select: {
      id: true,
      bulkOperationId: true,
      status: true,
    },
  });
};

const markStoreCollectionSyncStarted = async ({ shop, startedAt }) => {
  await prisma.store.update({
    where: { shopUrl: shop },
    data: {
      isCollectionSyncing: true,
      lastCollectionSyncAt: startedAt,
    },
  });
};

const resolveActiveCatalogBatchForDomainRepair = async ({ shop }) => {
  await domainFreshnessService.assertDomainsFresh({
    shop,
    domains: [domainFreshnessService.FRESHNESS_DOMAIN.PRODUCT],
    source: "catalogSyncService.resolveActiveCatalogBatchForDomainRepair",
  });

  const activeBatch = await requireActiveCatalogBatchId({ shop });
  const catalogBatchId = activeBatch.catalogBatchId;

  const [productCount, variantCount, collectionMembershipCount, inventoryLevelCount] =
    await Promise.all([
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
      prisma.productCollectionMembership.count({
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

  if (
    productCount <= 0 ||
    variantCount <= 0
  ) {
    const error = new Error(
      "Cannot repair catalog domain without an active product/variant catalog baseline",
    );
    error.code = "ACTIVE_CATALOG_BATCH_INCOMPLETE";
    error.httpStatus = 409;
    error.details = {
      shop,
      catalogBatchId,
      activeBatchReason: activeBatch.reason || null,
      productCount,
      variantCount,
      collectionMembershipCount,
      inventoryLevelCount,
    };
    throw error;
  }

  return {
    ...activeBatch,
    catalogBatchId,
    productCount,
    variantCount,
    collectionMembershipCount,
    inventoryLevelCount,
  };
};

const createCompatibilityCollectionSyncHistory = async ({
  shop,
  bulkOperationId,
  syncBatchId,
}) => {
  return prisma.syncHistory.create({
    data: {
      shop,
      bulkOperationId,
      syncBatchId,
      status: "processing",
      stage: "SHOPIFY_BULK_RUNNING",
      duration: 0,
      recordCount: 0,
      operationType: DEFAULT_COLLECTION_OPERATION_TYPE,
      executionState: "running",
      lastHeartbeatAt: new Date(),
    },
    select: {
      id: true,
      bulkOperationId: true,
      syncBatchId: true,
      status: true,
      stage: true,
    },
  });
};

const decorateSyncStartConflict = (error) => {
  if (error?.code !== "P2002") {
    return error;
  }

  const conflict = new Error("A bulk query sync is already active for this shop");
  conflict.code = "SYNC_RUN_ALREADY_ACTIVE";
  conflict.httpStatus = 409;
  conflict.details = {
    target: error?.meta?.target || null,
  };
  return conflict;
};

const assertNoConflictingCollectionSync = async ({ shop, session }) => {
  // Check local truth first — no Shopify API call yet.
  const activeSyncRun = await syncRunService.getLatestActiveSyncRun({
    shop,
    runType: SYNC_RUN_TYPE.DOMAIN_REPAIR,
    domain: CATALOG_DOMAIN.COLLECTION,
  });

  if (activeSyncRun) {
    const error = new Error("A collection sync run is already active");
    error.code = "SYNC_RUN_ALREADY_ACTIVE";
    error.httpStatus = 409;
    error.details = {
      syncRunId: activeSyncRun.id,
      status: activeSyncRun.status,
      stage: activeSyncRun.stage,
      bulkOperationId: activeSyncRun.bulkOperationId,
      catalogBatchId: activeSyncRun.catalogBatchId,
    };
    throw error;
  }

  // Local checks passed — call Shopify only as a last-resort guard for orphaned
  // operations that have no corresponding SyncRun in our DB.
  const currentBulkOperation = await getCurrentBulkOperationStatus(session, "QUERY");

  if (
    currentBulkOperation?.status &&
    ACTIVE_QUERY_RUNNING_STATUSES.has(currentBulkOperation.status)
  ) {
    const error = new Error("Another bulk query operation is already running");
    error.code = "BULK_QUERY_ALREADY_RUNNING";
    error.httpStatus = 400;
    error.details = {
      bulkOperationId: currentBulkOperation.id || null,
      bulkStatus: currentBulkOperation.status,
    };
    throw error;
  }

  return {
    activeSyncRun,
    currentBulkOperation,
  };
};

const createNewSyncRunForProductSync = async ({
  shop,
  catalogBatchId,
  isInitialSync,
}) => {
  return syncRunService.createPendingSyncRun({
    shop,
    runType: SYNC_RUN_TYPE.FULL_BASELINE,
    domain: CATALOG_DOMAIN.PRODUCT,
    catalogBatchId,
    triggerSource: isInitialSync ? "INITIAL_SYNC" : "MANUAL",
    isInitialSync,
  });
};

const startNewSyncTruthForProductSync = async ({
  shop,
  syncRunId,
  catalogBatchId,
  bulkOperationId,
  isInitialSync = false,
}) => {
  await Promise.all([
    syncRunService.markSyncRunRunning({
      syncRunId,
      stage: "SHOPIFY_BULK_RUNNING",
      bulkOperationId,
      catalogBatchId,
      triggerSource: isInitialSync ? "INITIAL_SYNC" : "MANUAL",
    }),
    catalogSnapshotService.getOrCreateBuildingSnapshot({
      shop,
      catalogBatchId,
      syncRunId,
      reason: "baseline sync started",
    }),
    domainFreshnessService.markDomainRunning({
      shop,
      domain: domainFreshnessService.FRESHNESS_DOMAIN.PRODUCT,
      source: "CATALOG_SYNC_START",
      sourceRunId: syncRunId,
      catalogBatchId,
    }),
  ]);
};

export const startProductCatalogSync = async ({
  shop,
  session,
  force = false,
  isInitialSync = false,
}) => {
  assertShop(shop);

  const startedAt = new Date();

  let syncRun = null;
  let syncStartLease = null;

  try {
    syncStartLease = await acquireSyncStartLease({
      shop,
      syncRunId: null,
      activity: "catalog_sync_start",
    });

    await assertNoConflictingProductSync({ shop, session });

    const skipDecision = await evaluateSkipForProductSync({ shop, force });

    if (skipDecision.shouldSkip) {
      return skipDecision.response;
    }

    const catalogBatchId = buildSyncBatchId({
      shop,
      prefix: isInitialSync ? "initial_catalog_snapshot" : "catalog_snapshot",
      timestamp: startedAt,
      sequence: 0,
    });
    const syncBatchId = `${catalogBatchId}_sync`;

    try {
      syncRun = await createNewSyncRunForProductSync({
        shop,
        catalogBatchId,
        isInitialSync,
      });
    } catch (error) {
      throw decorateSyncStartConflict(error);
    }

    const bulkResult = await runBulkQuery({
      session,
      query: BULK_QUERY.PRODUCT_VARIANT_BASELINE.query,
    });

    const [syncHistory] = await Promise.all([
      createCompatibilityProductSyncHistory({
        shop,
        bulkOperationId: bulkResult.bulkOperationId,
        syncBatchId,
        isInitialSync,
      }),
      markStoreProductSyncStarted({
        shop,
        startedAt,
        isInitialSync,
      }),
      startNewSyncTruthForProductSync({
        shop,
        syncRunId: syncRun.id,
        catalogBatchId,
        bulkOperationId: bulkResult.bulkOperationId,
        isInitialSync,
      }),
    ]);

    logBatchEvent("catalog_batch_ingest_write", {
      shop,
      syncRunId: syncRun.id,
      bulkOperationId: bulkResult.bulkOperationId,
      newCatalogBatchId: catalogBatchId,
      resolvedCatalogBatchId: catalogBatchId,
      path: "ingest",
      extra: {
        syncHistoryId: syncHistory.id,
        syncBatchId,
        domain: CATALOG_DOMAIN.PRODUCT,
        operationType: DEFAULT_OPERATION_TYPE,
      },
    });

    return {
      success: true,
      message: "Product sync started",
      skipped: false,
      forced: force,
      bulkOperationId: bulkResult.bulkOperationId,
      syncHistoryId: syncHistory.id,
      syncRunId: syncRun.id,
      syncBatchId,
      catalogBatchId,
      pipelineVersion: BULK_QUERY.PRODUCT_VARIANT_BASELINE.pipelineVersion,
      schemaVersion: BULK_QUERY.PRODUCT_VARIANT_BASELINE.schemaVersion,
    };
  } catch (error) {
    try {
      if (syncRun?.id) {
        await syncRunService.markSyncRunFailed({
          syncRunId: syncRun.id,
          stage: "FAILED",
          failureCode: error.code || "SYNC_START_FAILED",
          failureMessage: error.message || "Failed to start product sync",
        });
      }
    } catch {
      // Intentionally swallow secondary failure to avoid masking root cause.
    }

    throw decorateSyncStartConflict(error);
  } finally {
    await releaseExclusiveShopWork(syncStartLease);
  }
};

/**
 * Transitional product-type sync starter.
 *
 * Keeps your current dedicated product-type sync flow alive,
 * but moves the bulk API call and orchestration decisions out of the controller.
 *
 * This path does not create CatalogSnapshot because it is not a full catalog authority publish.
 */
export const startProductTypeSync = async ({ shop, session }) => {
  assertShop(shop);

  const activeSyncRun = await syncRunService.getLatestActiveSyncRun({
    shop,
    runType: SYNC_RUN_TYPE.DOMAIN_REPAIR,
    domain: CATALOG_DOMAIN.PRODUCT_TYPE,
  });

  if (activeSyncRun) {
    const error = new Error("A product type sync run is already active");
    error.code = "SYNC_RUN_ALREADY_ACTIVE";
    error.httpStatus = 409;
    error.details = {
      syncRunId: activeSyncRun.id,
      status: activeSyncRun.status,
      stage: activeSyncRun.stage,
      bulkOperationId: activeSyncRun.bulkOperationId,
    };
    throw error;
  }

  const currentBulkOperation = await getCurrentBulkOperationStatus(session, "QUERY");
  if (
    currentBulkOperation?.status &&
    ACTIVE_QUERY_RUNNING_STATUSES.has(currentBulkOperation.status)
  ) {
    const error = new Error("Another bulk query operation is already running");
    error.code = "BULK_QUERY_ALREADY_RUNNING";
    error.httpStatus = 400;
    error.details = {
      bulkOperationId: currentBulkOperation.id || null,
      bulkStatus: currentBulkOperation.status,
    };
    throw error;
  }

  const startedAt = new Date();

  let syncRun = null;
  let syncStartLease = null;

  try {
    try {
      syncRun = await syncRunService.createPendingSyncRun({
        shop,
        runType: SYNC_RUN_TYPE.DOMAIN_REPAIR,
        domain: CATALOG_DOMAIN.PRODUCT_TYPE,
        triggerSource: "PRODUCT_TYPE_SYNC",
        isInitialSync: false,
      });
    } catch (error) {
      throw decorateSyncStartConflict(error);
    }

    syncStartLease = await acquireSyncStartLease({
      shop,
      syncRunId: syncRun.id,
      activity: "product_type_sync_start",
    });

    const bulkResult = await runBulkQuery({
      session,
      query: BULK_QUERY.PRODUCT_TYPE_ONLY.query,
    });

    const [syncHistory] = await Promise.all([
      createCompatibilityProductTypeSyncHistory({
        shop,
        bulkOperationId: bulkResult.bulkOperationId,
      }),
      markStoreProductTypeSyncStarted({
        shop,
        startedAt,
      }),
      syncRunService.markSyncRunRunning({
        syncRunId: syncRun.id,
        stage: "SHOPIFY_BULK_RUNNING",
        bulkOperationId: bulkResult.bulkOperationId,
        triggerSource: "PRODUCT_TYPE_SYNC",
      }),
      domainFreshnessService.markDomainRunning({
        shop,
        domain: domainFreshnessService.FRESHNESS_DOMAIN.PRODUCT_TYPE,
        source: "PRODUCT_TYPE_SYNC_START",
        sourceRunId: syncRun.id,
      }),
    ]);

    logBatchEvent("catalog_batch_ingest_write", {
      shop,
      syncRunId: syncRun.id,
      bulkOperationId: bulkResult.bulkOperationId,
      newCatalogBatchId: null,
      path: "ingest",
      extra: {
        syncHistoryId: syncHistory.id,
        domain: CATALOG_DOMAIN.PRODUCT_TYPE,
        operationType: DEFAULT_PRODUCT_TYPE_OPERATION_TYPE,
      },
    });

    return {
      success: true,
      message: "productType syncing started",
      operationId: bulkResult.bulkOperationId,
      syncHistoryId: syncHistory.id,
      syncRunId: syncRun.id,
      pipelineVersion: BULK_QUERY.PRODUCT_TYPE_ONLY.pipelineVersion,
      schemaVersion: BULK_QUERY.PRODUCT_TYPE_ONLY.schemaVersion,
    };
  } catch (error) {
    try {
      if (syncRun?.id) {
        await syncRunService.markSyncRunFailed({
          syncRunId: syncRun.id,
          stage: "FAILED",
          failureCode: error.code || "PRODUCT_TYPE_SYNC_START_FAILED",
          failureMessage: error.message || "Failed to start product type sync",
        });
      }
    } catch {
      // Intentionally swallow secondary failure.
    }

    throw decorateSyncStartConflict(error);
  } finally {
    await releaseExclusiveShopWork(syncStartLease);
  }
};

export const startCollectionMembershipSync = async ({ shop, session }) => {
  assertShop(shop);

  await assertNoConflictingCollectionSync({
    shop,
    session,
  });

  const startedAt = new Date();
  const activeCatalogBatch = await resolveActiveCatalogBatchForDomainRepair({
    shop,
  });
  const catalogBatchId = activeCatalogBatch.catalogBatchId;
  const syncBatchId = catalogBatchId;

  let syncRun = null;
  let syncStartLease = null;

  try {
    try {
      syncRun = await syncRunService.createPendingSyncRun({
        shop,
        runType: SYNC_RUN_TYPE.DOMAIN_REPAIR,
        domain: CATALOG_DOMAIN.COLLECTION,
        catalogBatchId,
        triggerSource: "COLLECTION_SYNC",
        isInitialSync: false,
      });
    } catch (error) {
      throw decorateSyncStartConflict(error);
    }

    syncStartLease = await acquireSyncStartLease({
      shop,
      syncRunId: syncRun.id,
      activity: "collection_sync_start",
    });

    const bulkResult = await runBulkQuery({
      session,
      query: BULK_QUERY.COLLECTION_MEMBERSHIP.query,
    });

    const [syncHistory] = await Promise.all([
      createCompatibilityCollectionSyncHistory({
        shop,
        bulkOperationId: bulkResult.bulkOperationId,
        syncBatchId,
      }),
      markStoreCollectionSyncStarted({
        shop,
        startedAt,
      }),
      syncRunService.markSyncRunRunning({
        syncRunId: syncRun.id,
        stage: "SHOPIFY_BULK_RUNNING",
        bulkOperationId: bulkResult.bulkOperationId,
        catalogBatchId,
        triggerSource: "COLLECTION_SYNC",
      }),
      domainFreshnessService.markDomainRunning({
        shop,
        domain: domainFreshnessService.FRESHNESS_DOMAIN.COLLECTION,
        source: "COLLECTION_SYNC_START",
        sourceRunId: syncRun.id,
        catalogBatchId,
      }),
    ]);

    logBatchEvent("catalog_batch_ingest_write", {
      shop,
      syncRunId: syncRun.id,
      bulkOperationId: bulkResult.bulkOperationId,
      newCatalogBatchId: catalogBatchId,
      resolvedCatalogBatchId: catalogBatchId,
      path: "ingest",
      extra: {
        syncHistoryId: syncHistory.id,
        syncBatchId,
        domain: CATALOG_DOMAIN.COLLECTION,
        operationType: DEFAULT_COLLECTION_OPERATION_TYPE,
      },
    });

    return {
      success: true,
      message: "Collections syncing started",
      operationId: bulkResult.bulkOperationId,
      syncHistoryId: syncHistory.id,
      syncRunId: syncRun.id,
      syncBatchId,
      catalogBatchId,
      pipelineVersion: BULK_QUERY.COLLECTION_MEMBERSHIP.pipelineVersion,
      schemaVersion: BULK_QUERY.COLLECTION_MEMBERSHIP.schemaVersion,
    };
  } catch (error) {
    try {
      if (syncRun?.id) {
        await syncRunService.markSyncRunFailed({
          syncRunId: syncRun.id,
          stage: "FAILED",
          failureCode: error.code || "COLLECTION_SYNC_START_FAILED",
          failureMessage: error.message || "Failed to start collection sync",
        });
      }
    } catch {
      // Intentionally swallow secondary failure.
    }

    throw decorateSyncStartConflict(error);
  } finally {
    await releaseExclusiveShopWork(syncStartLease);
  }
};

/**
 * Transitional helper for controller or future worker handoff.
 *
 * Keeps old and new truth together during migration.
 */
/**
 * Shared conflict guard for domain-repair syncs that have no store-level flag.
 * Throws if a SyncRun of the same type+domain is already active, or if Shopify
 * already has a QUERY-type bulk operation running.
 */
const assertNoConflictingDomainSync = async ({ shop, session, domain }) => {
  const activeSyncRun = await syncRunService.getLatestActiveSyncRun({
    shop,
    runType: SYNC_RUN_TYPE.DOMAIN_REPAIR,
    domain,
  });

  if (activeSyncRun) {
    const error = new Error(`A ${domain.toLowerCase()} sync run is already active`);
    error.code = "SYNC_RUN_ALREADY_ACTIVE";
    error.httpStatus = 409;
    error.details = {
      syncRunId: activeSyncRun.id,
      status: activeSyncRun.status,
      stage: activeSyncRun.stage,
      bulkOperationId: activeSyncRun.bulkOperationId,
      catalogBatchId: activeSyncRun.catalogBatchId,
    };
    throw error;
  }

  const currentBulkOperation = await getCurrentBulkOperationStatus(session, "QUERY");

  if (
    currentBulkOperation?.status &&
    ACTIVE_QUERY_RUNNING_STATUSES.has(currentBulkOperation.status)
  ) {
    const error = new Error("Another bulk query operation is already running");
    error.code = "BULK_QUERY_ALREADY_RUNNING";
    error.httpStatus = 400;
    error.details = {
      bulkOperationId: currentBulkOperation.id || null,
      bulkStatus: currentBulkOperation.status,
    };
    throw error;
  }

  return { activeSyncRun, currentBulkOperation };
};

/**
 * Start a tracked-metafield bulk sync for products.
 *
 * Requires an active catalog batch (products must already be mirrored).
 * The JSONL is consumed by trackedMetafieldIngestWorker with ownerType "PRODUCT".
 */
export const startTrackedProductMetafieldSync = async ({ shop, session }) => {
  assertShop(shop);

  await assertNoConflictingDomainSync({
    shop,
    session,
    domain: CATALOG_DOMAIN.METAFIELD,
  });

  const activeCatalogBatch = await resolveActiveCatalogBatchForDomainRepair({ shop });
  const catalogBatchId = activeCatalogBatch.catalogBatchId;

  let syncRun = null;

  try {
    try {
      syncRun = await syncRunService.createPendingSyncRun({
        shop,
        runType: SYNC_RUN_TYPE.DOMAIN_REPAIR,
        domain: CATALOG_DOMAIN.METAFIELD,
        catalogBatchId,
        triggerSource: "PRODUCT_METAFIELD_SYNC",
        isInitialSync: false,
      });
    } catch (error) {
      throw decorateSyncStartConflict(error);
    }

    const bulkResult = await runBulkQuery({
      session,
      query: BULK_QUERY.PRODUCT_TRACKED_METAFIELDS.query,
    });

    await Promise.all([
      syncRunService.markSyncRunRunning({
        syncRunId: syncRun.id,
        stage: "SHOPIFY_BULK_RUNNING",
        bulkOperationId: bulkResult.bulkOperationId,
        catalogBatchId,
        triggerSource: "PRODUCT_METAFIELD_SYNC",
      }),
      domainFreshnessService.markDomainRunning({
        shop,
        domain: domainFreshnessService.FRESHNESS_DOMAIN.METAFIELD,
        source: "PRODUCT_METAFIELD_SYNC_START",
        sourceRunId: syncRun.id,
        catalogBatchId,
      }),
      prisma.syncHistory.create({
        data: {
          shop,
          bulkOperationId: bulkResult.bulkOperationId,
          syncBatchId: catalogBatchId,
          status: "processing",
          stage: "SHOPIFY_BULK_RUNNING",
          duration: 0,
          recordCount: 0,
          operationType: DEFAULT_METAFIELD_OPERATION_TYPE,
          executionState: "running",
          lastHeartbeatAt: new Date(),
        },
      }).catch(() => {}),
    ]);

    return {
      success: true,
      message: "Product metafield sync started",
      operationId: bulkResult.bulkOperationId,
      syncRunId: syncRun.id,
      catalogBatchId,
      ownerType: "PRODUCT",
      pipelineVersion: BULK_QUERY.PRODUCT_TRACKED_METAFIELDS.pipelineVersion,
      schemaVersion: BULK_QUERY.PRODUCT_TRACKED_METAFIELDS.schemaVersion,
    };
  } catch (error) {
    if (syncRun?.id) {
      await syncRunService.markSyncRunFailed({
        syncRunId: syncRun.id,
        stage: "FAILED",
        failureCode: error.code || "PRODUCT_METAFIELD_SYNC_START_FAILED",
        failureMessage: error.message || "Failed to start product metafield sync",
      }).catch(() => {});
    }
    throw decorateSyncStartConflict(error);
  }
};

/**
 * Start a tracked-metafield bulk sync for variants.
 *
 * Anchored from productVariants root so variant–product parentage is preserved
 * in the JSONL. Consumed by trackedMetafieldIngestWorker with ownerType "VARIANT".
 */
export const startTrackedVariantMetafieldSync = async ({ shop, session }) => {
  assertShop(shop);

  await assertNoConflictingDomainSync({
    shop,
    session,
    domain: CATALOG_DOMAIN.METAFIELD,
  });

  const activeCatalogBatch = await resolveActiveCatalogBatchForDomainRepair({ shop });
  const catalogBatchId = activeCatalogBatch.catalogBatchId;

  let syncRun = null;

  try {
    try {
      syncRun = await syncRunService.createPendingSyncRun({
        shop,
        runType: SYNC_RUN_TYPE.DOMAIN_REPAIR,
        domain: CATALOG_DOMAIN.METAFIELD,
        catalogBatchId,
        triggerSource: "VARIANT_METAFIELD_SYNC",
        isInitialSync: false,
      });
    } catch (error) {
      throw decorateSyncStartConflict(error);
    }

    const bulkResult = await runBulkQuery({
      session,
      query: BULK_QUERY.VARIANT_TRACKED_METAFIELDS.query,
    });

    await Promise.all([
      syncRunService.markSyncRunRunning({
        syncRunId: syncRun.id,
        stage: "SHOPIFY_BULK_RUNNING",
        bulkOperationId: bulkResult.bulkOperationId,
        catalogBatchId,
        triggerSource: "VARIANT_METAFIELD_SYNC",
      }),
      domainFreshnessService.markDomainRunning({
        shop,
        domain: domainFreshnessService.FRESHNESS_DOMAIN.METAFIELD,
        source: "VARIANT_METAFIELD_SYNC_START",
        sourceRunId: syncRun.id,
        catalogBatchId,
      }),
      prisma.syncHistory.create({
        data: {
          shop,
          bulkOperationId: bulkResult.bulkOperationId,
          syncBatchId: catalogBatchId,
          status: "processing",
          stage: "SHOPIFY_BULK_RUNNING",
          duration: 0,
          recordCount: 0,
          operationType: DEFAULT_METAFIELD_OPERATION_TYPE,
          executionState: "running",
          lastHeartbeatAt: new Date(),
        },
      }).catch(() => {}),
    ]);

    return {
      success: true,
      message: "Variant metafield sync started",
      operationId: bulkResult.bulkOperationId,
      syncRunId: syncRun.id,
      catalogBatchId,
      ownerType: "VARIANT",
      pipelineVersion: BULK_QUERY.VARIANT_TRACKED_METAFIELDS.pipelineVersion,
      schemaVersion: BULK_QUERY.VARIANT_TRACKED_METAFIELDS.schemaVersion,
    };
  } catch (error) {
    if (syncRun?.id) {
      await syncRunService.markSyncRunFailed({
        syncRunId: syncRun.id,
        stage: "FAILED",
        failureCode: error.code || "VARIANT_METAFIELD_SYNC_START_FAILED",
        failureMessage: error.message || "Failed to start variant metafield sync",
      }).catch(() => {});
    }
    throw decorateSyncStartConflict(error);
  }
};

/**
 * Start an inventory-level bulk sync.
 *
 * Anchored from locations root so all active locations are covered.
 * Consumed by inventoryLevelIngestWorker.
 */
export const startInventoryLevelSync = async ({ shop, session }) => {
  assertShop(shop);

  await assertNoConflictingDomainSync({
    shop,
    session,
    domain: CATALOG_DOMAIN.INVENTORY,
  });

  const activeCatalogBatch = await resolveActiveCatalogBatchForDomainRepair({ shop });
  const catalogBatchId = activeCatalogBatch.catalogBatchId;

  let syncRun = null;

  try {
    try {
      syncRun = await syncRunService.createPendingSyncRun({
        shop,
        runType: SYNC_RUN_TYPE.DOMAIN_REPAIR,
        domain: CATALOG_DOMAIN.INVENTORY,
        catalogBatchId,
        triggerSource: "INVENTORY_LEVEL_SYNC",
        isInitialSync: false,
      });
    } catch (error) {
      throw decorateSyncStartConflict(error);
    }

    const bulkResult = await runBulkQuery({
      session,
      query: BULK_QUERY.INVENTORY_LEVEL.query,
    });

    await Promise.all([
      syncRunService.markSyncRunRunning({
        syncRunId: syncRun.id,
        stage: "SHOPIFY_BULK_RUNNING",
        bulkOperationId: bulkResult.bulkOperationId,
        catalogBatchId,
        triggerSource: "INVENTORY_LEVEL_SYNC",
      }),
      domainFreshnessService.markDomainRunning({
        shop,
        domain: domainFreshnessService.FRESHNESS_DOMAIN.INVENTORY,
        source: "INVENTORY_LEVEL_SYNC_START",
        sourceRunId: syncRun.id,
        catalogBatchId,
      }),
      prisma.syncHistory.create({
        data: {
          shop,
          bulkOperationId: bulkResult.bulkOperationId,
          syncBatchId: catalogBatchId,
          status: "processing",
          stage: "SHOPIFY_BULK_RUNNING",
          duration: 0,
          recordCount: 0,
          operationType: DEFAULT_INVENTORY_OPERATION_TYPE,
          executionState: "running",
          lastHeartbeatAt: new Date(),
        },
      }).catch(() => {}),
    ]);

    return {
      success: true,
      message: "Inventory level sync started",
      operationId: bulkResult.bulkOperationId,
      syncRunId: syncRun.id,
      catalogBatchId,
      pipelineVersion: BULK_QUERY.INVENTORY_LEVEL.pipelineVersion,
      schemaVersion: BULK_QUERY.INVENTORY_LEVEL.schemaVersion,
    };
  } catch (error) {
    if (syncRun?.id) {
      await syncRunService.markSyncRunFailed({
        syncRunId: syncRun.id,
        stage: "FAILED",
        failureCode: error.code || "INVENTORY_LEVEL_SYNC_START_FAILED",
        failureMessage: error.message || "Failed to start inventory level sync",
      }).catch(() => {});
    }
    throw decorateSyncStartConflict(error);
  }
};

export const getLatestProductSyncContext = async ({ shop }) => {
  assertShop(shop);

  const [store, latestSync, latestCompletedSync, productCount, latestSyncRun] =
    await Promise.all([
      getStoreSyncState(shop),
      getLatestAnyProductSync(shop),
      getLatestCompletedProductSync(shop),
      getCurrentMirrorProductCount(shop),
      syncRunService.getLatestSyncRun({
        shop,
        runType: SYNC_RUN_TYPE.FULL_BASELINE,
        domain: CATALOG_DOMAIN.PRODUCT,
      }),
    ]);

  return {
    store,
    latestSync,
    latestCompletedSync,
    latestSyncRun,
    productCount,
  };
};
