import axios from "axios";
import readline from "readline";
import { prisma } from "../../config/database.js";
import { getSession } from "../../utils/sessionHandler.js";
import { getBulkEditStatus } from "../../utils/bulkOperationHelper.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { emitToUser } from "../../socket.js";
import { recordMirrorAnomaly } from "../mirrorAnomalyService.js";
import { markFullSyncFailed } from "../mirrorHealthService.js";
import { enqueueAutomaticProductRuleSignalJob } from "../automaticProductRuleExecutionService.js";
import { enqueueMirrorSnapshotCleanupJob } from "../../Jobs/Queues/mirrorSnapshotCleanupQueue.js";
import { mirrorSnapshotCleanupService } from "./mirrorSnapshotCleanupService.js";

const PRODUCT_BATCH_SIZE = Number(process.env.PRODUCT_SYNC_BATCH_SIZE || 1000);
const VARIANT_BATCH_SIZE = Number(process.env.VARIANT_SYNC_BATCH_SIZE || 2500);
const COLLECTION_BATCH_SIZE = Number(
  process.env.COLLECTION_SYNC_BATCH_SIZE || 2000,
);
const INGESTION_LEASE_MS = Number(
  process.env.PRODUCT_BULK_INGESTION_LEASE_MS || 15 * 60 * 1000,
);

function normalizeTextFromHtml(html) {
  if (!html || typeof html !== "string") return null;

  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toFloat(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function extractWeight(inventoryItem) {
  return inventoryItem?.measurement?.weight?.value ?? null;
}

function extractWeightUnit(inventoryItem) {
  return inventoryItem?.measurement?.weight?.unit ?? null;
}

function mapProductRow({ shop, mirrorBatchId, row }) {
  const image = row.featuredMedia?.preview?.image;
  const options = Array.isArray(row.options) ? row.options : [];
  const sourceUpdatedAt = row.updatedAt ? new Date(row.updatedAt) : null;

  return {
    shop,
    id: row.id,
    mirrorBatchId,
    deletedAt: null,
    title: row.title || "",
    handle: row.handle || null,
    status: row.status || "UNKNOWN",
    productType: row.productType || null,
    vendor: row.vendor || null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    templateSuffix: row.templateSuffix || null,
    descriptionHtml: row.descriptionHtml || null,
    descriptionText: normalizeTextFromHtml(row.descriptionHtml),
    createdAt: row.createdAt ? new Date(row.createdAt) : null,
    updatedAt: sourceUpdatedAt,
    publishedAt: row.publishedAt ? new Date(row.publishedAt) : null,
    seoTitle: row.seo?.title || null,
    seoDescription: row.seo?.description || null,
    totalInventory: toInt(row.totalInventory),
    categoryId: row.category?.id || null,
    categoryName: row.category?.name || null,
    featuredImageUrl: image?.url || null,
    featuredImageAltText: image?.altText || row.featuredMedia?.alt || null,
    optionsJson: options,
    collectionsJson: null,
    option1Name: options[0]?.name || null,
    option2Name: options[1]?.name || null,
    option3Name: options[2]?.name || null,
    variantCount: 0,
    visibleOnlineStore: Boolean(row.onlineStoreUrl),
    lastSourceUpdatedAt: sourceUpdatedAt,
    lastSourceEventAt: new Date(),
    lastSourceKind: "bulk_sync",
    lastReconciledAt: new Date(),
  };
}

function mapVariantRow({ shop, mirrorBatchId, productId, row }) {
  const inventoryItem = row.inventoryItem || {};
  const selectedOptions = Array.isArray(row.selectedOptions)
    ? row.selectedOptions
    : [];

  return {
    shop,
    id: row.id,
    productId,
    mirrorBatchId,
    deletedAt: null,
    title: row.title || null,
    sku: row.sku || null,
    barcode: row.barcode || null,
    price: toFloat(row.price),
    compareAtPrice: toFloat(row.compareAtPrice),
    inventoryQuantity: toInt(row.inventoryQuantity),
    inventoryPolicy: row.inventoryPolicy || null,
    taxable: row.taxable ?? null,
    taxCode: row.taxCode || null,
    position: toInt(row.position),
    selectedOptionsJson: selectedOptions,
    cost: toFloat(inventoryItem.unitCost?.amount),
    countryOfOrigin: inventoryItem.countryCodeOfOrigin || null,
    hsTariffCode: inventoryItem.harmonizedSystemCode || null,
    weight: toFloat(extractWeight(inventoryItem)),
    weightUnit: extractWeightUnit(inventoryItem),
    option1Value: selectedOptions[0]?.value || null,
    option2Value: selectedOptions[1]?.value || null,
    option3Value: selectedOptions[2]?.value || null,
    physicalProduct: inventoryItem.requiresShipping ?? null,
    tracked: inventoryItem.tracked ?? null,
    profitMargin: null,
  };
}

function mapCollectionRow({ shop, mirrorBatchId, row }) {
  return {
    shop,
    shopifyId: row.id,
    mirrorBatchId,
    title: row.title || "",
    handle: row.handle || null,
    deletedAt: null,
  };
}

async function claimSyncHistory({ shop, syncHistoryId, workerId }) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - INGESTION_LEASE_MS);

  const updated = await prisma.syncHistory.updateMany({
    where: {
      id: syncHistoryId,
      shop,
      status: "processing",
      stage: {
        in: [
          "MIRROR_DOWNLOAD_STARTED",
          "MIRROR_INGESTION_QUEUED",
          "MIRROR_INGESTION_RUNNING",
        ],
      },
      OR: [
        { lastHeartbeatAt: null },
        { lastHeartbeatAt: { lt: staleBefore } },
        { executionIdentity: workerId },
      ],
    },
    data: {
      stage: "MIRROR_INGESTION_RUNNING",
      executionIdentity: workerId,
      lastHeartbeatAt: now,
    },
  });

  if (updated.count !== 1) return null;

  return prisma.syncHistory.findUnique({
    where: { id: syncHistoryId },
  });
}

