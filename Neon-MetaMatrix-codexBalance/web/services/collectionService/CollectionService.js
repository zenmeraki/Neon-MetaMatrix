import promClient from "prom-client";
import { connection } from "../../Config/redis.js";
import { prisma } from "../../config/database.js";
import { collectionRepository } from "../../repositories/collectionRepository.js";
import { adminGraphqlWithRetry } from "../../utils/shopifyAdminApi.js";
import { clearKeyCaches, getCache, normalizeQuery, setCache } from "../../utils/cacheUtils.js";
import { createMirrorBatchId } from "../../utils/mirrorBatchIdUtils.js";
import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";
import logger from "../../utils/loggerUtils.js";

const COLLECTION_CACHE_TTL_SECONDS = 300;
const DEFAULT_COLLECTION_LIMIT = 20;
const MAX_COLLECTION_LIMIT = 100;
const COLLECTION_SYNC_LOCK_TTL_MS = 120_000;
const STALE_COLLECTION_SYNC_MS = 30 * 60 * 1000;

function getOrCreateMetric(name, factory) {
  return promClient.register.getSingleMetric(name) || factory();
}

export const metrics = {
  collectionFetchLatency: getOrCreateMetric(
    "collection_fetch_latency_seconds",
    () =>
      new promClient.Histogram({
        name: "collection_fetch_latency_seconds",
        help: "Time to fetch collections by source",
        buckets: [0.1, 0.3, 0.5, 1, 2, 5],
        labelNames: ["source"],
      }),
  ),
  cacheHits: getOrCreateMetric(
    "collection_cache_hit_total",
    () =>
      new promClient.Counter({
        name: "collection_cache_hit_total",
        help: "Cache hits by source",
        labelNames: ["source"],
      }),
  ),
  cacheMisses: getOrCreateMetric(
    "collection_cache_miss_total",
    () =>
      new promClient.Counter({
        name: "collection_cache_miss_total",
        help: "Cache misses total",
        labelNames: ["level"],
      }),
  ),
  syncJobs: getOrCreateMetric(
    "collection_sync_jobs_total",
    () =>
      new promClient.Counter({
        name: "collection_sync_jobs_total",
        help: "Total sync jobs by status",
        labelNames: ["status"],
      }),
  ),
};

const BULK_OPERATION_MUTATION = `mutation CollectionBulkSync {
  bulkOperationRunQuery(
    query: """
    {
      collections(first: 250) {
        edges {
          node {
            id
            title
            handle
            updatedAt
          }
        }
      }
    }
    """
  ) {
    bulkOperation {
      id
      status
    }
    userErrors {
      field
      message
    }
  }
}`;

function assertSessionShop(session) {
  const shop = session?.shop;

  if (typeof shop !== "string" || !shop.trim()) {
    throw new Error("shop is required");
  }

  return shop.trim();
}

function normalizeLimit(limit) {
  const parsed = Number.parseInt(limit, 10);

  if (!Number.isFinite(parsed)) return DEFAULT_COLLECTION_LIMIT;

  return Math.min(MAX_COLLECTION_LIMIT, Math.max(1, parsed));
}

function buildCollectionCacheKey({
  shop,
  collectionBatchId,
  productMirrorBatchId,
  search,
  cursorId,
  limit,
}) {
  return [
    shop,
    "fetchCollections",
    collectionBatchId,
    productMirrorBatchId,
    normalizeQuery(search),
    cursorId || "first",
    limit,
  ].join(":");
}

function formatUserErrors(userErrors = []) {
  return userErrors
    .map((item) => {
      const field = Array.isArray(item?.field) ? item.field.join(".") : item?.field;
      return [field, item?.message].filter(Boolean).join(": ");
    })
    .filter(Boolean)
    .join("; ");
}

async function acquireCollectionSyncLock(shop) {
  const lockKey = `lock:collection-sync:${shop}`;
  const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;

  try {
    const acquired = await connection.set(
      lockKey,
      token,
      "PX",
      COLLECTION_SYNC_LOCK_TTL_MS,
      "NX",
    );

    return {
      acquired: acquired === "OK",
      lockKey,
      token,
    };
  } catch (error) {
    logger.warn("Collection sync Redis lock unavailable", {
      shop,
      error: error.message,
    });

    return {
      acquired: true,
      lockKey: null,
      token: null,
    };
  }
}

async function releaseCollectionSyncLock({ lockKey, token }) {
  if (!lockKey || !token) return;

  try {
    const current = await connection.get(lockKey);

    if (current === token) {
      await connection.del(lockKey);
    }
  } catch (error) {
    logger.warn("Failed to release collection sync lock", {
      lockKey,
      error: error.message,
    });
  }
}

export class CollectionService {
  constructor(shopifyClient) {
    this.shopify = shopifyClient;
  }

