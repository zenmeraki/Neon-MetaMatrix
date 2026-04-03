import shopify from "../../../shopify.js";
import axios from "axios";
import readline from "readline";
import { getSession } from "../../../utils/sessionHandler.js";
import { Services } from "../../../services/productService/productFilterService.js";
import CacheService from "../../../utils/cacheService.js";
import { emitToUser } from "../../../socket.js";
import { clearKeyCaches } from "../../../utils/cacheUtils.js";
import { enqueueAutomaticProductRuleSignalJob } from "../../../services/automaticProductRuleExecutionService.js";
import { prisma } from "../../../config/database.js";
import {
  createMirrorBatchId,
  markFullSyncFailed,
} from "../../../services/mirrorHealthService.js";
import { recordMirrorAnomaly } from "../../../services/mirrorAnomalyService.js";
import { withAdvisoryLock } from "../../../utils/idempotencyUtils.js";
import {
  markSyncExecutionFailed,
  SYNC_EXECUTION_STATES,
  updateSyncExecutionState,
} from "../../../services/syncExecutionStateService.js";

const STALE_FINALIZATION_MS = 20 * 60 * 1000;

async function claimSyncFinalization(syncHistoryId, shop) {
  const history = await prisma.syncHistory.findUnique({
    where: { id: syncHistoryId },
    select: {
      id: true,
      shop: true,
      status: true,
      stage: true,
      updatedAt: true,
      operationType: true,
      syncBatchId: true,
    },
  });

  if (!history) {
    return { state: "missing", history: null };
  }

  if (history.shop !== shop) {
    throw new Error("Cross-shop sync finalization blocked");
  }

  if (history.status === "completed") {
    return { state: "completed", history };
  }

  if (history.stage === "FINALIZING") {
    const updatedAt = history.updatedAt ? new Date(history.updatedAt).getTime() : 0;
    const isStale = updatedAt > 0 && Date.now() - updatedAt > STALE_FINALIZATION_MS;
    if (!isStale) {
      return { state: "already_finalizing", history };
    }
  }

    const updated = await prisma.syncHistory.updateMany({
      where: {
        id: syncHistoryId,
        shop,
        status: "processing",
    },
    data: {
      stage: "FINALIZING",
    },
  });

    if (!updated.count) {
      return { state: "not_claimed", history };
    }

    await updateSyncExecutionState({
      syncHistoryId,
      shop,
      state: SYNC_EXECUTION_STATES.FINALIZING,
      stage: "FINALIZING",
    });

    return {
      state: "claimed",
    history: await prisma.syncHistory.findUnique({
      where: { id: syncHistoryId },
    }),
  };
}