async function heartbeat(syncHistoryId) {
  await prisma.syncHistory
    .update({
      where: { id: syncHistoryId },
      data: { lastHeartbeatAt: new Date() },
    })
    .catch(() => {});
}

async function updateIngestionMetrics(syncHistoryId, metrics) {
  await prisma.syncHistory
    .update({
      where: { id: syncHistoryId },
      data: {
        metadata: {
          ingestion: {
            ...metrics,
            updatedAt: new Date().toISOString(),
          },
        },
      },
    })
    .catch(() => {});
}

async function flushProducts({ shop, mirrorBatchId, products }) {
  if (!products.length) return 0;

  const result = await prisma.product.createMany({
    data: products.map((row) => mapProductRow({ shop, mirrorBatchId, row })),
  });

  return result.count;
}

async function flushVariants({ shop, mirrorBatchId, variants }) {
  if (!variants.length) return 0;

  const productIds = [...new Set(variants.map(({ productId }) => productId).filter(Boolean))];
  const existingProducts = await prisma.product.findMany({
    where: {
      shop,
      mirrorBatchId,
      id: { in: productIds },
    },
    select: { id: true },
  });
  const existingProductIds = new Set(existingProducts.map((product) => product.id));
  const validVariants = variants.filter(({ productId }) =>
    existingProductIds.has(productId),
  );

  if (!validVariants.length) return 0;

  const result = await prisma.variant.createMany({
    data: validVariants.map(({ productId, row }) =>
      mapVariantRow({ shop, mirrorBatchId, productId, row }),
    ),
  });

  return result.count;
}

async function flushCollections({ shop, mirrorBatchId, collections }) {
  if (!collections.length) return 0;

  const seen = new Set();
  const unique = [];

  for (const row of collections) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    unique.push(row);
  }

  if (!unique.length) return 0;

  const result = await prisma.collection.createMany({
    data: unique.map((row) => mapCollectionRow({ shop, mirrorBatchId, row })),
  });

  return result.count;
}

function classifyLine(json) {
  if (json.__typename === "Product") return "PRODUCT";
  if (json.__typename === "ProductVariant") return "VARIANT";
  if (json.__typename === "Collection") return "COLLECTION";
  return "UNKNOWN";
}

function extractParentProductId(json) {
  return json.__parentId || json.product?.id || json.productId || null;
}

