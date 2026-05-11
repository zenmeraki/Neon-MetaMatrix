import { productFilterService } from "../services/productService/productFilterService.js";
import crypto from "crypto";
import {
  cancelBulkOperation,
  getBulkEditStatus,
  getCurrentBulkOperationStatus,
} from "../modules/bulkOperations/bulkOperationHelper.js";
import { setCache, getCache, clearKeyCaches, getRedisClient } from "../utils/cacheUtils.js";
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
  "RECONCILING",
]);
const ACTIVE_SYNC_STAGES = new Set([
  "SHOPIFY_BULK_STARTING",
  "SHOPIFY_BULK_RUNNING",
  "MIRROR_STAGING",
  "RECONCILING",
]);
const ACTIVE_SHOPIFY_BULK_STATUSES = new Set(["CREATED", "RUNNING", "CANCELING"]);
const READY_MIRROR_STATES = new Set(["HEALTHY"]);
const SYNC_LEASE_TTL_MS = Math.max(
  Number(process.env.PRODUCT_SYNC_LEASE_TTL_MS || 30 * 60 * 1000),
  5 * 60 * 1000,
);
const SYNC_START_LEASE_TTL_MS = Math.max(
  Number(process.env.PRODUCT_SYNC_START_LEASE_TTL_MS || 15 * 60 * 1000),
  2 * 60 * 1000,
);
const BULK_STATUS_CACHE_TTL_SECONDS = Math.max(
  Number(process.env.PRODUCT_SYNC_BULK_STATUS_CACHE_TTL_SECONDS || 10),
  3,
);
const STALE_PRODUCT_SYNC_MS = Math.max(
  Number(process.env.PRODUCT_SYNC_STALE_RUNNING_MS || 30 * 60 * 1000),
  2 * 60 * 1000,
);
const FORCE_SYNC_COOLDOWN_SECONDS = Math.max(
  Number(process.env.FORCE_SYNC_COOLDOWN_SECONDS || 300),
  30,
);

function parseForceFlag(req) {
  return String(req.body?.force ?? req.query?.force ?? "")
    .trim()
    .toLowerCase() === "true";
}

function getSyncBulkStatusCacheKey(shop, bulkOperationId) {
  return `${shop}:sync:v2:bulk_status:${bulkOperationId}`;
}

function isActiveBulkOperation(bulkOperation) {
  return ACTIVE_SHOPIFY_BULK_STATUSES.has(String(bulkOperation?.status || ""));
}

function getSyncFreshnessTimestamp(syncHistory) {
  const heartbeatMs = syncHistory?.lastHeartbeatAt
    ? new Date(syncHistory.lastHeartbeatAt).getTime()
    : NaN;
  if (Number.isFinite(heartbeatMs)) return heartbeatMs;

  const updatedAtMs = syncHistory?.updatedAt
    ? new Date(syncHistory.updatedAt).getTime()
    : NaN;
  return Number.isFinite(updatedAtMs) ? updatedAtMs : null;
}

function conflictResponse(code, message, extra = {}) {
  return {
    error: code,
    message,
    retryClass: classifyRetry(code),
    ...extra,
  };
}

