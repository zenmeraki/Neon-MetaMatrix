import { prisma } from "../../config/database.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import {
  createMirrorBatchId,
  MIRROR_STALE_REASONS,
  markFullSyncStarted,
} from "../mirrorHealthService.js";

export async function markProductSyncStarted({ shop }) {
  await markFullSyncStarted(shop);
}

export async function queueProductSyncStart({
  shop,
  bulkOperationId,
  isInitialSync = false,
}) {
  const syncBatchId = createMirrorBatchId("product_sync");

  const syncHistory = await prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({
      where: { shopUrl: shop },
      select: { shopUrl: true },
    });

    if (!store) {
      throw new Error("Store not found for product sync");
    }

    await tx.store.update({
      where: { shopUrl: shop },
      data: {
        isProductSyncing: true,
        isProductInitialySyning: isInitialSync,
        shopifyBulkJobCompleted: false,
        syncProgressStage: "SHOPIFY_BULK_RUNNING",
        staleReason: MIRROR_STALE_REASONS.FULL_SYNC_RUNNING,
        lastSyncErrorSummary: null,
        mirrorUnsafeSince: new Date(),
      },
    });

    return tx.syncHistory.create({
      data: {
        shop,
        bulkOperationId,
        syncBatchId,
        status: "processing",
        stage: "SHOPIFY_BULK_RUNNING",
        operationType: "Product",
        isInitialProductSync: isInitialSync,
        recordCount: 0,
        duration: 0,
      },
    });
  });

  return syncHistory;
}

export async function clearProductSyncCache(shop) {
  await clearKeyCaches(`${shop}:sync_`);
}

export async function stageProductMirrorBatch({
  shop,
  syncBatchId,
  syncHistoryId = null,
}) {
  await prisma.$transaction(async (tx) => {
    await tx.store.update({
      where: { shopUrl: shop },
      data: {
        syncProgressStage: "MIRROR_STAGING",
        staleReason: MIRROR_STALE_REASONS.FULL_SYNC_RUNNING,
      },
    });

    if (syncHistoryId) {
      await tx.syncHistory.update({
        where: { id: syncHistoryId },
        data: {
          stage: "MIRROR_STAGING",
        },
      });
    }
  });

  await prisma.variant.deleteMany({
    where: {
      shop,
      mirrorBatchId: syncBatchId,
    },
  });

  await prisma.product.deleteMany({
    where: {
      shop,
      mirrorBatchId: syncBatchId,
    },
  });
}

export async function insertProductMirrorBatch({
  productRows,
  variantRows,
  syncBatchId,
}) {
  if (productRows.length === 0 && variantRows.length === 0) {
    return;
  }

  // This is the sync hot path. Raw chunked inserts avoid Prisma createMany's
  // model marshalling overhead while preserving ON CONFLICT DO NOTHING.
  await insertProductRows(productRows, syncBatchId);
  await insertVariantRows(variantRows, syncBatchId);
}

const configuredMaxInsertParams = Number(
  process.env.PRODUCT_SYNC_SQL_PARAM_LIMIT || 45_000,
);
const configuredInsertConcurrency = Number(
  process.env.PRODUCT_SYNC_INSERT_CONCURRENCY || 2,
);

const MAX_INSERT_PARAMS = Number.isFinite(configuredMaxInsertParams)
  ? Math.max(1_000, Math.min(configuredMaxInsertParams, 60_000))
  : 45_000;
const INSERT_CONCURRENCY = Number.isFinite(configuredInsertConcurrency)
  ? Math.max(1, Math.min(Math.trunc(configuredInsertConcurrency), 4))
  : 2;

const PRODUCT_INSERT_COLUMNS = [
  "shop",
  "id",
  "mirrorBatchId",
  "title",
  "handle",
  "status",
  "productType",
  "vendor",
  "tags",
  "templateSuffix",
  "descriptionHtml",
  "descriptionText",
  "createdAt",
  "updatedAt",
  "publishedAt",
  "seoTitle",
  "seoDescription",
  "totalInventory",
  "categoryId",
  "categoryName",
  "googleShoppingEnabled",
  "googleShoppingAgeGroup",
  "googleShoppingCategory",
  "googleShoppingColor",
  "googleShoppingCondition",
  "googleShoppingCustomLabel0",
  "googleShoppingCustomLabel1",
  "googleShoppingCustomLabel2",
  "googleShoppingCustomLabel3",
  "googleShoppingCustomLabel4",
  "googleShoppingCustomProduct",
  "googleShoppingGender",
  "googleShoppingMpn",
  "googleShoppingMaterial",
  "googleShoppingSize",
  "googleShoppingSizeSystem",
  "googleShoppingSizeType",
  "categoryAgeGroup",
  "categoryColor",
  "categoryFabric",
  "categoryFit",
  "categorySize",
  "categoryTargetGender",
  "categoryWaistRise",
  "featuredImageUrl",
  "featuredImageAltText",
  "optionsJson",
  "collectionsJson",
  "option1Name",
  "option2Name",
  "option3Name",
  "variantCount",
  "visibleOnlineStore",
];

