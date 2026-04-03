// web/controllers/syncController.js

import { Services } from "../services/productService/productFilterService.js";
import {
  getBulkEditStatus,
  getCurrentBulkOperationStatus,
} from "../utils/bulkOperationHelper.js";
import { setCache, getCache, clearKeyCaches } from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { prisma } from "../config/database.js";
import { withAdvisoryLock } from "../utils/idempotencyUtils.js";
import {
  getLatestSyncExecutionSummary,
  isStaleSyncExecution,
} from "../services/syncRepairService.js";
import { reconcileStoreSyncProjection } from "../services/syncExecutionStateService.js";

const service = new Services();

async function safeGetLatestSyncExecutionSummary(shop, operationType) {
  try {
    return await getLatestSyncExecutionSummary(shop, operationType);
  } catch (error) {
    console.warn(
      `Failed to load latest sync execution summary for ${shop}: ${error.message}`,
    );
    return null;
  }
}

async function safeGetLatestCompletedSync(shop, operationType) {
  try {
    return await prisma.syncHistory.findFirst({
      where: {
        shop,
        operationType,
        status: "completed",
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        updatedAt: true,
        recordCount: true,
      },
    });
  } catch (error) {
    console.warn(
      `Failed to load latest completed sync history for ${shop}: ${error.message}`,
    );
    return null;
  }
}

async function safeGetCurrentBulkOperationStatus(session, type) {
  try {
    return await getCurrentBulkOperationStatus(session, type);
  } catch (error) {
    console.warn(
      `Failed to load current bulk operation status for ${session?.shop}: ${error.message}`,
    );
    return { status: "UNKNOWN", degraded: true, error: error.message };
  }
}

async function safeGetStoreSyncStatus(shop) {
  try {
    return await prisma.store.findUnique({
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
      },
    });
  } catch (error) {
    console.warn(
      `Failed to load full store sync projection for ${shop}: ${error.message}`,
    );

    try {
      const fallbackStore = await prisma.store.findUnique({
        where: { shopUrl: shop },
        select: {
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
        },
      });

      if (!fallbackStore) {
        return null;
      }

      return {
        mirrorHealthState: null,
        staleReason: null,
        repairRequired: false,
        mirrorUnsafeSince: null,
        lastFullSyncAt: null,
        lastIncrementalSyncAt: null,
        lastWebhookProcessedAt: null,
        lastReconcileAt: null,
        lastInventoryReconcileAt: null,
        lastCollectionReconcileAt: null,
        lastSyncErrorSummary: null,
        syncProgressStage: null,
        ...fallbackStore,
      };
    } catch (fallbackError) {
      console.warn(
        `Failed to load fallback store sync projection for ${shop}: ${fallbackError.message}`,
      );
      throw fallbackError;
    }
  }
}

function buildFallbackSyncStatus(overrides = {}) {
  return {
    isCollectionSyncing: false,
    lastCollectionSyncAt: null,
    mirrorHealthState: null,
    staleReason: null,
    repairRequired: false,
    mirrorUnsafeSince: null,
    lastFullSyncAt: null,
    lastIncrementalSyncAt: null,
    lastWebhookProcessedAt: null,
    lastReconcileAt: null,
    lastInventoryReconcileAt: null,
    lastCollectionReconcileAt: null,
    lastSyncErrorSummary: null,
    syncProgressStage: null,
    isProductTypeSyncing: false,
    lastProductTypeSyncAt: null,
    isProductInitialySyning: false,
    productInitialSyncProgress: 0,
    shopifyBulkJobCompleted: false,
    storeTotalProducts: 0,
    isProductSyncing: false,
    lastProductSyncAt: null,
    latestSyncHistoryId: null,
    latestSyncStage: null,
    latestSyncExecutionState: null,
    latestSyncExecutionIdentity: null,
    latestSyncHeartbeatAt: null,
    latestSyncCompletedAt: null,
    latestSyncOperationType: null,
    stuckSyncDetected: false,
    ...overrides,
  };
}

function isProductSyncProjectedActive(status) {
  if (!status) {
    return false;
  }

  return Boolean(
    status.isProductSyncing ||
    status.isProductInitialySyning ||
    (status.syncProgressStage && status.syncProgressStage !== "IDLE"),
  );
}

