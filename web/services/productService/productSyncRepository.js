import { prisma } from "../../Config/database.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import * as productMirrorRepository from "../../repositories/productMirrorRepository.js";
import * as variantMirrorRepository from "../../repositories/variantMirrorRepository.js";
import * as catalogIngestFinalizationService from "../sync/catalogIngestFinalizationService.js";
import * as syncRunService from "../sync/syncRunService.js";
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
  });

  await Promise.all([
    variantMirrorRepository.deleteVariantMirrorsByBatch({
      shop,
      mirrorBatchId: syncBatchId,
    }),
    productMirrorRepository.deleteProductMirrorsByBatch({
      shop,
      mirrorBatchId: syncBatchId,
    }),
  ]);
}

export async function insertProductMirrorBatch({
  productRows,
  variantRows,
  syncBatchId,
  catalogBatchId,
}) {
  if (!catalogBatchId) {
    throw new Error("catalogBatchId is required for product mirror batch insert");
  }

  const productsForBatch = productRows.map((row) => ({
    ...row,
    mirrorBatchId: syncBatchId,
    catalogBatchId,
  }));
  const variantsForBatch = variantRows.map((row) => ({
    ...row,
    mirrorBatchId: syncBatchId,
    catalogBatchId,
    priceDecimal: row.priceDecimal ?? row.price ?? null,
    compareAtPriceDecimal: row.compareAtPriceDecimal ?? row.compareAtPrice ?? null,
    costDecimal: row.costDecimal ?? row.cost ?? null,
    weightDecimal: row.weightDecimal ?? row.weight ?? null,
    profitMarginDecimal: row.profitMarginDecimal ?? row.profitMargin ?? null,
  }));

  if (productsForBatch.length === 0 && variantsForBatch.length === 0) {
    return {
      productCount: 0,
      variantCount: 0,
    };
  }

  return prisma.$transaction(async (tx) => {
    if (productsForBatch.length > 0) {
      await tx.product.createMany({
        data: productsForBatch,
        skipDuplicates: true,
      });
    }

    if (variantsForBatch.length === 0) {
      return {
        productCount: productsForBatch.length,
        variantCount: 0,
      };
    }

    const expectedParentIds = Array.from(
      new Set(variantsForBatch.map((row) => row.productId).filter(Boolean)),
    );
    const existingParents = await tx.product.findMany({
      where: {
        shop: variantsForBatch[0].shop,
        mirrorBatchId: syncBatchId,
        id: {
          in: expectedParentIds,
        },
      },
      select: {
        id: true,
      },
    });
    const existingParentIds = new Set(existingParents.map((row) => row.id));
    const missingParentIds = expectedParentIds.filter(
      (productId) => !existingParentIds.has(productId),
    );

    if (missingParentIds.length > 0) {
      const error = new Error(
        "Cannot stage variant rows without matching product rows in the same catalog batch",
      );
      error.code = "PRODUCT_VARIANT_PARENT_MISSING";
      error.httpStatus = 409;
      error.details = {
        mirrorBatchId: syncBatchId,
        missingParentCount: missingParentIds.length,
        sampleProductIds: missingParentIds.slice(0, 10),
      };
      throw error;
    }

    await tx.variant.createMany({
      data: variantsForBatch,
      skipDuplicates: true,
    });

    return {
      productCount: productsForBatch.length,
      variantCount: variantsForBatch.length,
    };
  });
}

export async function markSyncHistoryFailed({ shop, syncHistoryId, errorMessage }) {
  let activeRun = null;

  if (shop) {
    activeRun = await syncRunService.getLatestSyncRun({
      shop,
      runType: "FULL_BASELINE",
      domain: "PRODUCT",
      status: "RUNNING",
    });

    await catalogIngestFinalizationService.markBaselineIngestFailed({
      shop,
      catalogBatchId: activeRun?.catalogBatchId || null,
      syncRunId: activeRun?.id || null,
      error: {
        code: "PRODUCT_SYNC_FAILED",
        message: errorMessage,
      },
    }).catch(() => {});
  }

  await prisma.$transaction(async (tx) => {
    if (syncHistoryId) {
      await tx.syncHistory.update({
        where: { id: syncHistoryId },
        data: { status: "failed", stage: "FAILED", errorMessage },
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
          lastSyncErrorSummary: errorMessage,
        },
      });
    }
  });
}

export async function activateProductMirrorBatch({
  shop,
  syncBatchId,
  catalogBatchId,
  totalProductsProcessed,
  syncHistoryId,
  responseUrl = null,
}) {
  if (!catalogBatchId) {
    throw new Error("catalogBatchId is required for product mirror batch activation");
  }

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
          ...(responseUrl ? { responseUrl } : {}),
          updatedAt: completedAt,
        },
      });
    }
  });

  const syncRun = await syncRunService.getLatestSyncRun({
    shop,
    runType: "FULL_BASELINE",
    domain: "PRODUCT",
    status: "RUNNING",
  });

  await catalogIngestFinalizationService.finalizeSuccessfulBaselineIngest({
    shop,
    catalogBatchId,
    syncRunId: syncRun?.id || null,
    expectedProductCount: totalProductsProcessed,
    responseUrl,
    reason: "product_sync_completed",
  });

  if (previousBatchId && previousBatchId !== syncBatchId) {
    const retainedReferences = await prisma.$transaction(async (tx) => {
      const [
        activeTargetSnapshots,
        activeEditHistories,
        activeExportJobs,
      ] = await Promise.all([
        tx.targetSnapshotSet.count({
          where: {
            shop,
            OR: [
              { catalogBatchId: previousBatchId },
              { mirrorBatchId: previousBatchId },
            ],
            status: { in: ["BUILDING", "ACTIVE"] },
          },
        }),
        tx.editHistory.count({
          where: {
            shop,
            OR: [
              { targetCatalogBatchId: previousBatchId },
              { targetMirrorBatchId: previousBatchId },
            ],
            executionState: {
              notIn: ["completed", "failed", "partial", "cancelled"],
            },
          },
        }),
        tx.exportJob.count({
          where: {
            shop,
            OR: [
              { targetCatalogBatchId: previousBatchId },
              { targetMirrorBatchId: previousBatchId },
            ],
            executionState: {
              notIn: ["completed", "failed", "cancelled", "partial"],
            },
          },
        }),
      ]);

      return activeTargetSnapshots + activeEditHistories + activeExportJobs;
    });

    if (retainedReferences > 0) {
      return;
    }

    await variantMirrorRepository.deleteVariantMirrorsByBatch({
      shop,
      mirrorBatchId: previousBatchId,
    });

    await productMirrorRepository.deleteProductMirrorsByBatch({
      shop,
      mirrorBatchId: previousBatchId,
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
