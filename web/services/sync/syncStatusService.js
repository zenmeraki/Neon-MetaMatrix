import { prisma } from "../../Config/database.js";
import { getCache, setCache } from "../../utils/cacheUtils.js";
import { getBulkOperationStatusById } from "../../utils/bulkOperationHelper.js";
import { getActiveCatalogBatchId } from "./catalogSnapshotService.js";
import * as syncRunService from "./syncRunService.js";

const SYNC_CACHE_TTL_SECONDS = 5;
const PRODUCT_SYNC_CACHE_KEY = (shop) => `${shop}:sync_details`;
const FULL_BASELINE_RUN_TYPE = "FULL_BASELINE";
const DOMAIN_REPAIR_RUN_TYPE = "DOMAIN_REPAIR";
const PRODUCT_DOMAIN = "PRODUCT";
const COLLECTION_DOMAIN = "COLLECTION";
const PRODUCT_TYPE_DOMAIN = "PRODUCT_TYPE";
const RUNNING_FRESHNESS_STATUS = "RUNNING";
const SHOPIFY_BULK_STAGE = "SHOPIFY_BULK_RUNNING";

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clampPercentage = (value) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return 0;
  if (parsed < 0) return 0;
  if (parsed > 100) return 100;

  return Number(parsed.toFixed(2));
};

const calculateProgress = ({ processed, total }) => {
  const processedValue = toSafeNumber(processed, 0);
  const totalValue = toSafeNumber(total, 0);

  if (totalValue <= 0) {
    return 0;
  }

  return clampPercentage((processedValue / totalValue) * 100);
};

const assertShop = (shop) => {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required");
  }
};

const getStoreSyncProjection = async (shop) => {
  return prisma.store.findUnique({
    where: { shopUrl: shop },
    select: {
      mirrorHealthState: true,
      staleReason: true,
      repairRequired: true,
      mirrorUnsafeSince: true,
      lastFullSyncAt: true,
      lastIncrementalSyncAt: true,
      lastWebhookProcessedAt: true,
      lastReconcileAt: true,
      lastInventoryReconcileAt: true,
      lastCollectionReconcileAt: true,
      lastSyncErrorSummary: true,

      syncProgressStage: true,

      isCollectionSyncing: true,
      lastCollectionSyncAt: true,

      isProductTypeSyncing: true,
      lastProductTypeSyncAt: true,

      isProductInitialySyning: true,
      productInitialSyncProgress: true,

      shopifyBulkJobCompleted: true,
      storeTotalProducts: true,
      isProductSyncing: true,
      lastProductSyncAt: true,
      activeMirrorBatchId: true,
    },
  });
};

const getLatestProductSyncHistory = async (shop) => {
  return prisma.syncHistory.findFirst({
    where: {
      shop,
      operationType: "Product",
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      bulkOperationId: true,
      syncBatchId: true,
      status: true,
      stage: true,
      recordCount: true,
      updatedAt: true,
      createdAt: true,
      errorMessage: true,
      isInitialProductSync: true,
      executionState: true,
      lastHeartbeatAt: true,
      completedAt: true,
    },
  });
};

const getDomainFreshnessByDomain = async (shop) => {
  const rows = await prisma.domainFreshness.findMany({
    where: {
      shop,
      domain: {
        in: [PRODUCT_DOMAIN, COLLECTION_DOMAIN, PRODUCT_TYPE_DOMAIN],
      },
    },
  });

  return Object.fromEntries(rows.map((row) => [row.domain, row]));
};

const isRunningFreshness = (freshness) =>
  freshness?.status === RUNNING_FRESHNESS_STATUS;

