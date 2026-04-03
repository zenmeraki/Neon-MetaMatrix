import { prisma } from "../config/database.js";
import { getSession } from "../utils/sessionHandler.js";
import { recordMirrorAnomaly } from "./mirrorAnomalyService.js";
import { markRepairRequired, MIRROR_STALE_REASONS } from "./mirrorHealthService.js";
import {
  markSyncExecutionFailed,
  reconcileStoreSyncProjection,
  updateSyncExecutionState,
  SYNC_EXECUTION_STATES,
} from "./syncExecutionStateService.js";
import { addShopSyncJob } from "../Jobs/Queues/shopSyncJob.js";
import { addbulkOperatonQueryJob } from "../Jobs/Queues/bulkOperationQueryJob.js";
import { clearKeyCaches } from "../utils/cacheUtils.js";
import shopify from "../shopify.js";

export const SYNC_FINALIZING_STALE_MS = 30 * 60 * 1000;
export const SYNC_BULK_RUNNING_STALE_MS = 2 * 60 * 60 * 1000;

function toDate(value) {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isStaleSyncExecution(syncHistory) {
  if (!syncHistory) {
    return false;
  }

  const heartbeatAt = toDate(syncHistory.lastHeartbeatAt) || toDate(syncHistory.updatedAt);
  if (!heartbeatAt) {
    return false;
  }

  const ageMs = Date.now() - heartbeatAt.getTime();
  if (syncHistory.executionState === SYNC_EXECUTION_STATES.FINALIZING) {
    return ageMs > SYNC_FINALIZING_STALE_MS;
  }

  if (syncHistory.executionState === SYNC_EXECUTION_STATES.SHOPIFY_BULK_RUNNING) {
    return ageMs > SYNC_BULK_RUNNING_STALE_MS;
  }

  return false;
}

export async function getLatestSyncExecutionSummary(shop, operationType = null) {
  return prisma.syncHistory.findFirst({
    where: {
      shop,
      ...(operationType ? { operationType } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      shop: true,
      bulkOperationId: true,
      syncBatchId: true,
      status: true,
      stage: true,
      executionState: true,
      executionIdentity: true,
      lastHeartbeatAt: true,
      completedAt: true,
      errorSummary: true,
      operationType: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

async function fetchBulkOperationState(session, bulkOperationId) {
  const client = new shopify.api.clients.Graphql({ session });
  const response = await client.query({
    data: {
      query: `
        query GetSyncRepairBulkOperation($id: ID!) {
          node(id: $id) {
            ... on BulkOperation {
              id
              status
              errorCode
              type
            }
          }
        }
      `,
      variables: {
        id: bulkOperationId,
      },
    },
  });

  return response?.body?.data?.node || null;
}

function mapOperationTypeToRepairSyncType(operationType) {
  if (operationType === "Collection") {
    return "collection";
  }

  if (operationType === "Product") {
    return "product";
  }

  return null;
}

async function enqueueRepairSync(syncHistory, reason) {
  const syncType = mapOperationTypeToRepairSyncType(syncHistory.operationType);
  if (!syncType) {
    return;
  }

  await addShopSyncJob({
    shop: syncHistory.shop,
    syncType,
    reason,
  });
}

async function handleFinalizingStall(syncHistory) {
  await markSyncExecutionFailed({
    syncHistoryId: syncHistory.id,
    shop: syncHistory.shop,
    errorSummary: "Sync finalization heartbeat expired; scheduling repair sync",
  });

  await markRepairRequired({
    shop: syncHistory.shop,
    reason: MIRROR_STALE_REASONS.PARTIAL_MIRROR_DETECTED,
    summary: "Mirror finalization stalled; repair sync required",
    severity: "high",
    details: {
      syncHistoryId: syncHistory.id,
      operationType: syncHistory.operationType,
      bulkOperationId: syncHistory.bulkOperationId,
    },
  }).catch(() => {});

  await enqueueRepairSync(syncHistory, "stuck_sync_finalizing");
  await reconcileStoreSyncProjection({
    shop: syncHistory.shop,
    operationType: syncHistory.operationType,
  }).catch(() => {});
}

async function handleBulkRunningStall(syncHistory) {
  if (!syncHistory.bulkOperationId) {
    await markSyncExecutionFailed({
      syncHistoryId: syncHistory.id,
      shop: syncHistory.shop,
      errorSummary: "Sync stalled without bulkOperationId; scheduling repair sync",
    });
    await enqueueRepairSync(syncHistory, "stuck_sync_missing_bulk_operation");
    await reconcileStoreSyncProjection({
      shop: syncHistory.shop,
      operationType: syncHistory.operationType,
    }).catch(() => {});
    return;
  }

  const session = await getSession(syncHistory.shop).catch(() => null);
  if (!session) {
    await markSyncExecutionFailed({
      syncHistoryId: syncHistory.id,
      shop: syncHistory.shop,
      errorSummary: "Sync stalled and no session was available for recovery",
    });
    await reconcileStoreSyncProjection({
      shop: syncHistory.shop,
      operationType: syncHistory.operationType,
    }).catch(() => {});
    return;
  }

  const bulkOperation = await fetchBulkOperationState(session, syncHistory.bulkOperationId).catch(() => null);
  if (!bulkOperation) {
    await markSyncExecutionFailed({
      syncHistoryId: syncHistory.id,
      shop: syncHistory.shop,
      errorSummary: "Sync stalled and Shopify bulk operation could not be loaded",
    });
    await enqueueRepairSync(syncHistory, "stuck_sync_bulk_lookup_failed");
    await reconcileStoreSyncProjection({
      shop: syncHistory.shop,
      operationType: syncHistory.operationType,
    }).catch(() => {});
    return;
  }

  if (bulkOperation.status === "COMPLETED") {
    await addbulkOperatonQueryJob({
      shop: syncHistory.shop,
      admin_graphql_api_id: syncHistory.bulkOperationId,
      status: bulkOperation.status,
      type: bulkOperation.type || "QUERY",
      recoverySource: "stuck_sync_repair",
    });
    await updateSyncExecutionState({
      syncHistoryId: syncHistory.id,
      shop: syncHistory.shop,
      state: SYNC_EXECUTION_STATES.FINALIZING,
      stage: "FINALIZING",
    }).catch(() => {});
    return;
  }

  if (bulkOperation.status === "RUNNING" || bulkOperation.status === "CREATED") {
    await updateSyncExecutionState({
      syncHistoryId: syncHistory.id,
      shop: syncHistory.shop,
      state: SYNC_EXECUTION_STATES.SHOPIFY_BULK_RUNNING,
      stage: "SHOPIFY_BULK_RUNNING",
    });
    return;
  }

  await markSyncExecutionFailed({
    syncHistoryId: syncHistory.id,
    shop: syncHistory.shop,
    errorSummary: `Shopify bulk operation ended in ${bulkOperation.status || "unknown"}; repair sync required`,
  });
  await enqueueRepairSync(syncHistory, "stuck_sync_bulk_failed");
  await reconcileStoreSyncProjection({
    shop: syncHistory.shop,
    operationType: syncHistory.operationType,
  }).catch(() => {});
}

async function reconcileStoreSyncProjections() {
  const stores = await prisma.store.findMany({
    where: {
      OR: [
        { isProductSyncing: true },
        { isCollectionSyncing: true },
        { syncProgressStage: { not: "IDLE" } },
      ],
    },
    select: {
      shopUrl: true,
      isProductSyncing: true,
      isCollectionSyncing: true,
      syncProgressStage: true,
    },
    take: 50,
  });

  let reconciled = 0;

  for (const store of stores) {
    const latestProductSync = await reconcileStoreSyncProjection({
      shop: store.shopUrl,
      operationType: "Product",
    }).catch(() => null);

    if (!latestProductSync && store.isProductSyncing) {
      await markRepairRequired({
        shop: store.shopUrl,
        reason: MIRROR_STALE_REASONS.PARTIAL_MIRROR_DETECTED,
        summary: "Store sync projection was stale and had no active sync execution",
        severity: "medium",
        details: {
          source: "sync_projection_reconciler",
        },
      }).catch(() => {});
    }

    await reconcileStoreSyncProjection({
      shop: store.shopUrl,
      operationType: "Collection",
    }).catch(() => {});

    reconciled += 1;
  }

  return reconciled;
}

export async function repairStuckSyncs() {
  const rows = await prisma.$queryRaw`
    SELECT
      "id",
      "shop",
      "bulkOperationId",
      "syncBatchId",
      "status",
      "stage",
      "executionState",
      "executionIdentity",
      "lastHeartbeatAt",
      "completedAt",
      "errorSummary",
      "operationType",
      "createdAt",
      "updatedAt"
    FROM "SyncHistory"
    WHERE "status" = 'processing'
      AND "executionState" IN ('shopify_bulk_running', 'finalizing')
    ORDER BY "updatedAt" ASC
    LIMIT 25
  `;

  let repaired = 0;
  let resumed = 0;
  let skipped = 0;

  for (const syncHistory of rows) {
    if (!isStaleSyncExecution(syncHistory)) {
      skipped += 1;
      continue;
    }

    try {
      if (syncHistory.executionState === SYNC_EXECUTION_STATES.FINALIZING) {
        await handleFinalizingStall(syncHistory);
        repaired += 1;
      } else {
        const before = repaired;
        await handleBulkRunningStall(syncHistory);
        if (before === repaired) {
          resumed += 1;
        }
      }

      await clearKeyCaches(`${syncHistory.shop}:sync_details`).catch(() => {});
    } catch (error) {
      await recordMirrorAnomaly({
        shop: syncHistory.shop,
        severity: "high",
        type: "stuck_sync_repair_failure",
        entityType: "syncHistory",
        entityId: syncHistory.id,
        message: error.message,
        details: {
          executionState: syncHistory.executionState,
          bulkOperationId: syncHistory.bulkOperationId,
        },
      }).catch(() => {});
    }
  }

  const projectionReconciled = await reconcileStoreSyncProjections().catch(() => 0);

  return {
    scanned: rows.length,
    repaired,
    resumed,
    skipped,
    projectionReconciled,
  };
}
