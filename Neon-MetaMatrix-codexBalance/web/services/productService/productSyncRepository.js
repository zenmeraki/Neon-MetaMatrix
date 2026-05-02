import { prisma } from "../../config/database.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import {
  createMirrorBatchId,
  MIRROR_STALE_REASONS,
  markFullSyncStarted,
} from "../mirrorHealthService.js";
import { enqueueMirrorSnapshotCleanupJob } from "../../Jobs/Queues/mirrorSnapshotCleanupQueue.js";

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
  const startedAt = Date.now();
  let productInsertCount = 0;
  let variantInsertCount = 0;

  await prisma.$transaction(async (tx) => {
    if (productRows.length > 0) {
      const result = await tx.product.createMany({
        data: productRows.map((row) => ({ ...row, mirrorBatchId: syncBatchId })),
      });
      productInsertCount = result.count;
    }

    if (variantRows.length > 0) {
      const result = await tx.variant.createMany({
        data: variantRows.map((row) => ({ ...row, mirrorBatchId: syncBatchId })),
      });
      variantInsertCount = result.count;
    }
  });

  return {
    productInsertCount,
    variantInsertCount,
    batchInsertTimeMs: Date.now() - startedAt,
  };
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
    await enqueueMirrorSnapshotCleanupJob({
      shop,
      mirrorBatchId: previousBatchId,
      replacedByBatchId: syncBatchId,
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