function shouldRefreshProductSyncProjection(store, latestSyncExecution) {
  if (!isProductSyncProjectedActive(store)) {
    return false;
  }

  if (!latestSyncExecution) {
    return true;
  }

  if (
    latestSyncExecution.executionState === "completed" ||
    latestSyncExecution.executionState === "failed"
  ) {
    return true;
  }

  return false;
}

/**
 * Trigger Shopify Bulk Operation to fetch products.
 * (No DB change here — only cache + bulk op)
 */
export const syncProductData = async (req, res) => {
  const session = res.locals.shopify.session;

  try {
    const force =
      String(req.query.force || req.body?.force || "")
        .trim()
        .toLowerCase() === "true";
    const { locked, result } = await withAdvisoryLock(
      `product-sync-start:${session.shop}`,
      async () => {
        const {
          status,
          degraded: bulkStatusDegraded,
          error: bulkStatusError,
        } = await safeGetCurrentBulkOperationStatus(session, "QUERY");

        if (status === "RUNNING") {
          return {
            statusCode: 400,
            payload: {
              message: "Another operation is running in background",
            },
          };
        }

        const [store, productCount, latestCompletedSync, latestSyncExecution] = await Promise.all([
          prisma.store.findUnique({
            where: { shopUrl: session.shop },
            select: {
              isProductSyncing: true,
              isProductInitialySyning: true,
              shopifyBulkJobCompleted: true,
              storeTotalProducts: true,
              lastProductSyncAt: true,
            },
          }),

          prisma.product.count({
            where: { shop: session.shop },
          }),

          safeGetLatestCompletedSync(session.shop, "Product"),
          safeGetLatestSyncExecutionSummary(session.shop, "Product"),
        ]);

        const alreadySynced =
          !!store &&
          store.isProductSyncing === false &&
          store.isProductInitialySyning === false &&
          store.shopifyBulkJobCompleted === true &&
          productCount > 0 &&
          !isStaleSyncExecution(latestSyncExecution);

        if (alreadySynced && !force) {
          return {
            statusCode: 200,
            payload: {
              message: "Products already synced. Skipping new sync.",
              skipped: true,
              forceAllowed: true,
              data: {
                productCount,
                storeTotalProducts: store.storeTotalProducts,
                lastProductSyncAt: store.lastProductSyncAt,
                lastCompletedSyncAt: latestCompletedSync?.updatedAt || null,
                lastCompletedRecordCount: latestCompletedSync?.recordCount || null,
              },
            },
          };
        }

        let syncResult;
        try {
          syncResult = await service.startBulkOperationToFetchProducts({
            session,
          });
        } catch (error) {
          await logApiError({
            shop: session.shop,
            err: error,
            req,
            source: "syncController.syncProductData.startBulkOperation",
          });

          return {
            statusCode: 200,
            payload: {
              message: "Unable to start product sync right now.",
              error: error.message || "Failed to start product sync",
              skipped: false,
              forced: force,
              degraded: true,
              details: {
                bulkStatusCheckDegraded: Boolean(bulkStatusDegraded),
                bulkStatusError: bulkStatusError || null,
              },
            },
          };
        }

        const cacheKey = `${session.shop}:sync_details`;
        await clearKeyCaches(cacheKey).catch((error) => {
          console.warn(
            `Failed to clear sync status cache for ${session.shop}: ${error.message}`,
          );
        });

        return {
          statusCode: 200,
          payload: {
            ...syncResult,
            skipped: false,
            forced: force,
            degraded: Boolean(bulkStatusDegraded),
            details: {
              bulkStatusCheckDegraded: Boolean(bulkStatusDegraded),
              bulkStatusError: bulkStatusError || null,
            },
          },
        };
      },
    );

    if (!locked) {
      return res.status(409).json({
        message: "A product sync start is already being processed",
      });
    }

    return res.status(result.statusCode).json(result.payload);
  } catch (error) {
    await logApiError({
      shop: session.shop,
      err: error,
      req,
      source: "syncController.syncProductData",
    });

    return res.status(200).json({
      message: "Unable to start product sync right now.",
      error: error?.message || "Failed to fetch products",
      skipped: false,
      degraded: true,
    });
  }
};

