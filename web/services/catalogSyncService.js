import { getSession } from "../utils/sessionHandler.js";
import { getCurrentBulkOperationStatus } from "../modules/bulkOperations/bulkOperationHelper.js";
import { validateCatalogConsistency } from "./catalogConsistencyValidatorService.js";
import { runProductBulkFetch } from "./productService/productSyncGateway.js";
import { prisma } from "../config/database.js";
import { syncCatalogStartQueue } from "../jobs/queues/syncCatalogStartQueue.js";

const BULK_CONFLICT_RETRY_DELAY_MS = Math.max(
  Number(process.env.SYNC_CATALOG_BULK_CONFLICT_RETRY_DELAY_MS || 60_000),
  10_000,
);

async function deferCatalogSyncStart({ shop, syncRunId, currentBulkOperation }) {
  const message = "Waiting for Shopify bulk operation capacity.";
  const retryAt = new Date(Date.now() + BULK_CONFLICT_RETRY_DELAY_MS);

  await prisma.syncHistory.updateMany({
    where: {
      shop,
      OR: [
        { id: syncRunId },
        { syncBatchId: syncRunId },
      ],
      status: "processing",
    },
    data: {
      stage: "SHOPIFY_BULK_WAITING",
      executionState: "waiting_for_shopify_bulk_slot",
      errorMessage: `${message} Active bulk operation: ${currentBulkOperation?.id || "unknown"}`,
      lastHeartbeatAt: new Date(),
    },
  });

  await syncCatalogStartQueue.add(
    "sync.catalog.start",
    { shop, syncRunId },
    {
      jobId: `sync:start:${shop}:${syncRunId}:deferred:${retryAt.getTime()}`,
      delay: BULK_CONFLICT_RETRY_DELAY_MS,
      priority: 10,
    },
  );

  return {
    deferred: true,
    reason: "SHOPIFY_BULK_ALREADY_RUNNING",
    bulkOperationId: currentBulkOperation?.id || null,
    retryAt,
  };
}

function isShopifyBulkAlreadyRunningError(error) {
  if (error?.code === "SHOPIFY_BULK_ALREADY_RUNNING") return true;

  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("bulk") &&
    (message.includes("already running") ||
      message.includes("already in progress"))
  );
}

function syncRunWhere(shop, syncRunId) {
  return {
    shop,
    OR: [
      { id: syncRunId },
      { syncBatchId: syncRunId },
    ],
  };
}

export const catalogSyncService = {
  async startShopifyBulkOperation({ shop, syncRunId }) {
    const session = await getSession(shop);

    if (!session) {
      throw new Error("SHOP_SESSION_NOT_FOUND");
    }

    const syncHistory = await prisma.syncHistory.findFirst({
      where: syncRunWhere(shop, syncRunId),
      select: {
        id: true,
        syncBatchId: true,
        bulkOperationId: true,
      },
    });

    const currentBulkOperation = await getCurrentBulkOperationStatus(session, "QUERY");

    if (
      currentBulkOperation?.status === "RUNNING" &&
      currentBulkOperation.id === syncHistory?.bulkOperationId
    ) {
      return {
        skipped: true,
        alreadyRunning: true,
        bulkOperationId: currentBulkOperation.id,
        syncRunId,
      };
    }

    if (
      currentBulkOperation?.status === "RUNNING" &&
      currentBulkOperation.id !== syncHistory?.bulkOperationId
    ) {
      return deferCatalogSyncStart({
        shop,
        syncRunId,
        currentBulkOperation,
      });
    }

    let result;
    try {
      result = await runProductBulkFetch({ session });
    } catch (error) {
      if (isShopifyBulkAlreadyRunningError(error)) {
        const latestBulkOperation =
          await getCurrentBulkOperationStatus(session, "QUERY").catch(() => null);

        return deferCatalogSyncStart({
          shop,
          syncRunId,
          currentBulkOperation: latestBulkOperation,
        });
      }

      throw error;
    }

    await prisma.syncHistory.updateMany({
      where: syncRunWhere(shop, syncRunId),
      data: {
        bulkOperationId: result.bulkOperationId,
        stage: "SHOPIFY_BULK_RUNNING",
        executionState: "awaiting_shopify",
        errorMessage: null,
        lastHeartbeatAt: new Date(),
      },
    });

    return {
      ...result,
      syncRunId,
    };
  },

  async validateAndActivateSnapshot({ shop, syncRunId }) {
    const result = await validateCatalogConsistency({
      shop,
      mirrorBatchId: syncRunId,
    });

    if (result.status !== "READY") {
      const error = new Error(
        `Catalog consistency validation failed: ${(result.errors || []).join(", ")}`,
      );
      error.code = "CATALOG_INCONSISTENT";
      throw error;
    }

    return {
      ...result,
      activated: true,
      mirrorBatchId: syncRunId,
    };
  },
};
