import { getSession } from "../../../utils/sessionHandler.js";
import { clearKeyCaches } from "../../../utils/cacheUtils.js";
import { emitToUser } from "../../../socket.js";
import { prisma } from "../../../Config/database.js";
import {
  createMirrorBatchId,
  markFullSyncFailed,
} from "../../../services/mirrorHealthService.js";
import { recordMirrorAnomaly } from "../../../services/mirrorAnomalyService.js";
import { enqueueAutomaticProductRuleSignalJob } from "../../../services/automaticProductRuleExecutionService.js";
import * as bulkOperationMonitorService from "../../../services/sync/bulkOperationMonitorService.js";
import * as syncRunService from "../../../services/sync/syncRunService.js";
import { ingestCatalogBaselineArtifact } from "../../../workers/catalogBaselineIngestWorker.js";
import { ingestCollectionMembershipArtifact } from "../../../workers/collectionMembershipIngestWorker.js";
import { ingestProductTypeArtifact } from "../../../workers/productTypeIngestWorker.js";
import { CATALOG_BULK_QUERY_DEFINITIONS } from "../../../graphql/catalogBulkQueries.js";

const OPERATION_TYPE = {
  PRODUCT: "Product",
  COLLECTION: "Collection",
  PRODUCT_TYPE: "ProductType",
};

const getBulkQueryMetadataForOperationType = (operationType) => {
  if (operationType === OPERATION_TYPE.PRODUCT) {
    return CATALOG_BULK_QUERY_DEFINITIONS.PRODUCT_VARIANT_BASELINE;
  }

  if (operationType === OPERATION_TYPE.COLLECTION) {
    return CATALOG_BULK_QUERY_DEFINITIONS.COLLECTION_MEMBERSHIP;
  }

  if (operationType === OPERATION_TYPE.PRODUCT_TYPE) {
    return CATALOG_BULK_QUERY_DEFINITIONS.PRODUCT_TYPE_ONLY;
  }

  return null;
};

const PRODUCT_CACHE_KEYS = (shop) => [
  `${shop}:ProductFetch:`,
  `${shop}:productTypes:`,
  `${shop}:ProductFilterValues:`,
  `${shop}:storeDetails`,
  `${shop}:ProductFetch`,
  `${shop}:sync_details`,
];

const ensureSyncBatchId = async (syncHistory) => {
  if (syncHistory.syncBatchId) {
    return syncHistory;
  }

  if (syncHistory.operationType !== OPERATION_TYPE.PRODUCT) {
    return syncHistory;
  }

  const syncBatchId = createMirrorBatchId("product_sync");

  return prisma.syncHistory.update({
    where: { id: syncHistory.id },
    data: { syncBatchId },
  });
};