export async function handleSyncOperation({ bulkOperationId, shop = null }) {
  let syncHistory = null;

  try {
    syncHistory = await prisma.syncHistory.findFirst({
      where: {
        bulkOperationId,
        ...(shop ? { shop } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    if (!syncHistory) {
      return;
    }

    const { locked, result: claim } = await withAdvisoryLock(
      `sync-finalize:${syncHistory.id}`,
      async () => claimSyncFinalization(syncHistory.id, syncHistory.shop),
    );

    if (!locked) {
      return { skipped: true, reason: "finalization_lock_busy" };
    }

    if (!claim || ["completed", "already_finalizing", "not_claimed", "missing"].includes(claim.state)) {
      return { skipped: true, reason: claim?.state || "claim_unavailable" };
    }

    syncHistory = claim.history;

    if (syncHistory.operationType === "Product" && !syncHistory.syncBatchId) {
      const syncBatchId = createMirrorBatchId("product_sync");

      syncHistory = await prisma.syncHistory.update({
        where: { id: syncHistory.id },
        data: { syncBatchId },
      });
    }

    let recordCount = 0;
    const session = await getSession(syncHistory.shop);
    if (!session) {
      throw new Error(`No session found for shop ${syncHistory.shop}`);
    }

    const bulkOperation = await fetchBulkOperationDetails(session, bulkOperationId);
    if (!bulkOperation) {
      throw new Error("Failed to retrieve bulk operation details");
    }

    if (bulkOperation.errorCode) {
      throw new Error(
        `Bulk operation failed in Shopify. status=${bulkOperation.status} errorCode=${bulkOperation.errorCode}`,
      );
    }

    if (bulkOperation.status !== "COMPLETED") {
      throw new Error(
        `Bulk operation is not completed yet. status=${bulkOperation.status}`,
      );
    }

    if (!bulkOperation.url || typeof bulkOperation.url !== "string") {
      throw new Error(
        `Bulk operation completed but result URL is missing. status=${bulkOperation.status}`,
      );
    }

    const urlResponse = await axios.get(new URL(bulkOperation.url).toString(), {
      headers: { Accept: "application/json" },
      responseType: "stream",
    });

    if (urlResponse.status !== 200) {
      throw new Error(`Failed to download bulk result. status=${urlResponse.status}`);
    }

    if (syncHistory.operationType === "Collection") {
      await processSyncDataInBatches(
        urlResponse.data,
        session.shop,
        "Collection",
        syncHistory.syncBatchId,
      );

      recordCount = await prisma.collection.count({
        where: {
          shop: session.shop,
          ...(syncHistory.syncBatchId ? { mirrorBatchId: syncHistory.syncBatchId } : {}),
        },
      });

      await prisma.store.update({
        where: { shopUrl: session.shop },
        data: {
          isCollectionSyncing: false,
          lastCollectionSyncAt: new Date(),
          activeCollectionBatchId: syncHistory.syncBatchId,
          lastCollectionReconcileAt: new Date(),
          lastReconcileAt: new Date(),
          mirrorHealthState: "HEALTHY",
          staleReason: null,
          repairRequired: false,
        },
      });

      await clearKeyCaches(`${session.shop}:sync_details`);
      await clearKeyCaches(`${session.shop}:fetchCollections`);
      await clearKeyCaches(`${session.shop}:ProductFilterValues:collection`);
    }

    if (syncHistory.operationType === "Product") {
      const service = new Services();
      const syncResult = await service.formatAndSyncProductsToDB({
        dataStream: urlResponse.data,
        shop: session.shop,
        session,
        syncBatchId: syncHistory.syncBatchId,
        syncHistoryId: syncHistory.id,
      });

      recordCount = syncResult.totalProductsProcessed || 0;

      await clearKeyCaches(`${session.shop}:ProductFetch:`);
      await clearKeyCaches(`${session.shop}:productTypes:`);
      await clearKeyCaches(`${session.shop}:ProductFilterValues:`);

      await prisma.store.update({
        where: { shopUrl: session.shop },
        data: {
          lastProductSyncAt: new Date(),
        },
      });

      emitToUser(session.shop, "product_sync", {
        message: "Product sync completed",
        totalProductsProcessed: syncResult.totalProductsProcessed || 0,
        totalVariantsProcessed: syncResult.totalVariantsProcessed || 0,
      });

      await enqueueAutomaticProductRuleSignalJob({
        shop: session.shop,
        triggerReference: `reindex:${bulkOperationId}`,
        triggerSource: "REINDEX",
      });
    }

    await clearKeyCaches(`${session.shop}:storeDetails`);
    await clearKeyCaches(`${session.shop}:ProductFetch`);
    await clearKeyCaches(`${session.shop}:sync_details`);

    const createdAt = bulkOperation.createdAt
      ? new Date(bulkOperation.createdAt)
      : new Date();
    const completedAt = bulkOperation.completedAt
      ? new Date(bulkOperation.completedAt)
      : new Date();
    const durationMs = Math.max(completedAt.getTime() - createdAt.getTime(), 0);

    await prisma.syncHistory.update({
      where: { id: syncHistory.id },
      data: {
        status: "completed",
        stage: "COMPLETED",
        responseUrl: bulkOperation.url,
        duration: durationMs,
        recordCount,
      },
    });

    await updateSyncExecutionState({
      syncHistoryId: syncHistory.id,
      shop: syncHistory.shop,
      state: SYNC_EXECUTION_STATES.COMPLETED,
      stage: "COMPLETED",
      completed: true,
    });

    return { message: "syncing completed" };
  } catch (err) {
    if (syncHistory) {
      await prisma.syncHistory.update({
        where: { id: syncHistory.id },
        data: {
          status: "failed",
          stage: "FAILED",
          errorSummary: err.message,
        },
      }).catch(() => {});
    }

    if (syncHistory?.shop) {
      await markSyncExecutionFailed({
        syncHistoryId: syncHistory.id,
        shop: syncHistory.shop,
        errorSummary: err.message,
      }).catch(() => {});

      await prisma.store.update({
        where: { shopUrl: syncHistory.shop },
        data: {
          isProductSyncing: false,
          isCollectionSyncing: false,
          isProductTypeSyncing: false,
          isProductInitialySyning: false,
          syncProgressStage: "IDLE",
        },
      }).catch(() => {});

      await markFullSyncFailed({
        shop: syncHistory.shop,
        errorSummary: err.message,
      }).catch(() => {});

      await recordMirrorAnomaly({
        shop: syncHistory.shop,
        severity: "critical",
        type: "bulk_sync_finalize_failure",
        entityType: "syncHistory",
        entityId: syncHistory.id,
        message: err.message,
        details: {
          bulkOperationId,
          operationType: syncHistory.operationType,
        },
      }).catch(() => {});
    }

    throw err;
  }
}

async function fetchBulkOperationDetails(session, bulkOperationId) {
  const query = `query GetBulkOperationResults($id: ID!) {
    node(id: $id) {
      ... on BulkOperation {
        id
        status
        errorCode
        url
        partialDataUrl
        objectCount
        rootObjectCount
        completedAt
        createdAt
        fileSize
        type
      }
    }
  }`;

  const client = new shopify.api.clients.Graphql({ session });
  const response = await client.query({
    data: {
      query,
      variables: { id: bulkOperationId },
    },
  });

  return response.body?.data?.node;
}

export async function processSyncDataInBatches(dataStream, shop, type, syncBatchId = null) {
  const batchSize = 100;
  let batch = [];
  let lineNumber = 0;

  const insertBatch = async () => {
    if (!batch.length) return;

    if (type === "Collection") {
      const seen = new Set();
      const uniqueCollections = batch.filter((collection) => {
        if (!collection.title || !collection.shopifyId) return false;
        const key = collection.shopifyId;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      await prisma.collection.createMany({
        data: uniqueCollections.map((collection) => ({
          shop,
          shopifyId: collection.shopifyId,
          mirrorBatchId: syncBatchId,
          title: collection.title,
          handle: null,
        })),
        skipDuplicates: true,
      });
    }

    batch = [];
  };

  const rl = readline.createInterface({
    input: dataStream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl) {
      lineNumber += 1;

      if (!line.trim()) {
        continue;
      }

      let json;
      try {
        json = JSON.parse(line);
      } catch (error) {
        await recordMirrorAnomaly({
          shop,
          severity: "high",
          type: "sync_stream_parse_error",
          entityType: "store",
          entityId: shop,
          message: error.message,
          details: { type, lineNumber },
        }).catch(() => {});

        throw new Error(
          `Collection sync JSONL parse failed at line ${lineNumber}: ${error.message}`,
        );
      }

      if (type === "Collection") {
        batch.push({
          shopifyId: json.id,
          title: json.title?.trim(),
        });
      }

      if (batch.length >= batchSize) {
        await insertBatch();
      }
    }

    await insertBatch();

    if (type === "Collection" && syncBatchId) {
      const store = await prisma.store.findUnique({
        where: { shopUrl: shop },
        select: { activeCollectionBatchId: true },
      });

      if (store?.activeCollectionBatchId && store.activeCollectionBatchId !== syncBatchId) {
        await prisma.collection.deleteMany({
          where: {
            shop,
            mirrorBatchId: store.activeCollectionBatchId,
          },
        });
      }
    }
  } finally {
    rl.close();
  }
}

async function updateSyncFields(shop) {
  const result = await prisma.store.update({
    where: { shopUrl: shop },
    data: {
      isProductTypeSyncing: false,
      lastProductTypeSyncAt: new Date(),
    },
  });

  if (!result) {
    throw new Error("Store document not found");
  }

  await CacheService.del(`${shop}:storeDetails`);
}
