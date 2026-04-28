import { productFilterService } from "../services/productService/productFilterService.js";
import {
  getBulkEditStatus,
  getCurrentBulkOperationStatus,
} from "../utils/bulkOperationHelper.js";
import { setCache, getCache, clearKeyCaches } from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { prisma } from "../config/database.js";
import shopify from "../shopify.js";
import { handleSyncOperation } from "../helpers/webhookHelpers/bulkOperations/productTypeSync.js";

const SYNC_STARTING_STAGE = "SHOPIFY_BULK_STARTING";

function finalizeCompletedProductBulkOperation({ shop, bulkOperationId }) {
  if (!shop || !bulkOperationId) return;

  setImmediate(async () => {
    try {
      await handleSyncOperation({ bulkOperationId, shop });
    } catch (error) {
      console.error("[sync:poll_finalize_failed]", {
        shop,
        bulkOperationId,
        error: error.message,
      });
    }
  });
}

function parseForceFlag(req) {
  return String(req.body?.force || "")
    .trim()
    .toLowerCase() === "true";
}

async function resolveActiveSessionForShop(session, shop) {
  if (
    session?.shop === shop &&
    session?.accessToken &&
    typeof session?.isActive === "function" &&
    session.isActive(shopify.api.config.scopes)
  ) {
    return session;
  }

  const loadSession = shopify?.config?.sessionStorage?.loadSession;
  const getOfflineId = shopify?.api?.session?.getOfflineId;

  if (typeof loadSession !== "function" || typeof getOfflineId !== "function") {
    throw new Error("Shopify session storage is not configured");
  }

  const offlineSession = await loadSession.call(
    shopify.config.sessionStorage,
    getOfflineId(shop),
  );

  if (
    !offlineSession?.accessToken ||
    offlineSession.shop !== shop ||
    (typeof offlineSession.isActive === "function" &&
      !offlineSession.isActive(shopify.api.config.scopes))
  ) {
    throw new Error(`Active Shopify session not found for shop: ${shop}`);
  }

  return offlineSession;
}

async function releaseSyncStartLock(shop, errorMessage = null) {
  if (!shop) return;

  await prisma.store.updateMany({
    where: {
      shopUrl: shop,
      syncProgressStage: SYNC_STARTING_STAGE,
    },
    data: {
      isProductSyncing: false,
      isProductInitialySyning: false,
      syncProgressStage: "IDLE",
      lastSyncErrorSummary: errorMessage,
    },
  }).catch(() => {});
}

export const syncProductData = async (req, res) => {
  const session = res.locals?.shopify?.session;
  const force = parseForceFlag(req);
  let startLockAcquired = false;

  try {
    if (!session?.shop) {
      return res.status(401).json({
        error: "Shopify session missing",
      });
    }

    console.log("[api:sync_request]", {
      shop: session.shop,
      force,
    });

    const currentBulkOperation = await getCurrentBulkOperationStatus(
      session,
      "QUERY",
    );

     if (currentBulkOperation?.status === "RUNNING") {
      console.log(`[api:sync_blocked] shop=${session.shop} reason=bulk_op_running`);
      return res.status(400).json({ message: "Another operation is running in background" });
    }

    const store = await prisma.store.findUnique({
      where: { shopUrl: session.shop },
      select: {
        isProductSyncing: true,
        isProductInitialySyning: true,
        shopifyBulkJobCompleted: true,
        storeTotalProducts: true,
        lastProductSyncAt: true,
        syncProgressStage: true,
        activeMirrorBatchId: true,
        mirrorHealthState: true,
      },
    });

    const [productCount, latestCompletedSync] = await Promise.all([
      store?.activeMirrorBatchId
        ? prisma.product.count({
            where: {
              shop: session.shop,
              mirrorBatchId: store.activeMirrorBatchId,
            },
          })
        : Promise.resolve(0),

      prisma.syncHistory.findFirst({
        where: {
          shop: session.shop,
          operationType: "Product",
          status: "completed",
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          updatedAt: true,
          recordCount: true,
        },
      }),
    ]);

    const alreadySynced =
      !!store &&
      store.isProductSyncing === false &&
      store.isProductInitialySyning === false &&
      store.shopifyBulkJobCompleted === true &&
      !["UNSAFE", "REPAIR_REQUIRED"].includes(String(store.mirrorHealthState || "")) &&
      productCount > 0;

    if (alreadySynced && !force) {
      return res.status(200).json({
        message: "Products already synced. Skipping new sync.",
        skipped: true,
        forceAllowed: true,
        data: {
          productCount,
          storeTotalProducts: store.storeTotalProducts,
          lastProductSyncAt: store.lastProductSyncAt,
          lastCompletedSyncAt: latestCompletedSync?.updatedAt || null,
          lastCompletedRecordCount: latestCompletedSync?.recordCount || null,
          mirrorHealthState: store.mirrorHealthState || null,
        },
      });
    }

    const lockResult = await prisma.store.updateMany({
      where: {
        shopUrl: session.shop,
        isProductSyncing: false,
        isProductInitialySyning: false,
      },
      data: {
        isProductSyncing: true,
        isProductInitialySyning: false,
        syncProgressStage: SYNC_STARTING_STAGE,
        lastSyncErrorSummary: null,
      },
    });

    if (lockResult.count !== 1) {
      return res.status(409).json({
        error: "Sync already in progress",
        message: "Another sync request is already starting or running",
      });
    }

    startLockAcquired = true;

    const isInitialSync =
      !store?.shopifyBulkJobCompleted &&
      !store?.activeMirrorBatchId &&
      productCount === 0;

    const result = await productFilterService.startBulkOperationToFetchProducts({
      session,
      isInitialSync,
    });
    console.log(`[api:sync_triggered] shop=${session.shop} bulkOperationId=${result.bulkOperationId} syncHistoryId=${result.syncHistoryId}`);

    if (!result?.bulkOperationId || !result?.syncHistoryId || !result?.syncBatchId) {
      throw new Error("Product sync started without required tracking identifiers");
    }
    

    await clearKeyCaches(`${session.shop}:sync_`);

    return res.status(200).json({
      success: true,
      message: "Product sync started",
      skipped: false,
      forced: force,
      bulkOperationId: result.bulkOperationId,
      syncHistoryId: result.syncHistoryId,
    });
  } catch (error) {
    if (startLockAcquired) {
      await releaseSyncStartLock(session?.shop, error.message);
    }

    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "syncController.syncProductData",
    });

    return res.status(500).json({
      error: "Failed to fetch products",
      message: error.message,
    });
  }
};

