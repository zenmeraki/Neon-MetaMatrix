import { randomUUID } from "node:crypto";

import { Services } from "../services/productService/productFilterService.js";
import {
  getBulkEditStatus,
  getCurrentBulkOperationStatus,
} from "../utils/bulkOperationHelper.js";
import {
  setCache,
  getCache,
  clearKeyCaches,
  getRedisClient,
} from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import logger from "../utils/loggerUtils.js";
import { createSyncSocketToken, SYNC_SOCKET_TOKEN_TTL_SECONDS } from "../utils/syncSocketAuth.js";
import { emitSyncStateChanged } from "../utils/syncRealtime.js";
import { prisma } from "../config/database.js";

const service = new Services();

const SYNC_STATUS_CACHE_PREFIX = "sync_details";
const PROGRESS_CACHE_PREFIX = "sync_progress";
const BULK_STATUS_CACHE_PREFIX = "shopify_bulk_status";
const START_LOCK_PREFIX = "sync_start_lock";

const ACTIVE_SYNC_STATUS_TTL_SECONDS = 5;
const IDLE_SYNC_STATUS_TTL_SECONDS = 30;
const BULK_STATUS_TTL_SECONDS = 5;
const START_LOCK_TTL_SECONDS = 45;
const SHOPIFY_STATUS_TIMEOUT_MS = 8000;
const STUCK_SYNC_THRESHOLD_MS = 15 * 60 * 1000;
const DEFAULT_ACTIVE_POLL_AFTER_MS = 5000;
const DEFAULT_IDLE_POLL_AFTER_MS = 15000;

const syncStatusInflight = new Map();
const progressInflight = new Map();
const bulkStatusInflight = new Map();

function createRequestContext(req, res, source) {
  return {
    source,
    requestId: req.headers["x-request-id"] || randomUUID(),
    session: res.locals.shopify?.session || null,
  };
}

function getAuthenticatedShopOrThrow(context) {
  const shop = context.session?.shop;

  if (!shop) {
    const error = new Error("Unauthorized");
    error.httpStatus = 401;
    throw error;
  }

  return shop;
}

function getCacheKey(prefix, shop) {
  return `${shop}:${prefix}`;
}

function normalizeBooleanFlag(value) {
  return value === true;
}

function isStoreSyncActive(store) {
  return (
    normalizeBooleanFlag(store?.isProductSyncing) ||
    normalizeBooleanFlag(store?.isProductInitialySyning)
  );
}

function isStoreSyncStale(store) {
  if (!isStoreSyncActive(store) || !store?.updatedAt) {
    return false;
  }

  return Date.now() - new Date(store.updatedAt).getTime() > STUCK_SYNC_THRESHOLD_MS;
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error(`${label} timed out`);
        error.code = "SYNC_TIMEOUT";
        reject(error);
      }, timeoutMs);
    }),
  ]);
}

async function withSingleFlight(map, key, work) {
  if (map.has(key)) {
    return map.get(key);
  }

  const pending = (async () => work())().finally(() => {
    map.delete(key);
  });

  map.set(key, pending);
  return pending;
}

async function acquireStartLock(shop, requestId) {
  const redis = getRedisClient();
  const key = getCacheKey(START_LOCK_PREFIX, shop);
  const token = `${requestId}:${randomUUID()}`;
  const result = await redis.set(key, token, {
    NX: true,
    EX: START_LOCK_TTL_SECONDS,
  });

  return {
    acquired: result === "OK",
    key,
    token,
  };
}

async function releaseStartLock(lock) {
  if (!lock?.acquired) {
    return;
  }

  try {
    const redis = getRedisClient();
    const currentToken = await redis.get(lock.key);

    if (currentToken === lock.token) {
      await redis.del(lock.key);
    }
  } catch (error) {
    logger.warn("Failed to release sync start lock", {
      lockKey: lock?.key,
      error: error.message,
    });
  }
}

