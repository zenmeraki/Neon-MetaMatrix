import { prisma } from "../../config/database.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { emitSyncStateChanged } from "../../utils/syncRealtime.js";
import {
  createMirrorBatchId,
  markFullSyncFailed,
  markFullSyncStarted,
} from "../mirrorHealthService.js";

export async function prepareProductSyncStart({
  shop,
  isInitialSync = false,
}) {
  const syncBatchId = createMirrorBatchId("product_sync");

  const history = await prisma.$transaction(async (tx) => {
    await markFullSyncStarted(shop, tx);

    return tx.syncHistory.create({
      data: {
        shop,
        syncBatchId,
        status: "processing",
        stage: "STARTING",
        operationType: "Product",
        isInitialProductSync: isInitialSync,
      },
    });
  });

  return history;
}

export async function attachBulkOperationToSyncHistory({
  shop,
  syncHistoryId,
  bulkOperationId,
}) {
  const history = await prisma.syncHistory.update({
    where: { id: syncHistoryId },
    data: {
      bulkOperationId,
      stage: "SHOPIFY_BULK_RUNNING",
      status: "processing",
      errorSummary: null,
    },
  });

  await clearProductSyncCache(shop);
  emitSyncStateChanged({
    shop,
    scope: "product",
    eventType: "bulk-operation-attached",
    syncHistoryId,
    bulkOperationId,
    syncBatchId: history.syncBatchId,
    stage: "SHOPIFY_BULK_RUNNING",
    status: "syncing",
  });

  return history;
}

export async function clearProductSyncCache(shop) {
  await clearKeyCaches(`${shop}:sync_details`);
  await clearKeyCaches(`${shop}:sync_progress`);
}

export async function stageProductMirrorBatch({
  shop,
  syncBatchId,
  syncHistoryId,
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
          status: "processing",
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

  await clearProductSyncCache(shop);
  emitSyncStateChanged({
    shop,
    scope: "product",
    eventType: "staging",
    syncHistoryId,
    syncBatchId,
    stage: "MIRROR_STAGING",
    status: "syncing",
  });
}

export async function insertProductMirrorBatch({
  productRows,
  variantRows,
  syncBatchId,
}) {
  await prisma.$transaction([
    prisma.product.createMany({
      data: productRows.map((row) => ({
        ...row,
        mirrorBatchId: syncBatchId,
      })),
      skipDuplicates: true,
    }),
    prisma.variant.createMany({
      data: variantRows.map((row) => ({
        ...row,
        mirrorBatchId: syncBatchId,
      })),
      skipDuplicates: true,
    }),
  ]);
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
    },
  });

  const previousBatchId = store?.activeMirrorBatchId || null;

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
        lastFullSyncAt: new Date(),
        lastIncrementalSyncAt: new Date(),
        lastWebhookProcessedAt: new Date(),
        lastReconcileAt: new Date(),
        isProductSyncing: false,
        isProductInitialySyning: false,
        syncProgressStage: "IDLE",
        shopifyBulkJobCompleted: true,
        storeTotalProducts: totalProductsProcessed,
        productInitialSyncProgress: totalProductsProcessed,
      },
    });

    await tx.syncHistory.update({
      where: { id: syncHistoryId },
      data: {
        stage: "MIRROR_ACTIVATED",
        status: "completed",
        recordCount: totalProductsProcessed,
        errorSummary: null,
      },
    });
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

  await clearProductSyncCache(shop);
  emitSyncStateChanged({
    shop,
    scope: "product",
    eventType: "completed",
    syncHistoryId,
    syncBatchId,
    stage: "MIRROR_ACTIVATED",
    status: "completed",
  });
}

export async function updateInitialSyncProgress({
  shop,
  totalProductsProcessed,
  syncHistoryId,
}) {
  await prisma.$transaction(async (tx) => {
    await tx.store.update({
      where: { shopUrl: shop },
      data: {
        productInitialSyncProgress: totalProductsProcessed,
        syncProgressStage: "MIRROR_STAGING",
      },
    });

    if (syncHistoryId) {
      await tx.syncHistory.update({
        where: { id: syncHistoryId },
        data: {
          stage: "MIRROR_STAGING",
          status: "processing",
          recordCount: totalProductsProcessed,
        },
      });
    }
  });

  await clearProductSyncCache(shop);
  emitSyncStateChanged({
    shop,
    scope: "product",
    eventType: "progress",
    syncHistoryId,
    stage: "MIRROR_STAGING",
    status: "syncing",
  });
}

export async function markProductSyncFailed({
  shop,
  syncHistoryId,
  errorSummary,
  stage = "FAILED",
}) {
  if (syncHistoryId) {
    await prisma.syncHistory.updateMany({
      where: { id: syncHistoryId },
      data: {
        status: "failed",
        stage,
        errorSummary,
      },
    });
  }

  await markFullSyncFailed({
    shop,
    errorSummary,
  });

  await clearProductSyncCache(shop);
  emitSyncStateChanged({
    shop,
    scope: "product",
    eventType: "failed",
    syncHistoryId,
    stage,
    status: "failed",
    needsAttention: true,
  });
}