/**
 * Get sync status for a shop.
 * Previously: Store.findOne({ shopUrl }).select("syncDetails")
 * Now: prisma.store.findUnique + construct syncDetails object.
 */
export const getSyncStatus = async (req, res) => {
  const session = res.locals.shopify?.session;
  const fallbackShop = session?.shop || req.query.shop || null;

  try {
    const shop = session?.shop || req.query.shop;

    if (!shop) {
      return res.status(400).json({
        error: "Shop is required",
      });
    }

    const cacheKey = `${shop}:sync_details`;

    let syncDetails = await getCache(cacheKey);

    if (syncDetails && !isProductSyncProjectedActive(syncDetails)) {
      return res.status(200).json({
        success: true,
        shop,
        syncStatus: syncDetails,
      });
    }

    // Cache MISS
    let [store, latestSyncExecution] = await Promise.all([
      safeGetStoreSyncStatus(shop),
      safeGetLatestSyncExecutionSummary(shop, "Product"),
    ]);

    if (!store) {
      return res.status(404).json({
        error: "Store not found",
        success: false,
      });
    }

    if (shouldRefreshProductSyncProjection(store, latestSyncExecution)) {
      await reconcileStoreSyncProjection({
        shop,
        operationType: "Product",
      }).catch((error) => {
        console.warn(
          `Failed to reconcile product sync projection for ${shop}: ${error.message}`,
        );
      });

      [store, latestSyncExecution] = await Promise.all([
        safeGetStoreSyncStatus(shop),
        safeGetLatestSyncExecutionSummary(shop, "Product"),
      ]);
    }

    syncDetails = buildFallbackSyncStatus({
      isCollectionSyncing: store.isCollectionSyncing,
      lastCollectionSyncAt: store.lastCollectionSyncAt,
      mirrorHealthState: store.mirrorHealthState,
      staleReason: store.staleReason,
      repairRequired: store.repairRequired,
      mirrorUnsafeSince: store.mirrorUnsafeSince,
      lastFullSyncAt: store.lastFullSyncAt,
      lastIncrementalSyncAt: store.lastIncrementalSyncAt,
      lastWebhookProcessedAt: store.lastWebhookProcessedAt,
      lastReconcileAt: store.lastReconcileAt,
      lastInventoryReconcileAt: store.lastInventoryReconcileAt,
      lastCollectionReconcileAt: store.lastCollectionReconcileAt,
      lastSyncErrorSummary: store.lastSyncErrorSummary,
      syncProgressStage: store.syncProgressStage,
      isProductTypeSyncing: store.isProductTypeSyncing,
      lastProductTypeSyncAt: store.lastProductTypeSyncAt,
      isProductInitialySyning: store.isProductInitialySyning,
      productInitialSyncProgress: store.productInitialSyncProgress,
      shopifyBulkJobCompleted: store.shopifyBulkJobCompleted,
      storeTotalProducts: store.storeTotalProducts,
      isProductSyncing: store.isProductSyncing,
      lastProductSyncAt: store.lastProductSyncAt,
      latestSyncHistoryId: latestSyncExecution?.id || null,
      latestSyncStage: latestSyncExecution?.stage || null,
      latestSyncExecutionState: latestSyncExecution?.executionState || null,
      latestSyncExecutionIdentity: latestSyncExecution?.executionIdentity || null,
      latestSyncHeartbeatAt: latestSyncExecution?.lastHeartbeatAt || null,
      latestSyncCompletedAt: latestSyncExecution?.completedAt || null,
      latestSyncErrorSummary: latestSyncExecution?.errorSummary || null,
      latestSyncOperationType: latestSyncExecution?.operationType || null,
      stuckSyncDetected: isStaleSyncExecution(latestSyncExecution),
    });

    if (!isProductSyncProjectedActive(syncDetails)) {
      await setCache(cacheKey, syncDetails, 300).catch((error) => {
        console.warn(`Failed to cache sync status for ${shop}: ${error.message}`);
      });
    }

    return res.status(200).json({
      success: true,
      shop,
      syncStatus: syncDetails,
    });
  } catch (error) {
    await logApiError({
      shop: fallbackShop,
      err: error,
      req,
      source: "syncController.getSyncStatus",
    });

    console.error("💥 Error fetching sync status:", error);

    return res.status(200).json({
      success: true,
      shop: fallbackShop,
      syncStatus: buildFallbackSyncStatus({
        lastSyncErrorSummary: error?.message || "Sync status fallback returned",
      }),
      degraded: true,
    });
  }
};