  async fetchCollections(session, search = "", options = {}) {
    const shop = assertSessionShop(session);
    const normalizedSearch = normalizeQuery(search);
    const limit = normalizeLimit(options.limit);
    const cursorId = options.cursorId || null;
    const endTimer = metrics.collectionFetchLatency.startTimer({
      source: "database",
    });

    try {
      const snapshot = await collectionRepository.getActiveReadSnapshotForShop(
        shop,
        prisma,
      );
      const cacheKey = buildCollectionCacheKey({
        shop,
        collectionBatchId: snapshot.collectionBatchId,
        productMirrorBatchId: snapshot.productMirrorBatchId,
        search: normalizedSearch,
        cursorId,
        limit,
      });
      const cacheCollections = await getCache(cacheKey);

      if (cacheCollections) {
        const cachedData = Array.isArray(cacheCollections)
          ? cacheCollections
          : cacheCollections.data || [];
        metrics.cacheHits.labels("database").inc();
        return {
          message: "Collections from cache",
          data: cachedData,
          pageInfo: Array.isArray(cacheCollections)
            ? {
                hasNextPage: false,
                endCursor: cachedData.length
                  ? cachedData[cachedData.length - 1].id
                  : null,
              }
            : cacheCollections.pageInfo || null,
          snapshot,
        };
      }

      metrics.cacheMisses.labels("data").inc();

      const queryLimit = Math.min(limit + 1, MAX_COLLECTION_LIMIT);
      const records = await collectionRepository.listByShopAndSnapshot(
        {
          shop,
          collectionBatchId: snapshot.collectionBatchId,
          search: normalizedSearch,
          cursorId,
          limit: queryLimit,
        },
        prisma,
      );
      const hasNextPage = records.length > limit;
      const dbCollections = hasNextPage ? records.slice(0, limit) : records;
      const endCursor = dbCollections.length
        ? dbCollections[dbCollections.length - 1].id
        : null;

      await setCache(
        cacheKey,
        {
          data: dbCollections,
          pageInfo: {
            hasNextPage,
            endCursor,
          },
        },
        COLLECTION_CACHE_TTL_SECONDS,
      );

      return {
        message: "Collections from database",
        data: dbCollections,
        pageInfo: {
          hasNextPage,
          endCursor,
        },
        snapshot,
      };
    } finally {
      endTimer();
    }
  }

  async startCollectionSync(session) {
    const shop = assertSessionShop(session);
    const lock = await acquireCollectionSyncLock(shop);
    let syncHistoryId = null;
    let bulkOperationId = null;

    if (!lock.acquired) {
      throw new Error("Collection sync already in progress");
    }

    try {
      const currentBulkOperation = await getCurrentBulkOperationStatus(
        session,
        "QUERY",
      );

      if (currentBulkOperation?.status === "RUNNING") {
        throw new Error("Another Shopify query bulk operation is running");
      }

      const now = new Date();
      const syncBatchId = createMirrorBatchId("collection_sync");
      const staleBefore = new Date(now.getTime() - STALE_COLLECTION_SYNC_MS);
      const syncHistory = await collectionRepository.reserveCollectionSync(
        {
          shop,
          syncBatchId,
          now,
          staleBefore,
        },
        prisma,
      );

      syncHistoryId = syncHistory.id;
      metrics.syncJobs.labels("started").inc();

      const bulkResponse = await adminGraphqlWithRetry({
        session,
        shop,
        operationName: "collectionBulkSync",
        data: {
          query: BULK_OPERATION_MUTATION,
        },
      });

      const topLevelError = bulkResponse.body?.errors?.[0]?.message;
      if (topLevelError) {
        throw new Error(topLevelError);
      }

      const result = bulkResponse.body?.data?.bulkOperationRunQuery;
      const userErrors = result?.userErrors || [];

      if (userErrors.length) {
        throw new Error(formatUserErrors(userErrors));
      }

      bulkOperationId = result?.bulkOperation?.id;

      if (!bulkOperationId) {
        throw new Error("Shopify did not return a collection bulk operation id");
      }

      const updated = await collectionRepository.markCollectionSyncRunning(
        {
          shop,
          syncHistoryId,
          bulkOperationId,
        },
        prisma,
      );

      if (updated.count !== 1) {
        throw new Error("Collection sync tracking row was not updated");
      }

      await clearKeyCaches(`${shop}:fetchCollections`);
      await clearKeyCaches(`${shop}:sync_details`);
      metrics.syncJobs.labels("running").inc();

      return {
        message: "Collections syncing started",
        operationId: bulkOperationId,
        syncBatchId,
        syncHistoryId,
      };
    } catch (error) {
      metrics.syncJobs.labels("failed").inc();

      if (syncHistoryId && !bulkOperationId) {
        await collectionRepository.markCollectionSyncStartFailed(
          {
            shop,
            syncHistoryId,
            errorMessage: error.message,
          },
          prisma,
        );
      }

      logger.error("Failed to start collection sync", {
        shop,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    } finally {
      await releaseCollectionSyncLock(lock);
    }
  }

  async clearCollections(session) {
    return this.startCollectionSync(session);
  }
}
