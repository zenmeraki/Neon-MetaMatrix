import { prisma } from "../../config/database.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import {
  createMirrorBatchId,
  markFullSyncStarted,
} from "../mirrorHealthService.js";

export async function markProductSyncStarted({ shop }) {
  await markFullSyncStarted(shop);
}

export async function createProductSyncHistory({
  shop,
  bulkOperationId,
  isInitialSync = false,
}) {
  const syncBatchId = createMirrorBatchId("product_sync");

  return prisma.syncHistory.create({
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
}

export async function clearProductSyncCache(shop) {
  await clearKeyCaches(`${shop}:sync_details`);
}

export async function setStoreSyncQueued({ shop, isInitialSync = false }) {
  await prisma.store.update({
    where: { shopUrl: shop },
    data: {
      isProductSyncing: true,
      isProductInitialySyning: isInitialSync,
      shopifyBulkJobCompleted: false,
      syncProgressStage: "SHOPIFY_BULK_RUNNING",
      staleReason: "FULL_SYNC_RUNNING",
      lastSyncErrorSummary: null,
      mirrorUnsafeSince: new Date(),
    },
  });
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
        staleReason: "FULL_SYNC_RUNNING",
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

    await tx.variant.deleteMany({
      where: {
        shop,
        mirrorBatchId: syncBatchId,
      },
    });

    await tx.product.deleteMany({
      where: {
        shop,
        mirrorBatchId: syncBatchId,
      },
    });
  });
}

export async function insertProductMirrorBatch({
  productRows,
  variantRows,
  syncBatchId,
}) {
  await prisma.$transaction(async (tx) => {
    if (productRows.length > 0) {
      await tx.product.createMany({
        data: productRows.map((row) => ({
          ...row,
          mirrorBatchId: syncBatchId,
        })),
        skipDuplicates: true,
      });
    }

    if (variantRows.length > 0) {
      await tx.variant.createMany({
        data: variantRows.map((row) => ({
          ...row,
          mirrorBatchId: syncBatchId,
        })),
        skipDuplicates: true,
      });
    }
  });
}

export async function markSyncHistoryFailed({
  syncHistoryId,
  errorMessage,
}) {
  if (!syncHistoryId) return;

  await prisma.syncHistory.update({
    where: { id: syncHistoryId },
    data: {
      status: "failed",
      stage: "FAILED",
      errorMessage,
    },
  });
}

export async function activateProductMirrorBatch({
  shop,
  syncBatchId,
  totalProductsProcessed,
  syncHistoryId,
}) {
  const store = await prisma.store.findUnique({
    where: { shopUrl: shop },
    select: {
      activeMirrorBatchId: true,
      isProductInitialySyning: true,
    },
  });

  const previousBatchId = store?.activeMirrorBatchId || null;
  const completedAt = new Date();

  await prisma.$transaction(async (tx) => {
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
          updatedAt: completedAt,
        },
      });
    }
  });

  if (previousBatchId && previousBatchId !== syncBatchId) {
    await prisma.variant.deleteMany({
      where: {
        shop,
        mirrorBatchId: previousBatchId,
      },
    });

    await prisma.product.deleteMany({
      where: {
        shop,
        mirrorBatchId: previousBatchId,
      },
    });
  }
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