const getAuthoritativeSyncContext = async (shop) => {
  const [
    latestSync,
    activeProductSyncRun,
    activeCollectionSyncRun,
    activeProductTypeSyncRun,
    activeCatalogBatch,
    freshnessByDomain,
  ] = await Promise.all([
    getLatestProductSyncHistory(shop),
    syncRunService.getLatestActiveSyncRun({
      shop,
      runType: FULL_BASELINE_RUN_TYPE,
      domain: PRODUCT_DOMAIN,
    }),
    syncRunService.getLatestActiveSyncRun({
      shop,
      runType: DOMAIN_REPAIR_RUN_TYPE,
      domain: COLLECTION_DOMAIN,
    }),
    syncRunService.getLatestActiveSyncRun({
      shop,
      runType: DOMAIN_REPAIR_RUN_TYPE,
      domain: PRODUCT_TYPE_DOMAIN,
    }),
    getActiveCatalogBatchId({ shop }),
    getDomainFreshnessByDomain(shop),
  ]);

  return {
    latestSync,
    activeProductSyncRun,
    activeCollectionSyncRun,
    activeProductTypeSyncRun,
    activeCatalogBatch,
    freshnessByDomain,
  };
};

const buildBaseSyncDetails = ({
  store,
  latestSync,
  activeProductSyncRun = null,
  activeCollectionSyncRun = null,
  activeProductTypeSyncRun = null,
  activeCatalogBatch = null,
  freshnessByDomain = {},
}) => {
  const isProductSyncing = Boolean(activeProductSyncRun);
  const productFreshness = freshnessByDomain[PRODUCT_DOMAIN] || null;
  const collectionFreshness = freshnessByDomain[COLLECTION_DOMAIN] || null;
  const productTypeFreshness = freshnessByDomain[PRODUCT_TYPE_DOMAIN] || null;
  const activeCatalogBatchId =
    activeProductSyncRun?.catalogBatchId ||
    activeCatalogBatch?.catalogBatchId ||
    productFreshness?.catalogBatchId ||
    null;
  const syncProgressStage = activeProductSyncRun?.stage || "IDLE";
  const productProgressCount =
    activeProductSyncRun?.rowCount ??
    latestSync?.recordCount ??
    store.productInitialSyncProgress;

  return {
    isCollectionSyncing:
      Boolean(activeCollectionSyncRun) || isRunningFreshness(collectionFreshness),
    lastCollectionSyncAt:
      collectionFreshness?.lastFreshAt || store.lastCollectionSyncAt,

    mirrorHealthState: productFreshness?.repairRequired
      ? "REPAIR_REQUIRED"
      : store.mirrorHealthState,
    staleReason:
      productFreshness?.staleReason ||
      collectionFreshness?.staleReason ||
      productTypeFreshness?.staleReason ||
      store.staleReason,
    repairRequired:
      Boolean(productFreshness?.repairRequired) ||
      Boolean(collectionFreshness?.repairRequired) ||
      Boolean(productTypeFreshness?.repairRequired) ||
      store.repairRequired,
    mirrorUnsafeSince:
      productFreshness?.updatedAt ||
      collectionFreshness?.updatedAt ||
      productTypeFreshness?.updatedAt ||
      store.mirrorUnsafeSince,

    lastFullSyncAt:
      productFreshness?.lastFreshAt ||
      activeCatalogBatch?.activatedAt ||
      store.lastFullSyncAt,
    lastIncrementalSyncAt: store.lastIncrementalSyncAt,
    lastWebhookProcessedAt: store.lastWebhookProcessedAt,
    lastReconcileAt: store.lastReconcileAt,
    lastInventoryReconcileAt: store.lastInventoryReconcileAt,
    lastCollectionReconcileAt:
      collectionFreshness?.lastFreshAt || store.lastCollectionReconcileAt,
    lastSyncErrorSummary: store.lastSyncErrorSummary,

    syncProgressStage,

    isProductTypeSyncing:
      Boolean(activeProductTypeSyncRun) || isRunningFreshness(productTypeFreshness),
    lastProductTypeSyncAt:
      productTypeFreshness?.lastFreshAt || store.lastProductTypeSyncAt,

    isInitialProductSyncRunning: activeProductSyncRun?.isInitialSync === true,
    isProductInitialySyning: activeProductSyncRun?.isInitialSync === true,
    productSyncProcessedCount: toSafeNumber(productProgressCount, 0),
    productInitialSyncProgress: toSafeNumber(productProgressCount, 0),

    shopifyBulkJobCompleted:
      isProductSyncing && activeProductSyncRun?.stage !== SHOPIFY_BULK_STAGE,
    storeTotalProducts: store.storeTotalProducts,
    isProductSyncing,
    lastProductSyncAt:
      productFreshness?.lastFreshAt ||
      activeCatalogBatch?.activatedAt ||
      store.lastProductSyncAt,
    activeCatalogBatchId,
    activeMirrorBatchId: activeCatalogBatchId,
    activeProductSyncRun,
    activeCollectionSyncRun,
    activeProductTypeSyncRun,
    domainFreshness: freshnessByDomain,
    syncTruthSource: {
      runLifecycle: "SyncRun",
      catalogBuild: "CatalogSnapshot",
      readActivation: "ActiveCatalogSnapshot",
      domainHealth: "DomainFreshness",
      storeRuntimeFields: "legacy_compatibility_cache",
    },

    latestSync,
  };
};