async function safeGetCurrentBulkOperationStatus(session, type, meta) {
  return withSingleFlight(
    bulkStatusInflight,
    `${session.shop}:current:${type}`,
    async () => {
      const cacheKey = getCacheKey(
        `${BULK_STATUS_CACHE_PREFIX}:current:${type}`,
        session.shop,
      );
      const cached = await getCache(cacheKey);

      if (cached) {
        return cached;
      }

      const result = await withTimeout(
        getCurrentBulkOperationStatus(session, type),
        SHOPIFY_STATUS_TIMEOUT_MS,
        "Shopify current bulk operation status",
      );

      await setCache(cacheKey, result, BULK_STATUS_TTL_SECONDS);
      logger.debug("Fetched current Shopify bulk operation status", meta);
      return result;
    },
  );
}

async function safeGetBulkOperationStatus(bulkOperationId, session, meta) {
  return withSingleFlight(
    bulkStatusInflight,
    `${session.shop}:bulk:${bulkOperationId}`,
    async () => {
      const cacheKey = getCacheKey(
        `${BULK_STATUS_CACHE_PREFIX}:${bulkOperationId}`,
        session.shop,
      );
      const cached = await getCache(cacheKey);

      if (cached) {
        return cached;
      }

      const result = await withTimeout(
        getBulkEditStatus(bulkOperationId, session),
        SHOPIFY_STATUS_TIMEOUT_MS,
        "Shopify bulk operation progress",
      );

      await setCache(cacheKey, result, BULK_STATUS_TTL_SECONDS);
      logger.debug("Fetched Shopify bulk operation progress", {
        ...meta,
        bulkOperationId,
      });
      return result;
    },
  );
}

async function getStoreSyncState(shop) {
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
      updatedAt: true,
    },
  });
}

async function getLatestInitialSyncHistory(shop) {
  return prisma.syncHistory.findFirst({
    where: {
      shop,
      operationType: "Product",
      isInitialProductSync: true,
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      syncBatchId: true,
      bulkOperationId: true,
      status: true,
      stage: true,
      createdAt: true,
      updatedAt: true,
      recordCount: true,
    },
  });
}