const getCompatibilitySyncHistoryForBulkOperation = async ({
  bulkOperationId,
  shop,
}) => {
  return prisma.syncHistory.findFirst({
    where: {
      bulkOperationId,
      ...(shop ? { shop } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
};

const claimCompatibilitySyncHistoryFinalization = async (syncHistory) => {
  if (syncHistory.status !== "processing") {
    return null;
  }

  const staleFinalizerBefore = new Date(Date.now() - 15 * 60 * 1000);

  const claimed = await prisma.syncHistory.updateMany({
    where: {
      id: syncHistory.id,
      shop: syncHistory.shop,
      bulkOperationId: syncHistory.bulkOperationId,
      status: "processing",
      OR: [
        {
          executionState: {
            in: ["planned", "running"],
          },
        },
        {
          executionState: "finalizing",
          lastHeartbeatAt: null,
        },
        {
          executionState: "finalizing",
          lastHeartbeatAt: {
            lt: staleFinalizerBefore,
          },
        },
      ],
    },
    data: {
      executionState: "finalizing",
      stage: "INGESTING",
      lastHeartbeatAt: new Date(),
    },
  });

  if (claimed.count !== 1) {
    return null;
  }

  return prisma.syncHistory.findUnique({
    where: { id: syncHistory.id },
  });
};

const assertCompletedBulkOperation = ({ monitorResult }) => {
  const bulkOperation = monitorResult?.bulkOperation;
  const normalizedStatus =
    typeof bulkOperation?.status === "string"
      ? bulkOperation.status.trim().toUpperCase()
      : null;

  if (!bulkOperation) {
    throw new Error("Failed to retrieve bulk operation details");
  }

  if (monitorResult.failed || bulkOperation.errorCode) {
    throw new Error(
      `Bulk operation failed in Shopify. status=${bulkOperation.status} errorCode=${bulkOperation.errorCode}`,
    );
  }

  if (normalizedStatus !== "COMPLETED") {
    throw new Error(
      `Bulk operation is not completed yet. status=${bulkOperation.status}`,
    );
  }

  const sourceUrl = bulkOperation.url || bulkOperation.partialDataUrl;

  if (!sourceUrl || typeof sourceUrl !== "string") {
    throw new Error(
      `Bulk operation completed but result URL is missing. status=${bulkOperation.status}`,
    );
  }

  return {
    bulkOperation,
    sourceUrl,
  };
};

const markCompatibilityFailure = async ({ syncHistory, error }) => {
  if (syncHistory) {
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

  if (!syncHistory?.shop) {
    return;
  }

  await prisma.store
    .update({
      where: { shopUrl: syncHistory.shop },
      data: {
        isProductSyncing: false,
        isCollectionSyncing: false,
        isProductTypeSyncing: false,
        isProductInitialySyning: false,
        syncProgressStage: "IDLE",
      },
    })
    .catch(() => {});

  await markFullSyncFailed({
    shop: syncHistory.shop,
    errorSummary: error.message,
  }).catch(() => {});

  await recordMirrorAnomaly({
    shop: syncHistory.shop,
    severity: "critical",
    type: "bulk_sync_finalize_failure",
    entityType: "syncHistory",
    entityId: syncHistory.id,
    message: error.message,
    details: {
      bulkOperationId: syncHistory.bulkOperationId,
      operationType: syncHistory.operationType,
    },
  }).catch(() => {});
};

const runProductIngest = async ({
  syncHistory,
  session,
  sourceUrl,
  bulkOperationId,
  syncRun,
}) => {
  const syncResult = await ingestCatalogBaselineArtifact({
    sourceUrl,
    shop: session.shop,
    session,
    syncBatchId: syncHistory.syncBatchId,
    catalogBatchId: syncHistory.syncBatchId,
    syncHistoryId: syncHistory.id,
    syncRunId: syncRun?.id || null,
  });

  await Promise.all(PRODUCT_CACHE_KEYS(session.shop).map(clearKeyCaches));

  emitToUser(session.shop, "product_sync", {
    message: "Product sync completed",
    totalProductsProcessed: syncResult.totalProductsProcessed || 0,
    totalVariantsProcessed: syncResult.totalVariantsProcessed || 0,
  });

  await enqueueAutomaticProductRuleSignalJob({
    shop: session.shop,
    triggerReference: `reindex:${bulkOperationId}`,
    triggerSource: "REINDEX",
  });

  return syncResult.totalProductsProcessed || 0;
};

const runCollectionIngest = async ({
  syncHistory,
  session,
  sourceUrl,
  syncRun,
}) => {
  const syncResult = await ingestCollectionMembershipArtifact({
    sourceUrl,
    shop: session.shop,
    catalogBatchId: syncHistory.syncBatchId,
    syncHistoryId: syncHistory.id,
    syncRunId: syncRun?.id || null,
  });

  await clearKeyCaches(`${session.shop}:storeDetails`);

  return syncResult.recordCount || 0;
};

const runProductTypeIngest = async ({
  syncHistory,
  session,
  sourceUrl,
  syncRun,
}) => {
  const syncResult = await ingestProductTypeArtifact({
    sourceUrl,
    shop: session.shop,
    syncHistoryId: syncHistory.id,
    syncRunId: syncRun?.id || null,
  });

  await clearKeyCaches(`${session.shop}:storeDetails`);

  return syncResult.recordCount || 0;
};

export async function handleSyncOperation({ bulkOperationId, shop = null }) {
  let syncHistory = null;
  let finalizationClaimed = false;

  try {
    syncHistory = await getCompatibilitySyncHistoryForBulkOperation({
      bulkOperationId,
      shop,
    });

    if (!syncHistory) {
      return;
    }

    syncHistory = await ensureSyncBatchId(syncHistory);

    const claimedSyncHistory = await claimCompatibilitySyncHistoryFinalization(syncHistory);
    if (!claimedSyncHistory) {
      return {
        message: "sync finalization already claimed or completed",
        skipped: true,
      };
    }

    syncHistory = claimedSyncHistory;
    finalizationClaimed = true;

    const session = await getSession(syncHistory.shop);

    if (!session) {
      throw new Error(`No session found for shop ${syncHistory.shop}`);
    }

    const syncRun = await syncRunService
      .getSyncRunByBulkOperationId({ bulkOperationId })
      .catch(() => null);

    const queryMetadata = getBulkQueryMetadataForOperationType(
      syncHistory.operationType,
    );
    const monitorResult = await bulkOperationMonitorService.monitorBulkOperationOnce({
      session,
      shop: session.shop,
      syncRunId: syncRun?.id || null,
      bulkOperationId,
      pipelineVersion: queryMetadata?.pipelineVersion,
      schemaVersion: queryMetadata?.schemaVersion,
    });

    const { sourceUrl } = assertCompletedBulkOperation({ monitorResult });

    let recordCount = 0;

    if (syncHistory.operationType === OPERATION_TYPE.PRODUCT) {
      recordCount = await runProductIngest({
        syncHistory,
        session,
        sourceUrl,
        bulkOperationId,
        syncRun,
      });
    } else if (syncHistory.operationType === OPERATION_TYPE.COLLECTION) {
      recordCount = await runCollectionIngest({
        syncHistory,
        session,
        sourceUrl,
        syncRun,
      });
    } else if (syncHistory.operationType === OPERATION_TYPE.PRODUCT_TYPE) {
      recordCount = await runProductTypeIngest({
        syncHistory,
        session,
        sourceUrl,
        syncRun,
      });
    }

    await clearKeyCaches(`${session.shop}:sync_details`);

    return {
      message: "syncing completed",
      recordCount,
    };
  } catch (error) {
    if (finalizationClaimed) {
      await markCompatibilityFailure({
        syncHistory,
        error,
      });
    }

    throw error;
  }
}