export const getSyncStatus = async (req, res) => {
  const session = res.locals?.shopify?.session;

  try {
    const shop = session?.shop;

    if (!shop) {
      return res.status(401).json({
        error: "Shopify session missing",
      });
    }

    const [store, latestSync] = await Promise.all([
      prisma.store.findUnique({
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
      }),

      prisma.syncHistory.findFirst({
        where: {
          shop,
          operationType: "Product",
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          bulkOperationId: true,
          syncBatchId: true,
          status: true,
          stage: true,
          recordCount: true,
          updatedAt: true,
          errorMessage: true,
          isInitialProductSync: true,
        },
      }),
    ]);

    if (!store) {
      return res.status(404).json({
        success: false,
        error: "Store not found",
      });
    }

    let syncProgressStage = store.syncProgressStage;

    if (
      store.shopifyBulkJobCompleted === false &&
      latestSync?.bulkOperationId &&
      latestSync?.status === "processing" &&
      ["SHOPIFY_BULK_RUNNING", SYNC_STARTING_STAGE].includes(
        String(store.syncProgressStage || ""),
      )
    ) {
      const bulkStatusCacheKey = `${shop}:sync_bulk_status:${latestSync.bulkOperationId}`;
      let bulkStatus = await getCache(bulkStatusCacheKey);

      if (!bulkStatus) {
        const activeSession = await resolveActiveSessionForShop(session, shop);
        bulkStatus = await getBulkEditStatus(latestSync.bulkOperationId, activeSession);
        await setCache(bulkStatusCacheKey, bulkStatus, 3);
      }

      if (bulkStatus?.status === "COMPLETED") {
        syncProgressStage = "MIRROR_DOWNLOAD_STARTED";
        finalizeCompletedProductBulkOperation({
          shop,
          bulkOperationId: latestSync.bulkOperationId,
        });
      } else if (["FAILED", "CANCELED", "CANCELING"].includes(bulkStatus?.status)) {
        syncProgressStage = "FAILED";
        finalizeCompletedProductBulkOperation({
          shop,
          bulkOperationId: latestSync.bulkOperationId,
        });
      }
    }

    const syncDetails = {
      isCurrentlyRunning:
        store.isProductSyncing === true || store.isProductInitialySyning === true,
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
      syncProgressStage,
      isProductTypeSyncing: store.isProductTypeSyncing,
      lastProductTypeSyncAt: store.lastProductTypeSyncAt,
      isProductInitialySyning: store.isProductInitialySyning,
      productInitialSyncProgress: store.productInitialSyncProgress,
      shopifyBulkJobCompleted: store.shopifyBulkJobCompleted,
      storeTotalProducts: store.storeTotalProducts,
      isProductSyncing: store.isProductSyncing,
      lastProductSyncAt: store.lastProductSyncAt,
      latestSync,
    };

    return res.status(200).json({
      success: true,
      shop,
      syncStatus: syncDetails,
    });
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "syncController.getSyncStatus",
    });

    return res.status(500).json({
      error: "Internal Server Error",
      message: error.message,
    });
  }
};