const VARIANT_INSERT_COLUMNS = [
  "shop",
  "id",
  "productId",
  "mirrorBatchId",
  "title",
  "sku",
  "barcode",
  "price",
  "compareAtPrice",
  "inventoryQuantity",
  "inventoryPolicy",
  "taxable",
  "taxCode",
  "position",
  "selectedOptionsJson",
  "cost",
  "countryOfOrigin",
  "hsTariffCode",
  "weight",
  "weightUnit",
  "option1Value",
  "option2Value",
  "option3Value",
  "physicalProduct",
  "profitMargin",
  "tracked",
];

const COLUMN_CASTS = {
  tags: "text[]",
  optionsJson: "jsonb",
  collectionsJson: "jsonb",
  selectedOptionsJson: "jsonb",
};

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function normalizeInsertValue(column, row, syncBatchId) {
  if (column === "mirrorBatchId") {
    return syncBatchId;
  }

  const value = row[column];

  if (COLUMN_CASTS[column] === "jsonb") {
    return value === undefined || value === null ? null : JSON.stringify(value);
  }

  if (column === "tags") {
    return Array.isArray(value) ? value : [];
  }

  return value === undefined ? null : value;
}

async function insertRows({ tableName, columns, rows, syncBatchId }) {
  if (rows.length === 0) {
    return;
  }

  const chunkSize = Math.max(1, Math.floor(MAX_INSERT_PARAMS / columns.length));
  const columnSql = columns.map(quoteIdentifier).join(", ");
  const chunks = [];

  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    chunks.push(rows.slice(offset, offset + chunkSize));
  }

  let nextChunkIndex = 0;

  async function insertNextChunk() {
    const chunkIndex = nextChunkIndex;
    nextChunkIndex += 1;

    if (chunkIndex >= chunks.length) {
      return;
    }

    const chunk = chunks[chunkIndex];
    const values = [];
    const rowPlaceholders = chunk.map((row) => {
      const placeholders = columns.map((column) => {
        values.push(normalizeInsertValue(column, row, syncBatchId));
        const cast = COLUMN_CASTS[column] ? `::${COLUMN_CASTS[column]}` : "";
        return `$${values.length}${cast}`;
      });

      return `(${placeholders.join(", ")})`;
    });

    await prisma.$executeRawUnsafe(
      `INSERT INTO ${quoteIdentifier(tableName)} (${columnSql}) VALUES ${rowPlaceholders.join(
        ", ",
      )} ON CONFLICT DO NOTHING`,
      ...values,
    );

    await insertNextChunk();
  }

  const workers = Array.from(
    { length: Math.min(INSERT_CONCURRENCY, chunks.length) },
    () => insertNextChunk(),
  );

  await Promise.all(workers);
}

async function insertProductRows(rows, syncBatchId) {
  await insertRows({
    tableName: "Product",
    columns: PRODUCT_INSERT_COLUMNS,
    rows,
    syncBatchId,
  });
}

async function insertVariantRows(rows, syncBatchId) {
  await insertRows({
    tableName: "Variant",
    columns: VARIANT_INSERT_COLUMNS,
    rows,
    syncBatchId,
  });
}

export async function markSyncHistoryFailed({
  shop,
  syncHistoryId,
  errorMessage,
}) {
  await prisma.$transaction(async (tx) => {
    if (syncHistoryId) {
      await tx.syncHistory.update({
        where: { id: syncHistoryId },
        data: {
          status: "failed",
          stage: "FAILED",
          errorMessage,
        },
      });
    }

    if (shop) {
      await tx.store.update({
        where: { shopUrl: shop },
        data: {
          isProductSyncing: false,
          isProductInitialySyning: false,
          syncProgressStage: "IDLE",
          mirrorHealthState: "UNSAFE",
          staleReason: MIRROR_STALE_REASONS.FULL_SYNC_FAILED,
          repairRequired: true,
          mirrorUnsafeSince: new Date(),
          shopifyBulkJobCompleted: false,
          lastSyncErrorSummary: errorMessage,
        },
      });
    }
  });
}

export async function activateProductMirrorBatch({
  shop,
  syncBatchId,
  totalProductsProcessed,
  syncHistoryId,
}) {
  const completedAt = new Date();
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
        activeMirrorBatchId: syncBatchId,
        mirrorHealthState: "HEALTHY",
        staleReason: null,
        repairRequired: false,
        mirrorUnsafeSince: null,
        lastSyncErrorSummary: null,
        lastFullSyncAt: completedAt,
        isProductSyncing: false,
        isProductInitialySyning: false,
        syncProgressStage: "IDLE",
        shopifyBulkJobCompleted: true,
        storeTotalProducts: totalProductsProcessed,
        productInitialSyncProgress: totalProductsProcessed,
        lastProductSyncAt: completedAt,
      },
    });

    if (syncHistoryId) {
      await tx.syncHistory.update({
        where: { id: syncHistoryId },
        data: {
          status: "completed",
          stage: "MIRROR_ACTIVATED",
          recordCount: totalProductsProcessed,
          completedAt,
        },
      });
    }
  });

  if (previousBatchId && previousBatchId !== syncBatchId) {
    console.log("[sync:old_batch_gc_required]", {
      shop,
      previousBatchId,
      activeBatchId: syncBatchId,
    });
  }

  return {
    previousBatchId,
    activeBatchId: syncBatchId,
  };
}

export async function updateInitialSyncProgress({
  shop,
  totalProductsProcessed,
}) {
  await prisma.store.update({
    where: { shopUrl: shop },
    data: {
      productInitialSyncProgress: totalProductsProcessed,
      syncProgressStage: "MIRROR_STAGING",
    },
  });
}