/**
 * Track initial product sync progress.
 */
export const trackProductSync = async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shop = session.shop;

    const storeDetails = await prisma.store.findUnique({
      where: { shopUrl: shop },
      select: {
        isProductInitialySyning: true,
        productInitialSyncProgress: true,
        shopifyBulkJobCompleted: true,
        storeTotalProducts: true,
        syncProgressStage: true,
      },
    }).catch(async (error) => {
      console.warn(
        `Failed to load product track store details for ${shop}: ${error.message}`,
      );

      return prisma.store.findUnique({
        where: { shopUrl: shop },
        select: {
          isProductInitialySyning: true,
          productInitialSyncProgress: true,
          shopifyBulkJobCompleted: true,
          storeTotalProducts: true,
        },
      }).catch(() => null);
    });

    if (!storeDetails) {
      return res.status(200).json({
        success: true,
        message: "Store sync details unavailable",
        status: "idle",
        stage: "IDLE",
        totalProducts: 0,
        processedProducts: 0,
        progress: 0,
        degraded: true,
      });
    }

    const {
      isProductInitialySyning,
      productInitialSyncProgress,
      shopifyBulkJobCompleted,
      storeTotalProducts,
      syncProgressStage,
    } = storeDetails;

    // Initial phase finished
    if (isProductInitialySyning === false) {
      return res.status(200).json({
        success: true,
        message: "Product syncing completed.",
        status: "completed",
        stage: "IDLE",
        totalProducts: storeTotalProducts,
        processedProducts: storeTotalProducts,
        progress: 100,
      });
    }

    const totalProducts = storeTotalProducts || 0;

    // Phase 1: Shopify bulk job running
    if (!shopifyBulkJobCompleted) {
      const syncHistory = await safeGetLatestSyncExecutionSummary(shop, "Product");

      if (!syncHistory || !syncHistory.bulkOperationId) {
        return res.status(200).json({
          success: true,
          message: "No initial product sync found",
          status: "idle",
          totalProducts,
          processedProducts: 0,
          progress: 0,
        });
      }

      const result = await getBulkEditStatus(
        syncHistory.bulkOperationId,
        session
      ).catch((error) => {
        console.warn(
          `Failed to load Shopify bulk progress for ${shop}: ${error.message}`,
        );
        return null;
      });

      const shopifyBulkProgress = result?.rootObjectCount || 0;

      return res.status(200).json({
        success: true,
        message: "Product Sync in progress...",
        status: "syncing",
        stage:
          syncHistory?.executionState === "finalizing"
            ? "MIRROR_STAGING"
            : syncProgressStage || syncHistory?.stage || "SHOPIFY_BULK_RUNNING",
        totalProducts,
        processedProducts: shopifyBulkProgress,
        progress: totalProducts > 0
          ? Math.min(Number(((shopifyBulkProgress / totalProducts) * 100).toFixed(2)), 100)
          : 0,
        degraded: result == null,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Product Sync in progress...",
      status: "syncing",
      stage: syncProgressStage || "MIRROR_STAGING",
      totalProducts,
      processedProducts: productInitialSyncProgress || 0,
      progress: totalProducts > 0
        ? Math.min(Number((((productInitialSyncProgress || 0) / totalProducts) * 100).toFixed(2)), 100)
        : 0,
    });
  } catch (error) {
    console.error(error.message);

    return res.status(200).json({
      success: true,
      message: error.message || "Product sync progress unavailable",
      status: "syncing",
      stage: "UNKNOWN",
      totalProducts: 0,
      processedProducts: 0,
      progress: 0,
      degraded: true,
    });
  }
};