async function getLatestCompletedSync(shop) {
  return prisma.syncHistory.findFirst({
    where: {
      shop,
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
  });
}

function buildDerivedSyncState({ store, syncHistory, currentBulkOperation }) {
  const syncing = isStoreSyncActive(store);
  const currentBulkStatus = currentBulkOperation?.status || null;
  const latestHistoryStatus = syncHistory?.status || null;
  const latestHistoryStage = syncHistory?.stage || null;
  const stale = isStoreSyncStale(store);

  if (syncing && stale && currentBulkStatus !== "RUNNING") {
    return {
      status: "stuck",
      stage: latestHistoryStage || store?.syncProgressStage || "RECOVERY_REQUIRED",
      needsAttention: true,
      pollAfterMs: DEFAULT_IDLE_POLL_AFTER_MS,
    };
  }

  if (syncing && currentBulkStatus === "RUNNING") {
    return {
      status: "syncing",
      stage: store?.syncProgressStage || latestHistoryStage || "SHOPIFY_BULK_RUNNING",
      needsAttention: false,
      pollAfterMs: DEFAULT_ACTIVE_POLL_AFTER_MS,
    };
  }

  if (syncing) {
    return {
      status: "syncing",
      stage: store?.syncProgressStage || latestHistoryStage || "MIRROR_STAGING",
      needsAttention: false,
      pollAfterMs: DEFAULT_ACTIVE_POLL_AFTER_MS,
    };
  }

  if (currentBulkStatus === "RUNNING" || latestHistoryStatus === "processing") {
    return {
      status: "recovering",
      stage: latestHistoryStage || store?.syncProgressStage || "SHOPIFY_BULK_RUNNING",
      needsAttention: true,
      pollAfterMs: DEFAULT_ACTIVE_POLL_AFTER_MS,
    };
  }

  return {
    status: "idle",
    stage: store?.syncProgressStage || "IDLE",
    needsAttention: false,
    pollAfterMs: DEFAULT_IDLE_POLL_AFTER_MS,
  };
}

async function buildSyncStatusPayload({ shop, session, requestId }) {
  const [store, syncHistory] = await Promise.all([
    getStoreSyncState(shop),
    getLatestInitialSyncHistory(shop),
  ]);

  if (!store) {
    return null;
  }

  let currentBulkOperation = null;

  if (isStoreSyncActive(store)) {
    try {
      currentBulkOperation = await safeGetCurrentBulkOperationStatus(session, "QUERY", {
        requestId,
        shop,
      });
    } catch (error) {
      logger.warn("Failed to fetch Shopify current bulk operation status", {
        requestId,
        shop,
        error: error.message,
      });
    }
  }

  const derivedState = buildDerivedSyncState({
    store,
    syncHistory,
    currentBulkOperation,
  });

  return {
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
    currentBulkOperationId: currentBulkOperation?.id || syncHistory?.bulkOperationId || null,
    syncBatchId: syncHistory?.syncBatchId || null,
    latestSyncHistoryId: syncHistory?.id || null,
    derivedStatus: derivedState.status,
    derivedStage: derivedState.stage,
    needsAttention: derivedState.needsAttention,
    pollAfterMs: derivedState.pollAfterMs,
    staleCacheWindowSeconds:
      derivedState.status === "idle"
        ? IDLE_SYNC_STATUS_TTL_SECONDS
        : ACTIVE_SYNC_STATUS_TTL_SECONDS,
  };
}

function getSyncStatusTtl(syncDetails) {
  return syncDetails?.derivedStatus === "idle"
    ? IDLE_SYNC_STATUS_TTL_SECONDS
    : ACTIVE_SYNC_STATUS_TTL_SECONDS;
}

function buildTrackResponse({
  shop,
  requestId,
  store,
  syncHistory,
  status,
  stage,
  message,
  processedProducts,
  progress,
  bulkOperationId = null,
  syncBatchId = null,
  needsAttention = false,
  pollAfterMs = DEFAULT_ACTIVE_POLL_AFTER_MS,
}) {
  const totalProducts = store?.storeTotalProducts || 0;

  return {
    success: true,
    shop,
    requestId,
    status,
    stage,
    message,
    totalProducts,
    processedProducts,
    progress,
    bulkOperationId: bulkOperationId || syncHistory?.bulkOperationId || null,
    syncBatchId: syncBatchId || syncHistory?.syncBatchId || null,
    needsAttention,
    pollAfterMs,
  };
}

async function getProgressPayload({ shop, session, requestId }) {
  const [store, syncHistory] = await Promise.all([
    getStoreSyncState(shop),
    getLatestInitialSyncHistory(shop),
  ]);

  if (!store) {
    return null;
  }

  const totalProducts = store.storeTotalProducts || 0;
  const defaultStage = store.syncProgressStage || syncHistory?.stage || "IDLE";

  if (!isStoreSyncActive(store)) {
    return buildTrackResponse({
      shop,
      requestId,
      store,
      syncHistory,
      status: "completed",
      stage: defaultStage,
      message: "Product syncing completed.",
      processedProducts: totalProducts,
      progress: totalProducts > 0 ? 100 : 0,
      pollAfterMs: DEFAULT_IDLE_POLL_AFTER_MS,
    });
  }

  if (!store.shopifyBulkJobCompleted && syncHistory?.bulkOperationId) {
    try {
      const bulkStatus = await safeGetBulkOperationStatus(
        syncHistory.bulkOperationId,
        session,
        { requestId, shop, syncBatchId: syncHistory.syncBatchId },
      );

      const processedProducts = Number(
        bulkStatus?.rootObjectCount || bulkStatus?.objectCount || 0,
      );
      const progress =
        totalProducts > 0
          ? Math.min(
              Number(((processedProducts / totalProducts) * 100).toFixed(2)),
              100,
            )
          : 0;

      return buildTrackResponse({
        shop,
        requestId,
        store,
        syncHistory,
        status: bulkStatus?.status === "RUNNING" ? "syncing" : "reconciling",
        stage: store.syncProgressStage || "SHOPIFY_BULK_RUNNING",
        message: "Product sync in progress...",
        processedProducts,
        progress,
      });
    } catch (error) {
      logger.warn("Failed to fetch bulk operation progress for product sync", {
        requestId,
        shop,
        bulkOperationId: syncHistory.bulkOperationId,
        syncBatchId: syncHistory.syncBatchId,
        error: error.message,
      });
    }
  }

  if (isStoreSyncStale(store)) {
    return buildTrackResponse({
      shop,
      requestId,
      store,
      syncHistory,
      status: "stuck",
      stage: defaultStage,
      message: "Product sync appears stuck and may require recovery.",
      processedProducts: store.productInitialSyncProgress || 0,
      progress:
        totalProducts > 0
          ? Math.min(
              Number(
                (((store.productInitialSyncProgress || 0) / totalProducts) * 100).toFixed(2),
              ),
              100,
            )
          : 0,
      needsAttention: true,
      pollAfterMs: DEFAULT_IDLE_POLL_AFTER_MS,
    });
  }

  const processedProducts = store.productInitialSyncProgress || 0;
  const progress =
    totalProducts > 0
      ? Math.min(
          Number(((processedProducts / totalProducts) * 100).toFixed(2)),
          100,
        )
      : 0;

  return buildTrackResponse({
    shop,
    requestId,
    store,
    syncHistory,
    status: "syncing",
    stage: defaultStage || "MIRROR_STAGING",
    message: "Product sync in progress...",
    processedProducts,
    progress,
  });
}

async function handleControllerError({ context, req, res, error, defaultMessage }) {
  const shop = context.session?.shop || null;

  await logApiError({
    shop,
    err: error,
    req,
    source: context.source,
  });

  logger.error(defaultMessage, {
    requestId: context.requestId,
    shop,
    source: context.source,
    error: error.message,
  });

  return res.status(error.httpStatus || 500).json({
    success: false,
    requestId: context.requestId,
    error: defaultMessage,
  });
}

export const syncProductData = async (req, res) => {
  const context = createRequestContext(req, res, "syncController.syncProductData");

  try {
    const shop = getAuthenticatedShopOrThrow(context);
    const force =
      String(req.query.force || req.body?.force || "")
        .trim()
        .toLowerCase() === "true";

    const lock = await acquireStartLock(shop, context.requestId);

    if (!lock.acquired) {
      return res.status(409).json({
        success: false,
        requestId: context.requestId,
        message: "A sync start is already in progress for this shop.",
        status: "conflict",
      });
    }

    try {
      const store = await getStoreSyncState(shop);

      if (!store) {
        return res.status(404).json({
          success: false,
          requestId: context.requestId,
          error: "Store not found",
        });
      }

      const currentBulkOperation = await safeGetCurrentBulkOperationStatus(
        context.session,
        "QUERY",
        {
          requestId: context.requestId,
          shop,
        },
      );

      if (currentBulkOperation?.status === "RUNNING" || isStoreSyncActive(store)) {
        return res.status(409).json({
          success: false,
          requestId: context.requestId,
          message: "Another sync is already running in the background.",
          status: "conflict",
          bulkOperationId: currentBulkOperation?.id || null,
        });
      }

      const alreadySynced =
        store.isProductSyncing === false &&
        store.isProductInitialySyning === false &&
        store.shopifyBulkJobCompleted === true &&
        Number(store.storeTotalProducts || 0) > 0;

      if (alreadySynced && !force) {
        const latestCompletedSync = await getLatestCompletedSync(shop);

        return res.status(200).json({
          success: true,
          requestId: context.requestId,
          message: "Products already synced. Skipping new sync.",
          skipped: true,
          forceAllowed: true,
          data: {
            productCount: Number(store.storeTotalProducts || 0),
            storeTotalProducts: store.storeTotalProducts,
            lastProductSyncAt: store.lastProductSyncAt,
            lastCompletedSyncAt: latestCompletedSync?.updatedAt || null,
            lastCompletedRecordCount: latestCompletedSync?.recordCount || null,
            lastCompletedSyncBatchId: latestCompletedSync?.syncBatchId || null,
          },
        });
      }

      const result = await service.startBulkOperationToFetchProducts({
        session: context.session,
      });

      await Promise.all([
        clearKeyCaches(getCacheKey(SYNC_STATUS_CACHE_PREFIX, shop)),
        clearKeyCaches(getCacheKey(PROGRESS_CACHE_PREFIX, shop)),
      ]);

      logger.info("Started product sync", {
        requestId: context.requestId,
        shop,
        bulkOperationId: result.bulkOperationId,
        syncBatchId: result.syncBatchId,
      });

      emitSyncStateChanged({
        shop,
        scope: "product",
        eventType: "started",
        syncBatchId: result.syncBatchId,
        bulkOperationId: result.bulkOperationId,
        syncHistoryId: result.syncHistoryId,
        stage: "SHOPIFY_BULK_RUNNING",
        status: "syncing",
      });

      return res.status(200).json({
        success: true,
        requestId: context.requestId,
        ...result,
        skipped: false,
        forced: force,
      });
    } finally {
      await releaseStartLock(lock);
    }
  } catch (error) {
    return handleControllerError({
      context,
      req,
      res,
      error,
      defaultMessage: "Failed to start product sync",
    });
  }
};

export const getSyncSocketAuth = async (req, res) => {
  const context = createRequestContext(req, res, "syncController.getSyncSocketAuth");

  try {
    const shop = getAuthenticatedShopOrThrow(context);
    const token = createSyncSocketToken({ shop });

    return res.status(200).json({
      success: true,
      requestId: context.requestId,
      shop,
      token,
      expiresInSeconds: SYNC_SOCKET_TOKEN_TTL_SECONDS,
    });
  } catch (error) {
    return handleControllerError({
      context,
      req,
      res,
      error,
      defaultMessage: "Failed to authorize sync realtime connection",
    });
  }
};

export const getSyncStatus = async (req, res) => {
  const context = createRequestContext(req, res, "syncController.getSyncStatus");

  try {
    const shop = getAuthenticatedShopOrThrow(context);
    const cacheKey = getCacheKey(SYNC_STATUS_CACHE_PREFIX, shop);

    let syncDetails = await getCache(cacheKey);

    if (!syncDetails) {
      syncDetails = await withSingleFlight(syncStatusInflight, cacheKey, async () => {
        const fresh = await buildSyncStatusPayload({
          shop,
          session: context.session,
          requestId: context.requestId,
        });

        if (!fresh) {
          return null;
        }

        await setCache(cacheKey, fresh, getSyncStatusTtl(fresh));
        return fresh;
      });
    }

    if (!syncDetails) {
      return res.status(404).json({
        success: false,
        requestId: context.requestId,
        error: "Store not found",
      });
    }

    return res.status(200).json({
      success: true,
      requestId: context.requestId,
      shop,
      syncStatus: syncDetails,
    });
  } catch (error) {
    return handleControllerError({
      context,
      req,
      res,
      error,
      defaultMessage: "Failed to fetch sync status",
    });
  }
};

export const trackProductSync = async (req, res) => {
  const context = createRequestContext(req, res, "syncController.trackProductSync");

  try {
    const shop = getAuthenticatedShopOrThrow(context);
    const cacheKey = getCacheKey(PROGRESS_CACHE_PREFIX, shop);

    let payload = await getCache(cacheKey);

    if (!payload) {
      payload = await withSingleFlight(progressInflight, cacheKey, async () => {
        const fresh = await getProgressPayload({
          shop,
          session: context.session,
          requestId: context.requestId,
        });

        if (!fresh) {
          return null;
        }

        const ttl =
          fresh.status === "completed"
            ? IDLE_SYNC_STATUS_TTL_SECONDS
            : ACTIVE_SYNC_STATUS_TTL_SECONDS;

        await setCache(cacheKey, fresh, ttl);
        return fresh;
      });
    }

    if (!payload) {
      return res.status(404).json({
        success: false,
        requestId: context.requestId,
        error: "Store not found",
      });
    }

    return res.status(200).json(payload);
  } catch (error) {
    return handleControllerError({
      context,
      req,
      res,
      error,
      defaultMessage: "Failed to track product sync",
    });
  }
};