const getLiveBulkProgress = async ({ session, bulkOperationId }) => {
  if (!bulkOperationId) {
    return null;
  }

  try {
    const result = await getBulkOperationStatusById({ bulkOperationId, session });

    return {
      status: result?.status || null,
      rootObjectCount: toSafeNumber(result?.rootObjectCount ?? result?.objectCount, 0),
      objectCount: toSafeNumber(result?.objectCount, 0),
      errorCode: result?.errorCode || null,
      completedAt: result?.completedAt || null,
      url: result?.url || null,
      partialDataUrl: result?.partialDataUrl || null,
    };
  } catch (error) {
    return {
      status: null,
      rootObjectCount: 0,
      objectCount: 0,
      errorCode: "STATUS_LOOKUP_FAILED",
      completedAt: null,
      url: null,
      partialDataUrl: null,
      lookupError: error?.message || "Failed to fetch live bulk status",
    };
  }
};

const buildTrackableCompletedResponse = ({ totalProducts }) => {
  return {
    success: true,
    message: "Product syncing completed.",
    status: "completed",
    stage: "IDLE",
    totalProducts,
    processedProducts: totalProducts,
    progress: 100,
  };
};

const buildTrackableFailedResponse = ({
  totalProducts,
  processedProducts,
  latestSync,
  store,
}) => {
  return {
    success: false,
    message:
      latestSync?.errorMessage ||
      store?.lastSyncErrorSummary ||
      "Product sync failed",
    status: "failed",
    stage: latestSync?.stage || "FAILED",
    totalProducts,
    processedProducts,
    progress: calculateProgress({
      processed: processedProducts,
      total: totalProducts,
    }),
  };
};

const buildTrackableIdleResponse = ({ totalProducts }) => {
  return {
    success: true,
    message: "No product sync found",
    status: "idle",
    stage: "IDLE",
    totalProducts,
    processedProducts: 0,
    progress: 0,
  };
};

const buildTrackableShopifyRunningResponse = ({
  totalProducts,
  processedProducts,
  stage,
  latestSync,
}) => {
  return {
    success: true,
    message: "Product Sync in progress...",
    status: "syncing",
    stage: stage || latestSync?.stage || SHOPIFY_BULK_STAGE,
    totalProducts,
    processedProducts,
    progress: calculateProgress({
      processed: processedProducts,
      total: totalProducts,
    }),
  };
};

const buildTrackableMirrorRunningResponse = ({
  totalProducts,
  processedProducts,
  stage,
  latestSync,
}) => {
  return {
    success: true,
    message: "Product Sync in progress...",
    status: "syncing",
    stage: stage || latestSync?.stage || "MIRROR_STAGING",
    totalProducts,
    processedProducts,
    progress: calculateProgress({
      processed: processedProducts,
      total: totalProducts,
    }),
  };
};