async function acquireForceSyncCooldown(shop) {
  const redis = getRedisClient();
  const key = `${shop}:sync:v2:force_cooldown`;
  const value = String(Date.now());
  const acquired = await redis.set(key, value, "EX", FORCE_SYNC_COOLDOWN_SECONDS, "NX");
  if (acquired === "OK") {
    return { acquired: true, retryAfterSeconds: 0 };
  }

  const ttl = await redis.ttl(key);
  return {
    acquired: false,
    retryAfterSeconds: Number.isFinite(Number(ttl)) && Number(ttl) > 0 ? Number(ttl) : FORCE_SYNC_COOLDOWN_SECONDS,
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

function isStaleProductSync(syncHistory) {
  if (!syncHistory || syncHistory.status !== "processing") return false;

  const stage = String(syncHistory.stage || "");
  if (stage && !ACTIVE_SYNC_STAGES.has(stage) && stage !== "SHOPIFY_VARIANT_BULK_RUNNING") {
    return false;
  }

  const freshnessMs = getSyncFreshnessTimestamp(syncHistory);
  if (!Number.isFinite(freshnessMs)) return false;

  return Date.now() - freshnessMs > STALE_PRODUCT_SYNC_MS;
}

async function releaseStaleProductSync(shop, activeLocalSync, errorMessage) {
  if (!shop || !activeLocalSync?.id) return;

  await prisma.$transaction([
    prisma.syncHistory.updateMany({
      where: {
        id: activeLocalSync.id,
        shop,
        status: "processing",
      },
      data: {
        status: "failed",
        stage: "STALE_SYNC_RELEASED",
        executionState: "failed",
        errorMessage,
      },
    }),
    prisma.store.updateMany({
      where: { shopUrl: shop },
      data: {
        isProductSyncing: false,
        isProductInitialySyning: false,
        syncProgressStage: "IDLE",
        syncLeaseOwner: null,
        syncLeaseExpiresAt: null,
        lastSyncErrorSummary: errorMessage,
      },
    }),
  ]);
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

    if (force) {
      const cooldown = await acquireForceSyncCooldown(session.shop);
      if (!cooldown.acquired) {
        return res.status(429).json({
          ...conflictResponse(
            "FORCE_SYNC_COOLDOWN_ACTIVE",
            "Force sync cooldown is active",
          ),
          retryAfterSeconds: cooldown.retryAfterSeconds,
        });
      }
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
      if (command.row.status === "FAILED") {
        return res.status(409).json({
          error: "IDEMPOTENT_REPLAY_FAILED",
          message: command.row.lastError || "Previous sync request with this idempotency key failed",
          retryClass: classifyRetry("IDEMPOTENT_REPLAY_FAILED"),
          retryWithNewIdempotencyKey: true,
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
          syncLeaseOwner: true,
          syncLeaseExpiresAt: true,
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
          syncBatchId: true,
          stage: true,
          status: true,
          updatedAt: true,
          executionState: true,
          executionIdentity: true,
          lastHeartbeatAt: true,
        },
      }),
    ]);

    const staleActiveLocalSync = activeLocalSync && isStaleProductSync(activeLocalSync);
    if (staleActiveLocalSync) {
      const staleMessage = `Product sync was stale for more than ${Math.round(
        STALE_PRODUCT_SYNC_MS / 60000,
      )} minutes; releasing local sync lock.`;
      console.warn("[api:sync_stale_released]", {
        shop: session.shop,
        syncHistoryId: activeLocalSync.id,
        bulkOperationId: activeLocalSync.bulkOperationId,
        stage: activeLocalSync.stage || null,
        updatedAt: activeLocalSync.updatedAt,
      });
      await releaseStaleProductSync(session.shop, activeLocalSync, staleMessage);
    }

    if (activeLocalSync && !staleActiveLocalSync) {
      return res.status(409).json({
        ...conflictResponse("SYNC_ALREADY_ACTIVE", "Sync already active"),
        syncHistoryId: activeLocalSync.id,
        stage: activeLocalSync.stage || null,
        forceIgnored: force,
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

    const [currentQueryBulkOperation, currentMutationBulkOperation] = await Promise.all([
      getCurrentBulkOperationStatus(session, "QUERY"),
      getCurrentBulkOperationStatus(session, "MUTATION"),
    ]);
    const currentBulkOperation = currentQueryBulkOperation;
    const staleBulkMatchesLocalSync =
      staleActiveLocalSync &&
      activeLocalSync?.bulkOperationId &&
      currentBulkOperation?.id === activeLocalSync.bulkOperationId;

    if (isActiveBulkOperation(currentBulkOperation) && staleBulkMatchesLocalSync) {
      console.warn("[api:sync_stale_bulk_cancel]", {
        shop: session.shop,
        bulkOperationId: currentBulkOperation.id,
      });
      try {
        await cancelBulkOperation(session, currentBulkOperation.id);
        await clearKeyCaches(
          getSyncBulkStatusCacheKey(session.shop, currentBulkOperation.id),
        ).catch(() => {});
      } catch (cancelError) {
        await logApiError({
          shop: session.shop,
          err: cancelError,
          req,
          source: "syncController.syncProductData.cancelStaleBulkOperation",
        });

        return res.status(409).json({
          ...conflictResponse(
            "STALE_SHOPIFY_BULK_CANCEL_FAILED",
            "Stale Shopify bulk operation could not be cancelled yet",
          ),
          bulkOperationId: currentBulkOperation.id,
        });
      }
    } else if (isActiveBulkOperation(currentQueryBulkOperation)) {
      console.log(`[api:sync_blocked] shop=${session.shop} reason=query_bulk_op_active`);
      return res.status(409).json({
        ...conflictResponse(
          "SHOPIFY_BULK_RUNNING",
          "Another Shopify bulk operation is running",
        ),
        bulkOperationId: currentQueryBulkOperation.id || null,
        bulkOperationType: currentQueryBulkOperation.type || "QUERY",
        forceIgnored: force,
      });
    }

    if (isActiveBulkOperation(currentMutationBulkOperation)) {
      console.log(`[api:sync_blocked] shop=${session.shop} reason=mutation_bulk_op_active`);
      return res.status(409).json({
        ...conflictResponse(
          "SHOPIFY_BULK_RUNNING",
          "Another Shopify bulk operation is running",
        ),
        bulkOperationId: currentMutationBulkOperation.id || null,
        bulkOperationType: currentMutationBulkOperation.type || "MUTATION",
        forceIgnored: force,
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
        syncLeaseOwner: true,
        syncLeaseExpiresAt: true,
      },
    }));

    const mirrorReady = READY_MIRROR_STATES.has(String(storeSnapshot?.mirrorHealthState || ""));
    const repairSyncAllowed =
      storeSnapshot?.repairRequired === true ||
      storeSnapshot?.staleReason === "FULL_SYNC_FAILED" ||
      !storeSnapshot?.activeMirrorBatchId;

    if (!mirrorReady && !repairSyncAllowed) {
      return res.status(409).json({
        ...conflictResponse("MIRROR_NOT_READY", "Mirror is not ready"),
        mirrorHealthState: storeSnapshot?.mirrorHealthState || "UNKNOWN",
        forceIgnored: force,
      });
    }

    const [existingProduct, existingVariant, latestCompletedSync] = await Promise.all([
      storeSnapshot?.activeMirrorBatchId
        ? prisma.product.findFirst({
            where: {
              shop: session.shop,
              mirrorBatchId: storeSnapshot.activeMirrorBatchId,
            },
            select: { id: true },
          })
        : Promise.resolve(null),
      storeSnapshot?.activeMirrorBatchId
        ? prisma.variant.findFirst({
            where: {
              shop: session.shop,
              mirrorBatchId: storeSnapshot.activeMirrorBatchId,
            },
            select: { id: true },
          })
        : Promise.resolve(null),

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
      !!existingProduct &&
      !!existingVariant &&
      expectedCount > 0 &&
      READY_MIRROR_STATES.has(String(storeSnapshot.mirrorHealthState || ""));

    if (alreadySynced && !force) {
      return res.status(200).json({
        message: "Products already synced. Skipping new sync.",
        skipped: true,
        forceAllowed: true,
        data: {
          productCount: latestCompletedSync?.recordCount || storeSnapshot.storeTotalProducts || null,
          variantCount: existingVariant ? 1 : 0,
          variantPresence: Boolean(existingVariant),
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
        syncLeaseExpiresAt: new Date(Date.now() + SYNC_START_LEASE_TTL_MS),
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

    const [postLockQueryBulkOperation, postLockMutationBulkOperation] = await Promise.all([
      getCurrentBulkOperationStatus(session, "QUERY"),
      getCurrentBulkOperationStatus(session, "MUTATION"),
    ]);

    if (isActiveBulkOperation(postLockQueryBulkOperation) || isActiveBulkOperation(postLockMutationBulkOperation)) {
      await releaseSyncStartLock(
        session.shop,
        syncLeaseOwner,
        "Shopify bulk operation became active before product sync submission",
      );
      startLockAcquired = false;
      const activeBulk = isActiveBulkOperation(postLockQueryBulkOperation)
        ? postLockQueryBulkOperation
        : postLockMutationBulkOperation;
      return res.status(409).json({
        ...conflictResponse(
          "SHOPIFY_BULK_RUNNING",
          "Another Shopify bulk operation is running",
        ),
        bulkOperationId: activeBulk.id || null,
        bulkOperationType: activeBulk.type || null,
      });
    }

    const isInitialSync = !storeSnapshot?.activeMirrorBatchId && !latestCompletedSync;

    const shouldRunVariantBackfill =
      !isInitialSync &&
      !!existingProduct &&
      !existingVariant &&
      storeSnapshot?.activeMirrorBatchId;

    const result = shouldRunVariantBackfill
      ? await productFilterService.startBulkOperationToFetchProductVariants({
          session,
          syncBatchId: storeSnapshot.activeMirrorBatchId,
          syncLeaseOwner,
        })
      : await productFilterService.startBulkOperationToFetchProducts({
          session,
          isInitialSync,
          syncLeaseOwner,
        });
    console.log(`[api:sync_triggered] shop=${session.shop} bulkOperationId=${result.bulkOperationId} syncHistoryId=${result.syncHistoryId}`);

    if (!result?.bulkOperationId || !result?.syncHistoryId || !result?.syncBatchId) {
      throw new Error("Product sync started without required tracking identifiers");
    }

    if (command?.enabled) {
      await idempotentCommandService.complete({
        id: command.row.id,
        resourceId: result.syncHistoryId || null,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Product sync started",
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
          syncLeaseExpiresAt: true,
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
          executionState: true,
          executionIdentity: true,
          lastHeartbeatAt: true,
        },
      }),
    ]);

    if (!store) {
      return res.status(404).json({
        success: false,
        error: "Store not found",
      });
    }

    const latestSyncIsProcessing = latestSync?.status === "processing";
    const storeStageIsActive = ACTIVE_SYNC_STAGES.has(String(store.syncProgressStage || ""));
    const leaseExpiresAtMs = store.syncLeaseExpiresAt
      ? new Date(store.syncLeaseExpiresAt).getTime()
      : NaN;
    const leaseExpired = Number.isFinite(leaseExpiresAtMs) && leaseExpiresAtMs < Date.now();
    const isCurrentlyRunning =
      latestSyncIsProcessing || (storeStageIsActive && !leaseExpired);

    const syncDetails = {
      isCurrentlyRunning,
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
      syncLeaseExpiresAt: store.syncLeaseExpiresAt,
      isProductTypeSyncing: store.isProductTypeSyncing,
      lastProductTypeSyncAt: store.lastProductTypeSyncAt,
      isProductInitialySyning: store.isProductInitialySyning,
      productInitialSyncProgress: store.productInitialSyncProgress,
      shopifyBulkJobCompleted: store.shopifyBulkJobCompleted,
      storeTotalProducts: store.storeTotalProducts,
      isProductSyncing: isCurrentlyRunning,
      lastProductSyncAt: store.lastProductSyncAt,
      latestSync,
    };

    return res.status(200).json({
      success: true,
      shop,
      syncStatus: syncDetails,
    });
   } catch (error) {
    console.error("[sync-status:500]", {
      shop: session?.shop,
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
      stack: error?.stack,
    });

    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "syncController.getSyncStatus",
    });

    return res.status(500).json({
      error: "SYNC_STATUS_FAILED",
      message: error?.message || "Unable to load sync status",
      code: error?.code || null,
      meta: error?.meta || null,
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
          syncLeaseExpiresAt: true,
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
          updatedAt: true,
          executionState: true,
          executionIdentity: true,
          lastHeartbeatAt: true,
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
    const leaseExpiresAtMs = storeDetails.syncLeaseExpiresAt
      ? new Date(storeDetails.syncLeaseExpiresAt).getTime()
      : NaN;
    const leaseExpired = Number.isFinite(leaseExpiresAtMs) && leaseExpiresAtMs < Date.now();
    const latestSyncProcessing = latestSync?.status === "processing";
    const storeStageActive = ACTIVE_SYNC_STAGES.has(String(storeDetails.syncProgressStage || ""));
    const authoritativeSyncRunning =
      latestSyncProcessing || (storeStageActive && !leaseExpired);

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
      !authoritativeSyncRunning &&
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

    if (!storeDetails.shopifyBulkJobCompleted && authoritativeSyncRunning) {
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

      const bulkStatusCacheKey = getSyncBulkStatusCacheKey(shop, latestSync.bulkOperationId);
      let result = await getCache(bulkStatusCacheKey);

      if (!result) {
        const activeSession = await resolveActiveSessionForShop(session, shop);
        result = await getBulkEditStatus(latestSync.bulkOperationId, activeSession);
        if (isActiveBulkOperation(result)) {
          await setCache(bulkStatusCacheKey, result, BULK_STATUS_CACHE_TTL_SECONDS);
        } else {
          await clearKeyCaches(bulkStatusCacheKey);
        }
      }

      const shopifyBulkProgress = Number(result?.rootObjectCount || 0);
      if (isActiveBulkOperation(result)) {
        await prisma.$transaction([
          prisma.syncHistory.updateMany({
            where: {
              shop,
              bulkOperationId: latestSync.bulkOperationId,
              status: "processing",
            },
            data: {
              lastHeartbeatAt: new Date(),
              executionState: "awaiting_shopify",
            },
          }),
          prisma.store.updateMany({
            where: {
              shopUrl: shop,
              syncProgressStage: "SHOPIFY_BULK_RUNNING",
            },
            data: {
              syncLeaseExpiresAt: new Date(Date.now() + SYNC_LEASE_TTL_MS),
            },
          }),
        ]);
      }

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
      !authoritativeSyncRunning
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