export const trackProductSync = async (req, res) => {
  const session = res.locals?.shopify?.session;

  try {
    const shop = session?.shop;

    if (!shop) {
      return res.status(401).json({ success: false, error: "Shopify session missing" });
    }

    const [storeDetails, latestSync] = await Promise.all([
      prisma.store.findUnique({
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
      }),

      prisma.syncHistory.findFirst({
        where: {
          shop,
          operationType: "Product",
        },
        orderBy: { updatedAt: "desc" },
        select: {
          bulkOperationId: true,
          status: true,
          stage: true,
          errorMessage: true,
          isInitialProductSync: true,
          recordCount: true,
        },
      }),
    ]);

    if (!storeDetails) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }

    const totalProducts = storeDetails.storeTotalProducts || 0;

    if (latestSync?.status === "failed") {
      return res.status(200).json({
        success: false,
        message: latestSync.errorMessage || storeDetails.lastSyncErrorSummary || "Product sync failed",
        status: "failed",
        stage: latestSync.stage || "FAILED",
        totalProducts,
        processedProducts: storeDetails.productInitialSyncProgress || 0,
        progress:
          totalProducts > 0
            ? Math.min(
                Number(
                  (((storeDetails.productInitialSyncProgress || 0) / totalProducts) * 100).toFixed(2),
                ),
                100,
              )
            : 0,
      });
    }

    if (!latestSync) {
      return res.status(200).json({
        success: true,
        message: "No product sync found",
        status: "idle",
        stage: "IDLE",
        totalProducts,
        processedProducts: 0,
        progress: 0,
      });
    }

    if (
      storeDetails.isProductSyncing === false &&
      storeDetails.isProductInitialySyning === false &&
      storeDetails.shopifyBulkJobCompleted === true
    ) {
      return res.status(200).json({
        success: true,
        message: "Product syncing completed.",
        status: "completed",
        stage: "IDLE",
        totalProducts,
        processedProducts: latestSync.recordCount ?? totalProducts,
        progress: 100,
      });
    }

    if (!storeDetails.shopifyBulkJobCompleted) {
      if (!latestSync.bulkOperationId) {
        return res.status(200).json({
          success: true,
          message: "No product sync found",
          status: "idle",
          stage: "IDLE",
          totalProducts,
          processedProducts: 0,
          progress: 0,
        });
      }

      const bulkStatusCacheKey = `${shop}:sync_bulk_status:${latestSync.bulkOperationId}`;
      let result = await getCache(bulkStatusCacheKey);

      if (!result) {
        const activeSession = await resolveActiveSessionForShop(session, shop);
        result = await getBulkEditStatus(latestSync.bulkOperationId, activeSession);
        await setCache(bulkStatusCacheKey, result, 3);
      }

      if (result?.status === "COMPLETED") {
        finalizeCompletedProductBulkOperation({
          shop,
          bulkOperationId: latestSync.bulkOperationId,
        });

        return res.status(200).json({
          success: true,
          message: "Shopify bulk sync completed. Finalizing product mirror...",
          status: "syncing",
          stage: "MIRROR_DOWNLOAD_STARTED",
          totalProducts,
          processedProducts: storeDetails.productInitialSyncProgress || 0,
          progress:
            totalProducts > 0
              ? Math.min(
                  Number(
                    (((storeDetails.productInitialSyncProgress || 0) / totalProducts) * 100).toFixed(2),
                  ),
                  100,
                )
              : 0,
        });
      }

      if (["FAILED", "CANCELED", "CANCELING"].includes(result?.status)) {
        finalizeCompletedProductBulkOperation({
          shop,
          bulkOperationId: latestSync.bulkOperationId,
        });

        return res.status(200).json({
          success: false,
          message: `Shopify bulk operation ${String(result?.status || "failed").toLowerCase()}`,
          status: "failed",
          stage: "FAILED",
          totalProducts,
          processedProducts: storeDetails.productInitialSyncProgress || 0,
          progress: 0,
        });
      }

      const shopifyBulkProgress = Number(result?.rootObjectCount || 0);

      return res.status(200).json({
        success: true,
        message: "Product Sync in progress...",
        status: "syncing",
        stage: storeDetails.syncProgressStage || latestSync.stage || "SHOPIFY_BULK_RUNNING",
        totalProducts,
        processedProducts: shopifyBulkProgress,
        progress:
          totalProducts > 0
            ? Math.min(
                Number(((shopifyBulkProgress / totalProducts) * 100).toFixed(2)),
                100,
              )
            : 0,
      });
    }

    if (
      storeDetails.isProductSyncing === false &&
      storeDetails.isProductInitialySyning === false
    ) {
      return res.status(200).json({
        success: true,
        message: "No product sync found",
        status: "idle",
        stage: "IDLE",
        totalProducts,
        processedProducts: 0,
        progress: 0,
      });
    }

    const processedProducts = storeDetails.productInitialSyncProgress || 0;

    return res.status(200).json({
      success: true,
      message: "Product Sync in progress...",
      status: "syncing",
      stage: storeDetails.syncProgressStage || latestSync?.stage || "MIRROR_STAGING",
      totalProducts,
      processedProducts,
      progress:
        totalProducts > 0
          ? Math.min(
              Number(((processedProducts / totalProducts) * 100).toFixed(2)),
              100,
            )
          : 0,
      });
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "syncController.trackProductSync",
    });

    return res.status(500).json({
      error: "Internal Server Error",
      message: error.message,
    });
  }
};
