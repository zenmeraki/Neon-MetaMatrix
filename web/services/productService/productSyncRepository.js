import { prisma } from "../../config/database.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { addProductReconcileJob } from "../../Jobs/Queues/productReconcileJob.js";
import {
  createMirrorBatchId,
  markFullSyncStarted,
} from "../mirrorHealthService.js";
import {
  backfillMirrorBatchFreshness,
  MIRROR_SOURCE_KINDS,
  splitProductRowsAgainstTombstones,
} from "../mirrorFreshnessService.js";
import {
  initializeSyncExecution,
  SYNC_EXECUTION_STATES,
  updateSyncExecutionState,
} from "../syncExecutionStateService.js";
import { buildStoreShopWhere } from "../../utils/shopIdentifier.js";

export async function markProductSyncStarted({ shop, isInitialSync = false }) {
  await markFullSyncStarted(shop, { isInitialSync });
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

  await initializeSyncExecution({
    syncHistoryId: history.id,
    shop,
    executionIdentity: `sync:${shop}:${bulkOperationId}`,
    state: SYNC_EXECUTION_STATES.SHOPIFY_BULK_RUNNING,
  });

  return history;
}

export async function clearProductSyncCache(shop) {
  await Promise.all([
    clearKeyCaches(`${shop}:sync_details`),
    clearKeyCaches(`${shop}:storeDetails`),
  ]);
}

export async function stageProductMirrorBatch({ shop, syncBatchId }) {
  await prisma.store.update({
    where: buildStoreShopWhere(shop),
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
  const shop = productRows?.[0]?.shop || variantRows?.[0]?.shop || null;
  const filteredBatch = shop
    ? await splitProductRowsAgainstTombstones({
        shop,
        productRows,
        variantRows,
      })
    : {
        productRows,
        variantRows,
        blockedProductIds: [],
      };

  if (!filteredBatch.productRows.length && !filteredBatch.variantRows.length) {
    return {
      insertedProducts: 0,
      insertedVariants: 0,
      blockedProductIds: filteredBatch.blockedProductIds,
    };
  }

  await prisma.$transaction([
    prisma.product.createMany({
      data: filteredBatch.productRows.map((row) => ({
        ...row,
        mirrorBatchId: syncBatchId,
      })),
      skipDuplicates: true,
    }),
    prisma.variant.createMany({
      data: filteredBatch.variantRows.map((row) => ({
        ...row,
        mirrorBatchId: syncBatchId,
      })),
      skipDuplicates: true,
    }),
  ]);

  if (shop) {
    await backfillMirrorBatchFreshness({
      shop,
      mirrorBatchId: syncBatchId,
      sourceKind: MIRROR_SOURCE_KINDS.BULK_SYNC,
    });
  }

  return {
    insertedProducts: filteredBatch.productRows.length,
    insertedVariants: filteredBatch.variantRows.length,
    blockedProductIds: filteredBatch.blockedProductIds,
  };
}

export async function activateProductMirrorBatch({
  shop,
  syncBatchId,
  totalProductsProcessed,
  syncHistoryId,
}) {
  const store = await prisma.store.findUnique({
    where: buildStoreShopWhere(shop),
    select: {
      activeMirrorBatchId: true,
    },
  });

  const previousBatchId = store?.activeMirrorBatchId || null;

  await prisma.$transaction(async (tx) => {
    await tx.store.update({
      where: buildStoreShopWhere(shop),
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

  await updateSyncExecutionState({
    syncHistoryId,
    shop,
    state: SYNC_EXECUTION_STATES.COMPLETED,
    stage: "COMPLETED",
    completed: true,
  });

  const syncHistory = await prisma.syncHistory.findUnique({
    where: { id: syncHistoryId },
    select: {
      createdAt: true,
    },
  });

  await addProductReconcileJob(
    {
      shop,
      mode: "shop_incremental",
      updatedSinceOverride: syncHistory?.createdAt
        ? new Date(syncHistory.createdAt).toISOString()
        : null,
      reason: "post_full_sync_catchup",
    },
    {
      jobId: `product-reconcile:shop:${shop}:post-full-sync:${syncHistoryId}`,
      priority: 7,
    },
  ).catch(() => {});

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

  await clearProductSyncCache(shop).catch(() => {});
}

export async function updateInitialSyncProgress({ shop, totalProductsProcessed }) {
  await prisma.store.update({
    where: buildStoreShopWhere(shop),
    data: {
      productInitialSyncProgress: totalProductsProcessed,
      syncProgressStage: "MIRROR_STAGING",
    },
  });
}
