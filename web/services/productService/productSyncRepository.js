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

  const history = await prisma.syncHistory.create({
    data: {
      shop,
      bulkOperationId,
      syncBatchId,
      status: "processing",
      stage: "SHOPIFY_BULK_RUNNING",
      operationType: "Product",
      isInitialProductSync: isInitialSync,
    },
  });

  return history;
}

export async function clearProductSyncCache(shop) {
  await clearKeyCaches(`${shop}:sync_details`);
}

export async function stageProductMirrorBatch({ shop, syncBatchId }) {
  await prisma.store.update({
    where: { shopUrl: shop },
    data: {
      syncProgressStage: "MIRROR_STAGING",
      staleReason: "FULL_SYNC_RUNNING",
    },
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

export async function insertProductMirrorBatch({ productRows, variantRows, syncBatchId }) {
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
}

export async function updateInitialSyncProgress({ shop, totalProductsProcessed }) {
  await prisma.store.update({
    where: { shopUrl: shop },
    data: {
      productInitialSyncProgress: totalProductsProcessed,
      syncProgressStage: "MIRROR_STAGING",
    },
  });
}