async function ingestJsonlStream({
  dataStream,
  shop,
  mirrorBatchId,
  syncHistoryId,
}) {
  const rl = readline.createInterface({
    input: dataStream,
    crlfDelay: Infinity,
  });

  const productBuffer = [];
  const variantBuffer = [];
  const collectionBuffer = [];

  let totalProductsProcessed = 0;
  let totalVariantsProcessed = 0;
  let totalCollectionsProcessed = 0;
  let lineCount = 0;
  let malformedCount = 0;
  const metrics = {
    productInsertCount: 0,
    variantInsertCount: 0,
    collectionInsertCount: 0,
    batchInsertTimeMs: 0,
    flushCount: 0,
    ingestionThroughput: 0,
    startedAt: new Date().toISOString(),
  };
  const startedAtMs = Date.now();

  async function flushAll() {
    const flushStartedAt = Date.now();
    const productInsertCount = await flushProducts({
      shop,
      mirrorBatchId,
      products: productBuffer,
    });
    totalProductsProcessed += productInsertCount;
    productBuffer.length = 0;

    const variantInsertCount = await flushVariants({
      shop,
      mirrorBatchId,
      variants: variantBuffer,
    });
    totalVariantsProcessed += variantInsertCount;
    variantBuffer.length = 0;

    const collectionInsertCount = await flushCollections({
      shop,
      mirrorBatchId,
      collections: collectionBuffer,
    });
    totalCollectionsProcessed += collectionInsertCount;
    collectionBuffer.length = 0;

    metrics.productInsertCount += productInsertCount;
    metrics.variantInsertCount += variantInsertCount;
    metrics.collectionInsertCount += collectionInsertCount;
    metrics.batchInsertTimeMs += Date.now() - flushStartedAt;
    metrics.flushCount += 1;
    metrics.ingestionThroughput = Math.round(
      ((totalProductsProcessed + totalVariantsProcessed + totalCollectionsProcessed) /
        Math.max((Date.now() - startedAtMs) / 1000, 1)) *
        100,
    ) / 100;

    await heartbeat(syncHistoryId);
    await updateIngestionMetrics(syncHistoryId, metrics);
  }

  for await (const line of rl) {
    if (!line.trim()) continue;

    lineCount += 1;

    let json;
    try {
      json = JSON.parse(line);
    } catch (error) {
      malformedCount += 1;
      if (malformedCount <= 25) {
        await recordMirrorAnomaly({
          shop,
          severity: "medium",
          type: "product_bulk_ingestion_parse_error",
          entityType: "syncHistory",
          entityId: syncHistoryId,
          message: error.message,
          details: { lineCount },
        }).catch(() => {});
      }
      continue;
    }

    const type = classifyLine(json);

    if (type === "PRODUCT") {
      productBuffer.push(json);
    } else if (type === "VARIANT") {
      const productId = extractParentProductId(json);
      if (productId) {
        variantBuffer.push({ productId, row: json });
      }
    } else if (type === "COLLECTION") {
      collectionBuffer.push(json);
    }

    if (
      productBuffer.length >= PRODUCT_BATCH_SIZE ||
      variantBuffer.length >= VARIANT_BATCH_SIZE ||
      collectionBuffer.length >= COLLECTION_BATCH_SIZE
    ) {
      await flushAll();
    }
  }

  await flushAll();

  return {
    lineCount,
    malformedCount,
    totalProductsProcessed,
    totalVariantsProcessed,
    totalCollectionsProcessed,
    metrics,
  };
}

async function activateProductMirrorSnapshot({
  shop,
  syncHistory,
  productCount,
  variantCount,
  metrics = {},
}) {
  if (!syncHistory.syncBatchId) {
    throw new Error("SYNC_BATCH_ID_MISSING");
  }

  if (productCount <= 0) {
    throw new Error("PRODUCT_SYNC_EMPTY_RESULT");
  }

  let previousBatchId = null;

  await prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({
      where: { shopUrl: shop },
      select: { activeMirrorBatchId: true },
    });
    previousBatchId = store?.activeMirrorBatchId || null;

    await tx.store.update({
      where: { shopUrl: shop },
      data: {
        activeMirrorBatchId: syncHistory.syncBatchId,
        isProductSyncing: false,
        isProductInitialySyning: false,
        shopifyBulkJobCompleted: true,
        lastProductSyncAt: new Date(),
        lastFullSyncAt: new Date(),
        lastReconcileAt: new Date(),
        mirrorHealthState: "HEALTHY",
        staleReason: null,
        repairRequired: false,
        syncProgressStage: "IDLE",
      },
    });

    await tx.syncHistory.update({
      where: { id: syncHistory.id },
      data: {
        status: "completed",
        stage: "MIRROR_ACTIVATED",
        recordCount: productCount,
        completedAt: new Date(),
        metadata: {
          ingestion: {
            ...metrics,
            productInsertCount: productCount,
            variantInsertCount: variantCount,
            activatedAt: new Date().toISOString(),
          },
        },
      },
    });
  });

  if (previousBatchId && previousBatchId !== syncHistory.syncBatchId) {
    await enqueueMirrorSnapshotCleanupJob({
      shop,
      mirrorBatchId: previousBatchId,
      replacedByBatchId: syncHistory.syncBatchId,
    });
  }

  return {
    activeMirrorBatchId: syncHistory.syncBatchId,
    productCount,
    variantCount,
  };
}

