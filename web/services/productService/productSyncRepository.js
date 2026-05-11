import { prisma } from "../../config/database.js";
import {
  createMirrorBatchId,
  MIRROR_STALE_REASONS,
  markFullSyncStarted,
} from "../mirrorHealthService.js";
import { CURRENT_MIRROR_SCHEMA_VERSION } from "../catalogMirrorSchema.js";

export async function markProductSyncStarted({ shop }) {
  await markFullSyncStarted(shop);
}

export async function queueProductSyncStart({
  shop,
  bulkOperationId,
  isInitialSync = false,
  syncLeaseOwner = null,
}) {
  const syncBatchId = createMirrorBatchId("product_sync");
  const now = new Date();

  const syncHistory = await prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({
      where: { shopUrl: shop },
      select: { shopUrl: true },
    });

    if (!store) {
      throw new Error("Store not found for product sync");
    }

    const claimed = await tx.store.updateMany({
      where: {
        shopUrl: shop,
        ...(syncLeaseOwner ? { syncLeaseOwner } : {}),
      },
      data: {
        isProductSyncing: true,
        isProductInitialySyning: isInitialSync,
        shopifyBulkJobCompleted: false,
        syncProgressStage: "SHOPIFY_BULK_RUNNING",
        syncLeaseOwner,
        syncLeaseExpiresAt: new Date(now.getTime() + 30 * 60 * 1000),
        staleReason: MIRROR_STALE_REASONS.FULL_SYNC_RUNNING,
        lastSyncErrorSummary: null,
        mirrorUnsafeSince: new Date(),
      },
    });

    if (claimed.count !== 1) {
      throw new Error("PRODUCT_SYNC_LEASE_LOST");
    }

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
        executionState: "awaiting_shopify",
        executionIdentity: syncLeaseOwner,
        lastHeartbeatAt: now,
      },
    });
  });

  return syncHistory;
}

export async function queueProductVariantSyncStart({
  shop,
  bulkOperationId,
  syncBatchId,
  syncLeaseOwner = null,
}) {
  if (!syncBatchId) {
    throw new Error("syncBatchId is required for product variant sync");
  }

  return prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({
      where: { shopUrl: shop },
      select: { shopUrl: true },
    });

    if (!store) {
      throw new Error("Store not found for product variant sync");
    }

    const now = new Date();
    const claimed = await tx.store.updateMany({
      where: {
        shopUrl: shop,
        ...(syncLeaseOwner ? { syncLeaseOwner } : {}),
      },
      data: {
        isProductSyncing: true,
        isProductInitialySyning: false,
        syncProgressStage: "SHOPIFY_BULK_RUNNING",
        syncLeaseOwner,
        syncLeaseExpiresAt: new Date(now.getTime() + 30 * 60 * 1000),
        staleReason: MIRROR_STALE_REASONS.FULL_SYNC_RUNNING,
        lastSyncErrorSummary: null,
      },
    });

    if (claimed.count !== 1) {
      throw new Error("PRODUCT_SYNC_LEASE_LOST");
    }

    return tx.syncHistory.create({
      data: {
        shop,
        bulkOperationId,
        syncBatchId,
        status: "processing",
        stage: "SHOPIFY_VARIANT_BULK_RUNNING",
        operationType: "Product",
        isInitialProductSync: false,
        recordCount: 0,
        duration: 0,
        executionState: "awaiting_shopify",
        executionIdentity: syncLeaseOwner,
        lastHeartbeatAt: now,
      },
    });
  });
}

