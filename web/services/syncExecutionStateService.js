import { prisma } from "../config/database.js";
import { clearKeyCaches } from "../utils/cacheUtils.js";

export const SYNC_EXECUTION_STATES = {
  PLANNED: "planned",
  SHOPIFY_BULK_RUNNING: "shopify_bulk_running",
  FINALIZING: "finalizing",
  COMPLETED: "completed",
  FAILED: "failed",
};

async function getSyncHistoryExecutionRow({
  syncHistoryId,
  shop,
  client = prisma,
}) {
  const rows = await client.$queryRaw`
    SELECT
      "id",
      "shop",
      "operationType",
      "status",
      "stage",
      "executionState",
      "executionIdentity",
      "lastHeartbeatAt",
      "completedAt",
      "errorSummary",
      "createdAt",
      "updatedAt"
    FROM "SyncHistory"
    WHERE "id" = ${syncHistoryId}
      AND "shop" = ${shop}
    LIMIT 1
  `;

  return rows?.[0] || null;
}

async function clearStoreSyncCaches(shop) {
  await Promise.all([
    clearKeyCaches(`${shop}:sync_details`),
    clearKeyCaches(`${shop}:storeDetails`),
  ]).catch(() => {});
}

function buildStoreProjectionFromExecution(syncHistory) {
  if (!syncHistory) {
    return null;
  }

  const executionState = syncHistory.executionState || SYNC_EXECUTION_STATES.PLANNED;
  const operationType = syncHistory.operationType || null;

  if (operationType === "Product") {
    if (executionState === SYNC_EXECUTION_STATES.SHOPIFY_BULK_RUNNING) {
      return {
        isProductSyncing: true,
        syncProgressStage: "SHOPIFY_BULK_RUNNING",
        shopifyBulkJobCompleted: false,
      };
    }

    if (executionState === SYNC_EXECUTION_STATES.FINALIZING) {
      return {
        isProductSyncing: true,
        syncProgressStage: "MIRROR_STAGING",
        shopifyBulkJobCompleted: false,
      };
    }

    if (executionState === SYNC_EXECUTION_STATES.COMPLETED) {
      return {
        isProductSyncing: false,
        isProductInitialySyning: false,
        syncProgressStage: "IDLE",
        shopifyBulkJobCompleted: true,
        lastProductSyncAt: syncHistory.completedAt || new Date(),
      };
    }

    if (executionState === SYNC_EXECUTION_STATES.FAILED) {
      return {
        isProductSyncing: false,
        isProductInitialySyning: false,
        syncProgressStage: "IDLE",
      };
    }
  }

  if (operationType === "Collection") {
    if (
      executionState === SYNC_EXECUTION_STATES.SHOPIFY_BULK_RUNNING ||
      executionState === SYNC_EXECUTION_STATES.FINALIZING
    ) {
      return {
        isCollectionSyncing: true,
      };
    }

    if (executionState === SYNC_EXECUTION_STATES.COMPLETED) {
      return {
        isCollectionSyncing: false,
        lastCollectionSyncAt: syncHistory.completedAt || new Date(),
      };
    }

    if (executionState === SYNC_EXECUTION_STATES.FAILED) {
      return {
        isCollectionSyncing: false,
      };
    }
  }

  return null;
}

export async function projectSyncExecutionToStore({
  syncHistoryId,
  shop,
  client = prisma,
}) {
  const syncHistory = await getSyncHistoryExecutionRow({
    syncHistoryId,
    shop,
    client,
  });

  const projection = buildStoreProjectionFromExecution(syncHistory);
  if (!projection) {
    return syncHistory;
  }

  await client.store.update({
    where: { shopUrl: shop },
    data: projection,
  });

  await clearStoreSyncCaches(shop);

  return syncHistory;
}

export async function reconcileStoreSyncProjection({
  shop,
  operationType = "Product",
  client = prisma,
}) {
  const syncHistory = await client.syncHistory.findFirst({
    where: {
      shop,
      operationType,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      shop: true,
      operationType: true,
      status: true,
      stage: true,
      executionState: true,
      executionIdentity: true,
      lastHeartbeatAt: true,
      completedAt: true,
      errorSummary: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!syncHistory && operationType === "Product") {
    await client.store.update({
      where: { shopUrl: shop },
      data: {
        isProductSyncing: false,
        isProductInitialySyning: false,
        syncProgressStage: "IDLE",
      },
    });
    await clearStoreSyncCaches(shop);
    return null;
  }

  if (!syncHistory && operationType === "Collection") {
    await client.store.update({
      where: { shopUrl: shop },
      data: {
        isCollectionSyncing: false,
      },
    });
    await clearStoreSyncCaches(shop);
    return null;
  }

  const projection = buildStoreProjectionFromExecution(syncHistory);
  if (projection) {
    await client.store.update({
      where: { shopUrl: shop },
      data: projection,
    });
    await clearStoreSyncCaches(shop);
  }

  return syncHistory;
}

export async function initializeSyncExecution({
  syncHistoryId,
  shop,
  executionIdentity,
  state = SYNC_EXECUTION_STATES.SHOPIFY_BULK_RUNNING,
  client = prisma,
}) {
  await client.$executeRaw`
    UPDATE "SyncHistory"
    SET
      "executionState" = ${state},
      "executionIdentity" = ${executionIdentity},
      "lastHeartbeatAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${syncHistoryId}
      AND "shop" = ${shop}
  `;

  await projectSyncExecutionToStore({
    syncHistoryId,
    shop,
    client,
  });
}

export async function updateSyncExecutionState({
  syncHistoryId,
  shop,
  state,
  stage = null,
  completed = false,
  client = prisma,
}) {
  await client.$executeRaw`
    UPDATE "SyncHistory"
    SET
      "executionState" = ${state},
      "stage" = COALESCE(${stage}, "stage"),
      "lastHeartbeatAt" = CURRENT_TIMESTAMP,
      "completedAt" = CASE WHEN ${completed} THEN CURRENT_TIMESTAMP ELSE "completedAt" END
    WHERE "id" = ${syncHistoryId}
      AND "shop" = ${shop}
  `;

  await projectSyncExecutionToStore({
    syncHistoryId,
    shop,
    client,
  });
}

export async function markSyncExecutionFailed({
  syncHistoryId,
  shop,
  errorSummary = null,
  client = prisma,
}) {
  await client.$executeRaw`
    UPDATE "SyncHistory"
    SET
      "executionState" = ${SYNC_EXECUTION_STATES.FAILED},
      "stage" = 'FAILED',
      "errorSummary" = COALESCE(${errorSummary}, "errorSummary"),
      "lastHeartbeatAt" = CURRENT_TIMESTAMP,
      "completedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${syncHistoryId}
      AND "shop" = ${shop}
  `;

  await projectSyncExecutionToStore({
    syncHistoryId,
    shop,
    client,
  });
}
