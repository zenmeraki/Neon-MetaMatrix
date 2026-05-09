import { productFilterService } from "../services/productService/productFilterService.js";
import crypto from "crypto";
import {
  getBulkEditStatus,
  getCurrentBulkOperationStatus,
} from "../modules/bulkOperations/bulkOperationHelper.js";
import { setCache, getCache, clearKeyCaches } from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { prisma } from "../config/database.js";
import shopify from "../shopify.js";
import { idempotentCommandService } from "../services/idempotentCommandService.js";
import { classifyRetry } from "../utils/errorTaxonomy.js";

const SYNC_STARTING_STAGE = "SHOPIFY_BULK_STARTING";
const FORCE_BLOCKED_STAGES = new Set([
  "SHOPIFY_BULK_STARTING",
  "SHOPIFY_BULK_RUNNING",
  "MIRROR_STAGING",
  "ACTIVATING",
]);
const READY_MIRROR_STATES = new Set(["HEALTHY", "READY"]);

function parseForceFlag(req) {
  return String(req.body?.force || "")
    .trim()
    .toLowerCase() === "true";
}

function conflictResponse(code, message, extra = {}) {
  return {
    error: code,
    message,
    retryClass: classifyRetry(code),
    ...extra,
  };
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

async function releaseSyncStartLock(shop, syncLeaseOwner, errorMessage = null) {
  if (!shop) return;

  await prisma.store.updateMany({
    where: {
      shopUrl: shop,
      syncProgressStage: SYNC_STARTING_STAGE,
      ...(syncLeaseOwner ? { syncLeaseOwner } : {}),
    },
    data: {
      isProductSyncing: false,
      isProductInitialySyning: false,
      syncProgressStage: "IDLE",
      syncLeaseOwner: null,
      syncLeaseExpiresAt: null,
      lastSyncErrorSummary: errorMessage,
    },
  }).catch(() => {});
}

export const syncProductData = async (req, res) => {
  const session = res.locals?.shopify?.session;
  const force = parseForceFlag(req);
  let startLockAcquired = false;
  let command = null;
  let syncLeaseOwner = null;

  try {
    if (!session?.shop) {
      return res.status(401).json({
        error: "Shopify session missing",
      });
    }
    command = await idempotentCommandService.begin({
      shop: session.shop,
      operationType: "PRODUCT_SYNC_COMMAND",
      idempotencyKey: req.headers["idempotency-key"],
      resourceType: "SYNC_HISTORY",
    });
    if (command.enabled && !command.created) {
      if (command.row.status === "COMPLETED") {
        return res.status(200).json({
          success: true,
          skipped: true,
          message: "Sync request already accepted",
          syncHistoryId: command.row.resourceId || null,
          retryClass: classifyRetry("IDEMPOTENT_REPLAY_COMPLETED"),
        });
      }
      return res.status(409).json({
        error: "IDEMPOTENT_DUPLICATE_IN_PROGRESS",
        retryClass: classifyRetry("IDEMPOTENT_DUPLICATE_IN_PROGRESS"),
      });
    }

    console.log("[api:sync_request]", {
      shop: session.shop,
      force,
    });

    const [store, activeLocalSync] = await Promise.all([
      prisma.store.findUnique({
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
          staleReason: true,
          repairRequired: true,
        },
      }),
      prisma.syncHistory.findFirst({
        where: {
          shop: session.shop,
          operationType: "Product",
          status: "processing",
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          bulkOperationId: true,
          stage: true,
          status: true,
        },
      }),
    ]);

    if (activeLocalSync && !force) {
      return res.status(409).json({
        ...conflictResponse("SYNC_ALREADY_ACTIVE", "Sync already active"),
        syncHistoryId: activeLocalSync.id,
        stage: activeLocalSync.stage || null,
      });
    }

    if (force && FORCE_BLOCKED_STAGES.has(String(store?.syncProgressStage || ""))) {
      return res.status(409).json({
        ...conflictResponse(
          "UNSAFE_FORCE_SYNC",
          "Cannot force sync while another sync is active",
        ),
      });
    }

    const currentBulkOperation = await getCurrentBulkOperationStatus(session, "QUERY");
    if (currentBulkOperation?.status === "RUNNING" && !force) {
      console.log(`[api:sync_blocked] shop=${session.shop} reason=bulk_op_running`);
      return res.status(409).json({
        ...conflictResponse(
          "SHOPIFY_BULK_RUNNING",
          "Another Shopify bulk operation is running",
        ),
      });
    }

    const storeSnapshot = store || (await prisma.store.findUnique({
      where: { shopUrl: session.shop },
      select: {
        shopifyBulkJobCompleted: true,
        storeTotalProducts: true,
        lastProductSyncAt: true,
        activeMirrorBatchId: true,
        mirrorHealthState: true,
        staleReason: true,
        repairRequired: true,
      },
    }));

    const mirrorReady = READY_MIRROR_STATES.has(String(storeSnapshot?.mirrorHealthState || ""));
    const repairSyncAllowed =
      storeSnapshot?.repairRequired === true ||
      storeSnapshot?.staleReason === "FULL_SYNC_FAILED" ||
      !storeSnapshot?.activeMirrorBatchId;

    if (!mirrorReady && !repairSyncAllowed && !force) {
      return res.status(409).json({
        ...conflictResponse("MIRROR_NOT_READY", "Mirror is not ready"),
        mirrorHealthState: storeSnapshot?.mirrorHealthState || "UNKNOWN",
      });
    }

    const [productCount, latestCompletedSync] = await Promise.all([
      storeSnapshot?.activeMirrorBatchId
        ? prisma.product.count({
            where: {
              shop: session.shop,
              mirrorBatchId: storeSnapshot.activeMirrorBatchId,
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

    const expectedCount =
      Number(latestCompletedSync?.recordCount || 0) ||
      Number(storeSnapshot?.storeTotalProducts || 0) ||
      0;
    const alreadySynced =
      !!storeSnapshot &&
      storeSnapshot.shopifyBulkJobCompleted === true &&
      !!storeSnapshot.activeMirrorBatchId &&
      productCount > 0 &&
      expectedCount > 0 &&
      productCount >= Math.floor(expectedCount * 0.995) &&
      READY_MIRROR_STATES.has(String(storeSnapshot.mirrorHealthState || ""));

    if (alreadySynced && !force) {
      return res.status(200).json({
        message: "Products already synced. Skipping new sync.",
        skipped: true,
        forceAllowed: true,
        data: {
          productCount,
          storeTotalProducts: storeSnapshot.storeTotalProducts,
          lastProductSyncAt: storeSnapshot.lastProductSyncAt,
          lastCompletedSyncAt: latestCompletedSync?.updatedAt || null,
          lastCompletedRecordCount: latestCompletedSync?.recordCount || null,
          mirrorHealthState: storeSnapshot.mirrorHealthState || null,
        },
      });
    }

    syncLeaseOwner = crypto.randomUUID();
    const now = new Date();
    const lockResult = await prisma.store.updateMany({
      where: {
        shopUrl: session.shop,
        OR: [
          {
            syncProgressStage: "IDLE",
            isProductSyncing: false,
            isProductInitialySyning: false,
          },
          {
            syncProgressStage: SYNC_STARTING_STAGE,
            syncLeaseExpiresAt: { lt: now },
          },
        ],
      },
      data: {
        isProductSyncing: true,
        isProductInitialySyning: false,
        syncProgressStage: SYNC_STARTING_STAGE,
        syncLeaseOwner,
        syncLeaseExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        lastSyncErrorSummary: null,
      },
    });

    if (lockResult.count !== 1) {
      return res.status(409).json({
        ...conflictResponse(
          "SYNC_ALREADY_ACTIVE",
          "Another sync request is already starting or running",
        ),
      });
    }

    startLockAcquired = true;

    const isInitialSync = !storeSnapshot?.activeMirrorBatchId && !latestCompletedSync;

    const result = await productFilterService.startBulkOperationToFetchProducts({
      session,
      isInitialSync,
    });
    console.log(`[api:sync_triggered] shop=${session.shop} bulkOperationId=${result.bulkOperationId} syncHistoryId=${result.syncHistoryId}`);

    if (command?.enabled) {
      await idempotentCommandService.complete({
        id: command.row.id,
        resourceId: result.syncHistoryId || null,
      });
    }

    if (!result?.bulkOperationId || !result?.syncHistoryId || !result?.syncBatchId) {
      throw new Error("Product sync started without required tracking identifiers");
    }

    await clearKeyCaches(`${session.shop}:sync_`);

    return res.status(200).json({
      success: true,
    message: shouldRunVariantBackfill
  ? "Variant backfill started"
  : "Product sync started",
      skipped: false,
      forced: force,
      bulkOperationId: result.bulkOperationId,
      syncHistoryId: result.syncHistoryId,
    });
  } catch (error) {
    if (command?.enabled) {
      await idempotentCommandService.fail({ id: command.row.id, message: error.message });
    }
    if (startLockAcquired) {
      await releaseSyncStartLock(session?.shop, syncLeaseOwner, error.message);
    }

    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "syncController.syncProductData",
    });

    return res.status(500).json({
      error: "SYNC_START_FAILED",
      message: "Unable to start product sync",
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
      syncProgressStage: store.syncProgressStage,
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
      error: "SYNC_STATUS_FAILED",
      message: "Unable to load sync status",
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
          mirrorHealthState: true,
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
      latestSync?.status === "completed" &&
      storeDetails.isProductSyncing === false &&
      storeDetails.isProductInitialySyning === false &&
      storeDetails.shopifyBulkJobCompleted === true &&
      !!storeDetails.activeMirrorBatchId &&
      READY_MIRROR_STATES.has(String(storeDetails.mirrorHealthState || ""))
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
        if (result?.status === "RUNNING") {
          await setCache(bulkStatusCacheKey, result, 3);
        } else {
          await clearKeyCaches(bulkStatusCacheKey);
        }
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
      error: "SYNC_STATUS_FAILED",
      message: "Unable to load sync status",
    });
  }
};
