// helpers/webhookHelpers/bulkOperations/productTypeSync.js
// (or keep your existing path and filename)

import shopify from "../../../shopify.js";
// getIndianStyleDuration is no longer used for writing to DB (SyncHistory.duration is Int)
// but you can still use it at read-time in controllers if you want pretty strings.
import { getIndianStyleDuration } from "../../../utils/timeStringConverter.js";
import axios from "axios";
import readline from "readline";
import fs from "fs";

import { getSession } from "../../../utils/sessionHandler.js";
import { Services } from "../../../services/productService/productFilterService.js";
import CacheService from "../../../utils/cacheService.js";
import { emitToUser } from "../../../socket.js";
import { clearKeyCaches } from "../../../utils/cacheUtils.js";

import { PrismaClient } from "../../../generated/prisma/index.js";

const prisma = new PrismaClient();

/* ────────────────────────────────────────────────────────────── */
/*  MAIN ENTRY: handleSyncOperation                              */
/* ────────────────────────────────────────────────────────────── */

export async function handleSyncOperation(bulkOperationId) {
  let syncHistory = null;

  try {
    syncHistory = await prisma.syncHistory.findFirst({
      where: { bulkOperationId },
    });

    if (!syncHistory) {
      return;
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
        `Bulk operation failed in Shopify. status=${bulkOperation.status} errorCode=${bulkOperation.errorCode}`
      );
    }

    if (bulkOperation.status !== "COMPLETED") {
      throw new Error(
        `Bulk operation is not completed yet. status=${bulkOperation.status}`
      );
    }

    if (!bulkOperation.url || typeof bulkOperation.url !== "string") {
      throw new Error(
        `Bulk operation completed but result URL is missing. status=${bulkOperation.status}`
      );
    }

    const parsedUrl = new URL(bulkOperation.url);

    const urlResponse = await axios.get(parsedUrl.toString(), {
      headers: { Accept: "application/json" },
      responseType: "stream",
    });

    if (urlResponse.status !== 200) {
      throw new Error(`Failed to download bulk result. status=${urlResponse.status}`);
    }

    if (syncHistory.operationType === "Collection") {
      await processSyncDataInBatches(urlResponse.data, session.shop, "Collection");

      recordCount = await prisma.collection.count({
        where: { shop: session.shop },
      });

      await prisma.store.update({
        where: { shopUrl: session.shop },
        data: {
          isCollectionSyncing: false,
          lastCollectionSyncAt: new Date(),
        },
      });

      await clearKeyCaches(`${session.shop}:sync_details`);
    }

    if (syncHistory.operationType === "Product") {
      await prisma.store.update({
        where: { shopUrl: session.shop },
        data: {
          shopifyBulkJobCompleted: true,
        },
      });

      const service = new Services();

      const syncResult = await service.formatAndSyncProductsToDB({
        dataStream: urlResponse.data,
        shop: session.shop,
        session: session,
        replaceShopData: true,
      });

      recordCount = syncResult.totalProductsProcessed || 0;

      await clearKeyCaches(`${session.shop}:ProductFetch:`);
      await clearKeyCaches(`${session.shop}:productTypes:`);

      await prisma.store.update({
        where: { shopUrl: session.shop },
        data: {
          isProductSyncing: false,
          lastProductSyncAt: new Date(),
          isProductInitialySyning: false,
          storeTotalProducts: syncResult.totalProductsProcessed || 0,
        },
      });

      emitToUser(session.shop, "product_sync", {
        message: "Product sync completed",
        totalProductsProcessed: syncResult.totalProductsProcessed || 0,
        totalVariantsProcessed: syncResult.totalVariantsProcessed || 0,
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
        },
      }).catch(() => { });
    }

    if (syncHistory?.shop) {
      await prisma.store.update({
        where: { shopUrl: syncHistory.shop },
        data: {
          isProductSyncing: false,
          isCollectionSyncing: false,
          isProductTypeSyncing: false,
          isProductInitialySyning: false,
        },
      }).catch(() => { });
    }

    throw err;
  }
}

/* ────────────────────────────────────────────────────────────── */
/*  BULK OP METADATA FETCH                                       */
/* ────────────────────────────────────────────────────────────── */

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

/* ────────────────────────────────────────────────────────────── */
/*  STREAMED COLLECTION / PRODUCT-TYPE SYNC                      */
/* ────────────────────────────────────────────────────────────── */

export async function processSyncDataInBatches(dataStream, shop, type) {
  try {
    const BATCH_SIZE = 100;
    let batch = [];

    // 🔹 Delete existing data first (Collections only)
    if (type === "Collection") {
      await prisma.collection.deleteMany({
        where: { shop },
      });
    }

    const insertBatch = async () => {
      if (batch.length === 0) return;

      if (type === "Collection") {
        const seen = new Set();
        const uniqueCollections = batch.filter((c) => {
          if (!c.title) return false;
          const key = c.title.trim().toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        // Mongo version used updateOne + upsert on { shop, title }.
        // In Prisma schema, we only have unique id, so we emulate upsert
        // with findFirst + update/create.
        for (const col of uniqueCollections) {
          const existing = await prisma.collection.findFirst({
            where: {
              shop,
              title: col.title,
            },
          });

          if (existing) {
            await prisma.collection.update({
              where: { id: existing.id },
              data: {
                shop,
                shopifyId: col.shopifyId,
                title: col.title,
                // keep handle as-is or null; adjust if you start syncing handle
                handle: existing.handle ?? null,
                updatedAt: new Date(),
              },
            });
          } else {
            await prisma.collection.create({
              data: {
                shop,
                shopifyId: col.shopifyId,
                title: col.title,
                handle: null,
              },
            });
          }
        }
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

        if (type === "Product Type" && json.productType) {
          // You don't yet have a ProductType model in Prisma schema,
          // so we just accumulate or you can hook this up later.
          batch.push(json.productType);
        } else if (type === "Collection") {
          batch.push({
            shopifyId: json.id,
            title: json.title?.trim(),
            shop,
          });
        }

        if (batch.length >= BATCH_SIZE) {
          rl.pause();
          await insertBatch();
          rl.resume();
        }
      } catch (err) {
        const syncFieldName =
          type === "Product Type"
            ? "isProductTypeSyncing"
            : type === "Collection"
              ? "isCollectionSyncing"
              : "isProductSyncing";

        // Set the appropriate boolean sync flag to false on Store
        try {
          await prisma.store.update({
            where: { shopUrl: shop },
            data: {
              [syncFieldName]: false,
            },
          });
        } catch (e) {
          // If store not found, just swallow; this is an error-path anyway
          console.error(
            `Failed to flip sync flag ${syncFieldName} for shop ${shop}:`,
            e.message,
          );
        }
      }
    });

    return new Promise((resolve, reject) => {
      rl.on("close", async () => {
        try {
          await insertBatch(); // insert remaining items
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      rl.on("error", reject);
    });
  } catch (err) {
    throw err;
  }
}

/* ────────────────────────────────────────────────────────────── */
/*  PRODUCT-TYPE SYNC FIELDS UPDATE (Prisma)                     */
/* ────────────────────────────────────────────────────────────── */

async function updateSyncFields(shop, bulkOperation, recordCount) {
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