export const productBulkIngestionService = {
  async ingestCompletedBulkOperation({
    shop,
    syncHistoryId,
    bulkOperationId,
    workerId,
  }) {
    let syncHistory = null;

    try {
      syncHistory = await claimSyncHistory({
        shop,
        syncHistoryId,
        workerId,
      });

      if (!syncHistory) {
        return {
          skipped: true,
          reason: "sync_history_not_claimed",
          syncHistoryId,
          bulkOperationId,
        };
      }

      if (!syncHistory.syncBatchId) {
        throw new Error("SYNC_HISTORY_MISSING_SYNC_BATCH_ID");
      }

      await mirrorSnapshotCleanupService.cleanupMirrorBatch({
        shop,
        mirrorBatchId: syncHistory.syncBatchId,
      });

      const session = await getSession(shop);
      if (!session?.shop || session.shop !== shop) {
        throw new Error("SHOP_SESSION_NOT_AVAILABLE_FOR_BULK_INGESTION");
      }

      const bulkOperation = await getBulkEditStatus(bulkOperationId, session);

      if (!bulkOperation) {
        throw new Error("SHOPIFY_BULK_OPERATION_NOT_FOUND");
      }

      if (bulkOperation.status !== "COMPLETED") {
        throw new Error(
          `SHOPIFY_BULK_OPERATION_NOT_COMPLETED:${bulkOperation.status}`,
        );
      }

      if (!bulkOperation.url) {
        throw new Error("SHOPIFY_BULK_RESULT_URL_MISSING");
      }

      const response = await axios.get(new URL(bulkOperation.url).toString(), {
        responseType: "stream",
        timeout: 120_000,
        headers: { Accept: "application/json" },
      });

      if (response.status !== 200) {
        throw new Error(`BULK_RESULT_DOWNLOAD_FAILED:${response.status}`);
      }

      const result = await ingestJsonlStream({
        dataStream: response.data,
        shop,
        mirrorBatchId: syncHistory.syncBatchId,
        syncHistoryId: syncHistory.id,
      });

      const activation = await activateProductMirrorSnapshot({
        shop,
        syncHistory,
        productCount: result.totalProductsProcessed,
        variantCount: result.totalVariantsProcessed,
        metrics: result.metrics,
      });

      await clearKeyCaches(`${shop}:ProductFetch:`);
      await clearKeyCaches(`${shop}:productTypes:`);
      await clearKeyCaches(`${shop}:ProductFilterValues:`);
      await clearKeyCaches(`${shop}:storeDetails`);
      await clearKeyCaches(`${shop}:sync_details`);

      emitToUser(shop, "product_sync", {
        message: "Product sync completed",
        totalProductsProcessed: result.totalProductsProcessed,
        totalVariantsProcessed: result.totalVariantsProcessed,
      });

      await enqueueAutomaticProductRuleSignalJob({
        shop,
        triggerReference: `reindex:${bulkOperationId}`,
        triggerSource: "REINDEX",
      });

      return {
        success: true,
        shop,
        syncHistoryId,
        bulkOperationId,
        ...result,
        activation,
      };
    } catch (error) {
      if (syncHistory?.id) {
        await prisma.syncHistory
          .update({
            where: { id: syncHistory.id },
            data: {
              status: "failed",
              stage: "FAILED",
              errorMessage: error.message,
            },
          })
          .catch(() => {});
      }

      await prisma.store
        .update({
          where: { shopUrl: shop },
          data: {
            isProductSyncing: false,
            isProductInitialySyning: false,
            syncProgressStage: "IDLE",
          },
        })
        .catch(() => {});

      await markFullSyncFailed({
        shop,
        errorSummary: error.message,
      }).catch(() => {});

      await recordMirrorAnomaly({
        shop,
        severity: "critical",
        type: "product_bulk_ingestion_failure",
        entityType: "syncHistory",
        entityId: syncHistoryId,
        message: error.message,
        details: {
          bulkOperationId,
          workerId,
        },
      }).catch(() => {});

      throw error;
    }
  },
};