export async function clearProductSyncCache(shop) {
  return Boolean(shop);
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
        syncLeaseExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
        staleReason: "FULL_SYNC_RUNNING",
      },
    });

    if (syncHistoryId) {
      await tx.syncHistory.update({
        where: { id: syncHistoryId },
        data: {
          stage: "MIRROR_STAGING",
          executionState: "finalizing",
          lastHeartbeatAt: new Date(),
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

  await prisma.productMetafield.deleteMany({
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
  productMetafieldRows = [],
  syncBatchId,
}) {
  await prisma.$transaction(async (tx) => {
    if (productRows.length > 0) {
      await tx.product.createMany({
        data: productRows.map((row) => ({ ...row, mirrorBatchId: syncBatchId })),
        skipDuplicates: true,
      });
    }

    if (variantRows.length > 0) {
      await tx.variant.createMany({
        data: variantRows.map((row) => ({ ...row, mirrorBatchId: syncBatchId })),
        skipDuplicates: true,
      });
    }

    if (productMetafieldRows.length > 0) {
      await tx.productMetafield.createMany({
        data: productMetafieldRows.map((row) => ({
          ...row,
          mirrorBatchId: syncBatchId,
        })),
        skipDuplicates: true,
      });
    }
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
          executionState: "failed",
          lastHeartbeatAt: new Date(),
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
          syncLeaseOwner: null,
          syncLeaseExpiresAt: null,
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
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtext(${shop}))::text AS lock_acquired
    `;

    const store = await tx.store.findUnique({
      where: { shopUrl: shop },
      select: { activeMirrorBatchId: true },
    });
    previousBatchId = store?.activeMirrorBatchId || null;

    const activated = await tx.store.updateMany({
      where: {
        shopUrl: shop,
        activeMirrorBatchId: previousBatchId,
      },
      data: {
        activeMirrorBatchId: syncBatchId,
        mirrorSchemaVersion: CURRENT_MIRROR_SCHEMA_VERSION,
        mirrorHealthState: "HEALTHY",
        staleReason: null,
        repairRequired: false,
        mirrorUnsafeSince: null,
        lastSyncErrorSummary: null,
        lastFullSyncAt: completedAt,
        isProductSyncing: false,
        isProductInitialySyning: false,
        syncProgressStage: "IDLE",
        syncLeaseOwner: null,
        syncLeaseExpiresAt: null,
        shopifyBulkJobCompleted: true,
        storeTotalProducts: totalProductsProcessed,
        productInitialSyncProgress: totalProductsProcessed,
        lastProductSyncAt: completedAt,
      },
    });

    if (activated.count !== 1) {
      throw new Error("MIRROR_BATCH_ACTIVATION_RACE");
    }

    if (syncHistoryId) {
      await tx.syncHistory.update({
        where: { id: syncHistoryId },
        data: {
          status: "completed",
          stage: "MIRROR_ACTIVATED",
          executionState: "completed",
          lastHeartbeatAt: completedAt,
          recordCount: totalProductsProcessed,
          completedAt,
        },
      });
    }

    await tx.storeOperationalState.upsert({
      where: { shop },
      update: {
        activeCatalogBatchId: syncBatchId,
        activeProductBatchId: syncBatchId,
        activeVariantBatchId: syncBatchId,
        mirrorSchemaVersion: CURRENT_MIRROR_SCHEMA_VERSION,
        catalogConsistencyStatus: "READY",
        lastSyncAt: completedAt,
        activeSyncOperationId: null,
      },
      create: {
        shop,
        activeCatalogBatchId: syncBatchId,
        activeProductBatchId: syncBatchId,
        activeVariantBatchId: syncBatchId,
        mirrorSchemaVersion: CURRENT_MIRROR_SCHEMA_VERSION,
        catalogConsistencyStatus: "READY",
        lastSyncAt: completedAt,
      },
    });
  });

  if (previousBatchId && previousBatchId !== syncBatchId) {
    await prisma.$executeRaw`
      INSERT INTO "ProductTombstone" (
        "id",
        "shop",
        "productId",
        "deletedAt",
        "sourceKind",
        "lastReconciledAt",
        "updatedAt"
      )
      SELECT
        CONCAT(${shop}, ':', previous_product."id"),
        ${shop},
        previous_product."id",
        ${completedAt},
        'SHOPIFY_ABSENT_FROM_SYNC',
        ${completedAt},
        ${completedAt}
      FROM "Product" previous_product
      WHERE previous_product."shop" = ${shop}
        AND previous_product."mirrorBatchId" = ${previousBatchId}
        AND NOT EXISTS (
          SELECT 1
          FROM "Product" current_product
          WHERE current_product."shop" = ${shop}
            AND current_product."mirrorBatchId" = ${syncBatchId}
            AND current_product."id" = previous_product."id"
        )
      ON CONFLICT ("shop", "productId")
      DO UPDATE SET
        "deletedAt" = EXCLUDED."deletedAt",
        "sourceKind" = EXCLUDED."sourceKind",
        "lastReconciledAt" = EXCLUDED."lastReconciledAt",
        "updatedAt" = EXCLUDED."updatedAt"
    `;

    await prisma.variant.deleteMany({
      where: { shop, mirrorBatchId: previousBatchId },
    });
    await prisma.productMetafield.deleteMany({
      where: { shop, mirrorBatchId: previousBatchId },
    });
    await prisma.product.deleteMany({
      where: { shop, mirrorBatchId: previousBatchId },
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
      syncLeaseExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });
}
