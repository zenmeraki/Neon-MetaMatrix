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

  rl.on("line", async (line) => {
    if (!line.trim()) return;

    try {
      const json = JSON.parse(line);

      if (type === "Collection") {
        batch.push({
          shopifyId: json.id,
          title: json.title?.trim(),
        });
      }

      if (batch.length >= batchSize) {
        rl.pause();
        await insertBatch();
        rl.resume();
      }
    } catch (error) {
      await recordMirrorAnomaly({
        shop,
        severity: "medium",
        type: "sync_stream_parse_error",
        entityType: "store",
        entityId: shop,
        message: error.message,
        details: { type },
      }).catch(() => {});
    }
  });

  return new Promise((resolve, reject) => {
    rl.on("close", async () => {
      try {
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

        resolve();
      } catch (error) {
        reject(error);
      }
    });

    rl.on("error", reject);
  });
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
