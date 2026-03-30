// web/controllers/syncController.js

import { Services } from "../services/productService/productFilterService.js";
import {
  getBulkEditStatus,
  getCurrentBulkOperationStatus,
} from "../utils/bulkOperationHelper.js";
import { setCache, getCache, clearKeyCaches } from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { prisma } from "../config/database.js";

const service = new Services();

/**
 * Trigger Shopify Bulk Operation to fetch products.
 * (No DB change here — only cache + bulk op)
 */
export const syncProductData = async (req, res) => {
  const session = res.locals.shopify.session;

  try {
    const { status } = await getCurrentBulkOperationStatus(session, "QUERY");

    if (status === "RUNNING") {
      return res.status(400).json({
        message: "Another operation is running in background",
      });
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
        },
      });
    }

    const result = await service.startBulkOperationToFetchProducts({
      session,
    });

    const cacheKey = `${session.shop}:sync_details`;
    await clearKeyCaches(cacheKey);

    return res.status(200).json({
      ...result,
      skipped: false,
      forced: force,
    });
  } catch (error) {
    await logApiError({
      shop: session.shop,
      err: error,
      req,
      source: "syncController.syncProductData",
    });

    return res.status(500).json({
      error: "Failed to fetch products",
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

  try {
    const shop = session?.shop || req.query.shop;

    if (!shop) {
      return res.status(400).json({
        error: "Shop is required",
      });
    }

    const cacheKey = `${shop}:sync_details`;

    let syncDetails = await getCache(cacheKey);

    if (syncDetails) {
      return res.status(200).json({
        success: true,
        shop,
        syncStatus: syncDetails,
      });
    }

    // Cache MISS
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
      },
    });

    if (!store) {
      return res.status(404).json({
        error: "Store not found",
        success: false,
      });
    }

    syncDetails = {
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

    console.error("💥 Error fetching sync status:", error);

    return res.status(500).json({
      error: "Internal Server Error",
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
    });

    if (!storeDetails) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
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
      const syncHistory = await prisma.syncHistory.findFirst({
        where: {
          shop,
          isInitialProductSync: true,
        },
        orderBy: { createdAt: "desc" },
        select: { bulkOperationId: true },
      });

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
      );

      const shopifyBulkProgress = result?.rootObjectCount || 0;

      const percentage =
        totalProducts > 0
          ? Math.min(
              ((shopifyBulkProgress / totalProducts) * 100).toFixed(2),
              100
            ) / 2
          : 0;

      return res.status(200).json({
        success: true,
        message: "Product Sync in progress...",
        status: "syncing",
        stage: syncProgressStage || "SHOPIFY_BULK_RUNNING",
        totalProducts,
        processedProducts: shopifyBulkProgress,
        progress: totalProducts > 0
          ? Math.min(Number(((shopifyBulkProgress / totalProducts) * 100).toFixed(2)), 100)
          : 0,
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

    return res.status(500).json({
      error: "Internal Server Error",
      message: error.message,
    });
  }
};