/**
 * Full sync status payload used by getSyncStatus endpoint.
 *
 * Authoritative truth sources:
 * - SyncRun: durable run lifecycle
 * - CatalogSnapshot: durable catalog-build state
 * - ActiveCatalogSnapshot: read-plane activation
 * - DomainFreshness: domain health/freshness
 *
 * Store runtime fields are emitted only as legacy compatibility cache.
 */
export const getShopSyncStatus = async ({ shop }) => {
  assertShop(shop);

  const cacheKey = PRODUCT_SYNC_CACHE_KEY(shop);
  const cached = await getCache(cacheKey);

  if (cached) {
    return {
      success: true,
      shop,
      syncStatus: cached,
      cached: true,
    };
  }

  const store = await getStoreSyncProjection(shop);

  if (!store) {
    const error = new Error("Store not found");
    error.code = "STORE_NOT_FOUND";
    error.httpStatus = 404;
    throw error;
  }

  const authoritativeContext = await getAuthoritativeSyncContext(shop);

  const syncDetails = buildBaseSyncDetails({
    store,
    ...authoritativeContext,
  });

  await setCache(cacheKey, syncDetails, SYNC_CACHE_TTL_SECONDS);

  return {
    success: true,
    shop,
    syncStatus: syncDetails,
    cached: false,
  };
};

/**
 * Trackable progress payload used by trackProductSync endpoint.
 *
 * This intentionally preserves your current frontend-facing response shape.
 */
export const getTrackableProductSyncStatus = async ({ shop, session }) => {
  assertShop(shop);

  const store = await prisma.store.findUnique({
    where: { shopUrl: shop },
    select: {
      isProductInitialySyning: true,
      isProductSyncing: true,
      productInitialSyncProgress: true,
      shopifyBulkJobCompleted: true,
      storeTotalProducts: true,
      syncProgressStage: true,
      lastSyncErrorSummary: true,
    },
  });

  if (!store) {
    const error = new Error("Store not found");
    error.code = "STORE_NOT_FOUND";
    error.httpStatus = 404;
    throw error;
  }

  const { latestSync, activeProductSyncRun } =
    await getAuthoritativeSyncContext(shop);

  const totalProducts = toSafeNumber(store.storeTotalProducts, 0);

  if (latestSync?.status === "failed") {
    return buildTrackableFailedResponse({
      totalProducts,
      processedProducts: toSafeNumber(store.productInitialSyncProgress, 0),
      latestSync,
      store,
    });
  }

  if (
    !activeProductSyncRun &&
    latestSync?.status !== "processing"
  ) {
    return buildTrackableCompletedResponse({
      totalProducts,
    });
  }

  const activeStage = activeProductSyncRun?.stage || latestSync?.stage || null;
  const isShopifyBulkStage = activeStage === SHOPIFY_BULK_STAGE;

  if (isShopifyBulkStage) {
    if (!latestSync?.bulkOperationId) {
      return buildTrackableIdleResponse({
        totalProducts,
      });
    }

    const liveBulkProgress = await getLiveBulkProgress({
      session,
      bulkOperationId: latestSync.bulkOperationId,
    });

    const processedProducts = toSafeNumber(
      liveBulkProgress?.rootObjectCount,
      0,
    );

    return buildTrackableShopifyRunningResponse({
      totalProducts,
      processedProducts,
      stage: activeStage,
      latestSync,
    });
  }

  const processedProducts = toSafeNumber(
    store.productInitialSyncProgress,
    0,
  );

  return buildTrackableMirrorRunningResponse({
    totalProducts,
    processedProducts,
    stage: activeStage,
    latestSync: {
      ...latestSync,
      stage: activeStage,
    },
  });
};

/**
 * Transitional combined status context helper.
 *
 * Useful for future controller simplification and later migration to SyncRun/CatalogSnapshot.
 */
export const getLatestSyncContext = async ({ shop, session }) => {
  assertShop(shop);

  const [statusPayload, trackablePayload] = await Promise.all([
    getShopSyncStatus({ shop }),
    getTrackableProductSyncStatus({ shop, session }),
  ]);

  return {
    shop,
    syncStatus: statusPayload.syncStatus,
    trackableStatus: trackablePayload,
  };
};
