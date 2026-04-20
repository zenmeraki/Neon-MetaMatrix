import { Services } from "../services/productService/productFilterService.js";
import {
  getBulkEditStatus,
  getCurrentBulkOperationStatus,
} from "../utils/bulkOperationHelper.js";
import { setCache, getCache, clearKeyCaches } from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { prisma } from "../config/database.js";

const service = new Services();

export const syncProductData = async (req, res) => {
  const session = res.locals?.shopify?.session;

  try {
    if (!session?.shop) {
      return res.status(401).json({
        error: "Shopify session missing",
      });
    }

        console.log(`[api:sync_request] shop=${session.shop} force=${req.query.force || req.body?.force}`);

    const currentBulkOperation = await getCurrentBulkOperationStatus(
      session,
      "QUERY",
    );

     if (currentBulkOperation?.status === "RUNNING") {
      console.log(`[api:sync_blocked] shop=${session.shop} reason=bulk_op_running`);
      return res.status(400).json({ message: "Another operation is running in background" });
    }

    const force =
      String(req.query.force || req.body?.force || "")
        .trim()
        .toLowerCase() === "true";

    const [store, productCount, latestCompletedSync] = await Promise.all([
      prisma.store.findUnique({
        where: { shopUrl: session.shop },
        select: {
          isProductSyncing: true,
          isProductInitialySyning: true,
          shopifyBulkJobCompleted: true,
          storeTotalProducts: true,
          lastProductSyncAt: true,
          syncProgressStage: true,
        },
      }),

      prisma.product.count({
        where: { shop: session.shop },
      }),

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
          syncBatchId: true,
        },
      }),
    ]);

    const alreadySynced =
      !!store &&
      store.isProductSyncing === false &&
      store.isProductInitialySyning === false &&
      store.shopifyBulkJobCompleted === true &&
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
          lastCompletedSyncBatchId: latestCompletedSync?.syncBatchId || null,
        },
      });
    }

    const result = await service.startBulkOperationToFetchProducts({
      session,
      isInitialSync: false,
    });
    console.log(`[api:sync_triggered] shop=${session.shop} bulkOperationId=${result.bulkOperationId} syncHistoryId=${result.syncHistoryId}`);

    await clearKeyCaches(`${session.shop}:sync_details`);

    return res.status(200).json({
      success: true,
      message: "Product sync started",
      skipped: false,
      forced: force,
      bulkOperationId: result.bulkOperationId,
      syncHistoryId: result.syncHistoryId,
      syncBatchId: result.syncBatchId,
    });
  } catch (error) {
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
    const shop = session?.shop || req.query.shop;

    if (!shop) {
      return res.status(400).json({
        error: "Shop is required",
      });
    }

    const cacheKey = `${shop}:sync_details`;
    const cached = await getCache(cacheKey);

    if (cached) {
      return res.status(200).json({
        success: true,
        shop,
        syncStatus: cached,
      });
    }

    const store = await prisma.store.findUnique({
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

    if (!store) {
      return res.status(404).json({
        success: false,
        error: "Store not found",
      });
    }

    const latestSync = await prisma.syncHistory.findFirst({
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
        errorMessage: true,
        isInitialProductSync: true,
      },
    });

    const syncDetails = {
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
      activeMirrorBatchId: store.activeMirrorBatchId,
      latestSync,
    };

    await setCache(cacheKey, syncDetails, 300);

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
  try {
    const session = res.locals?.shopify?.session;
    const shop = session?.shop;

   if (!shop) {
      return res.status(401).json({ success: false, error: "Shopify session missing" });
    }

    const storeDetails = await prisma.store.findUnique({
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

    if (!storeDetails) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }

    const latestSync = await prisma.syncHistory.findFirst({
      where: {
        shop,
        operationType: "Product",
      },
      orderBy: { createdAt: "desc" },
      select: {
        bulkOperationId: true,
        status: true,
        stage: true,
        errorMessage: true,
        isInitialProductSync: true,
      },
    });

    const totalProducts = storeDetails.storeTotalProducts || 0;

    if (
      storeDetails.isProductSyncing === false &&
      storeDetails.isProductInitialySyning === false
    ) {
      return res.status(200).json({
        success: true,
        message: "Product syncing completed.",
        status: "completed",
        stage: "IDLE",
        totalProducts,
        processedProducts: totalProducts,
        progress: 100,
      });
    }

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

    if (!storeDetails.shopifyBulkJobCompleted) {
      if (!latestSync?.bulkOperationId) {
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

      const result = await getBulkEditStatus(latestSync.bulkOperationId, session);
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
      shop: session?.shop,   // session is already in scope from the try block
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