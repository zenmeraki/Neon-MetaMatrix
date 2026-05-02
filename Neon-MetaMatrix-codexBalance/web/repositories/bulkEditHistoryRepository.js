import { prisma } from "../config/database.js";
import {
  BULK_EDIT_EXECUTION_STATES,
  buildPlannedUndoState,
  isTerminalExecutionState,
  normalizeUndoState,
} from "../services/bulkEditExecutionStateService.js";

const DEFAULT_BATCH_SIZE = 75;
const MAX_BATCH_SIZE = 250;
const DEFAULT_LEASE_MS = 15 * 60 * 1000;

const FAILURE_STATES = [
  BULK_EDIT_EXECUTION_STATES.PLANNED,
  BULK_EDIT_EXECUTION_STATES.QUEUED,
  BULK_EDIT_EXECUTION_STATES.DISPATCHING,
  BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY,
  BULK_EDIT_EXECUTION_STATES.FINALIZING,
];

function getClient(db) {
  return db || prisma;
}

function assertIdAndShop(id, shop) {
  if (!id) throw new Error("editHistory id is required");
  if (!shop || typeof shop !== "string") throw new Error("shop is required");
}

function assertDate(value, fieldName) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${fieldName} must be a valid Date`);
  }
}

function assertNonNegativeInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
}

function normalizeBatch(batch) {
  if (!batch || typeof batch !== "object" || Array.isArray(batch)) {
    throw new Error("batch must be an object");
  }

  const size = Number.parseInt(batch.size, 10);
  if (!Number.isInteger(size) || size <= 0 || size > MAX_BATCH_SIZE) {
    throw new Error(`batch.size must be between 1 and ${MAX_BATCH_SIZE}`);
  }

  if (batch.lastProductId !== undefined && batch.lastProductId !== null && typeof batch.lastProductId !== "string") {
    throw new Error("batch.lastProductId must be a string when provided");
  }

  return {
    frozen: Boolean(batch.frozen),
    hasMore: Boolean(batch.hasMore),
    lastProductId: batch.lastProductId ?? null,
    size,
    previewCount: Number.isFinite(Number(batch.previewCount)) ? Number(batch.previewCount) : 0,
    currentBatchTargetCount: Number.isFinite(Number(batch.currentBatchTargetCount))
      ? Number(batch.currentBatchTargetCount)
      : 0,
    queuedAt: batch.queuedAt ?? null,
  };
}

function plannedBatch(batch = {}) {
  return normalizeBatch({
    frozen: false,
    hasMore: false,
    lastProductId: null,
    size: DEFAULT_BATCH_SIZE,
    previewCount: 0,
    currentBatchTargetCount: 0,
    ...batch,
  });
}

function buildUndoState(undo, executionIdentity = null) {
  return normalizeUndoState(
    undo,
    buildPlannedUndoState({
      allowed: false,
      executionIdentity,
    }),
  );
}

function assertCreateData(data = {}) {
  if (!data.shop || typeof data.shop !== "string") throw new Error("shop is required");
  if (!data.executionIdentity || typeof data.executionIdentity !== "string") {
    throw new Error("executionIdentity is required");
  }
  if (data.executionState && data.executionState !== BULK_EDIT_EXECUTION_STATES.PLANNED) {
    throw new Error("bulk edit history must be created in planned state");
  }
  if (data.status && data.status !== "pending") {
    throw new Error("bulk edit history must be created with pending status");
  }
  assertDate(data.startedAt, "startedAt");
  assertNonNegativeInteger(data.totalItems ?? 0, "totalItems");
}

function buildCreateData(data) {
  assertCreateData(data);

  return {
    shop: data.shop,
    title: data.title,
    queryFilter: data.queryFilter,
    rules: data.rules,
    startedAt: data.startedAt,
    status: "pending",
    executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
    executionIdentity: data.executionIdentity,
    processedCount: 0,
    totalItems: data.totalItems ?? 0,
    targetSnapshotCount: 0,
    targetMirrorBatchId: data.targetMirrorBatchId,
    targetSnapshotSetId: data.targetSnapshotSetId ?? null,
    durationMs: 0,
    batch: plannedBatch(data.batch),
    undo: buildUndoState(data.undo, data.executionIdentity),
    ...(data.locationId ? { locationId: data.locationId } : {}),
  };
}

function leaseUntil(now, leaseMs = DEFAULT_LEASE_MS) {
  assertDate(now, "now");
  return new Date(now.getTime() + leaseMs);
}

function durationFrom(startedAt, completedAt) {
  if (!startedAt || !completedAt) return 0;
  return Math.max(0, completedAt.getTime() - new Date(startedAt).getTime());
}

async function assertMirrorBatchForShop(client, shop, targetMirrorBatchId) {
  if (!targetMirrorBatchId) return;

  const product = await client.product.findFirst({
    where: { shop, mirrorBatchId: targetMirrorBatchId, deletedAt: null },
    select: { id: true },
  });

  if (!product) {
    throw new Error("targetMirrorBatchId does not reference an active catalog snapshot for shop");
  }
}

async function countTargetSnapshotRows(client, { id, shop, targetMirrorBatchId }) {
  return client.targetSnapshot.count({
    where: {
      ownerType: "EDIT_HISTORY",
      ownerId: id,
      shop,
      ...(targetMirrorBatchId ? { mirrorBatchId: targetMirrorBatchId } : {}),
    },
  });
}

const QUEUED_RETURN_SELECT = {
  id: true,
  shop: true,
  title: true,
  status: true,
  executionState: true,
  executionIdentity: true,
  executionLeaseUntil: true,
  executionLeaseOwner: true,
  executionAttemptCount: true,
  processedCount: true,
  totalItems: true,
  targetSnapshotCount: true,
  targetMirrorBatchId: true,
  targetSnapshotSetId: true,
  bulkOperationId: true,
  startedAt: true,
  completedAt: true,
  durationMs: true,
  batch: true,
  undo: true,
  error: true,
  failureStage: true,
  locationId: true,
  createdAt: true,
  updatedAt: true,
};

async function findSelectedByIdForShop(id, shop, select, db = prisma) {
  assertIdAndShop(id, shop);

  return getClient(db).editHistory.findFirst({
    where: { id, shop },
    select,
  });
}

export const bulkEditHistoryRepository = {
  async create(data, db = prisma) {
    const client = getClient(db);
    const createData = buildCreateData(data);
    await assertMirrorBatchForShop(client, createData.shop, createData.targetMirrorBatchId);

    return client.editHistory.upsert({
      where: { executionIdentity: createData.executionIdentity },
      create: createData,
      update: {},
    });
  },

  async findByIdForShop(id, shop, db = prisma) {
    return findSelectedByIdForShop(id, shop, QUEUED_RETURN_SELECT, db);
  },

  async findQueuedReturnByIdForShop(id, shop, db = prisma) {
    return findSelectedByIdForShop(id, shop, QUEUED_RETURN_SELECT, db);
  },

  async findTargetFreezePayloadByIdForShop(id, shop, db = prisma) {
    assertIdAndShop(id, shop);

    const history = await getClient(db).editHistory.findFirst({
      where: {
        id,
        shop,
        executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
      },
      select: {
        id: true,
        shop: true,
        executionState: true,
        executionIdentity: true,
        queryFilter: true,
        targetMirrorBatchId: true,
        targetSnapshotSetId: true,
        batch: true,
      },
    });

    if (!history) return null;
    await assertMirrorBatchForShop(getClient(db), shop, history.targetMirrorBatchId);
    return { ...history, batch: normalizeBatch(history.batch) };
  },

  async findPreparationPayloadByIdForShop(id, shop, db = prisma) {
    assertIdAndShop(id, shop);

    const history = await getClient(db).editHistory.findFirst({
      where: {
        id,
        shop,
        executionState: {
          in: [
            BULK_EDIT_EXECUTION_STATES.QUEUED,
            BULK_EDIT_EXECUTION_STATES.DISPATCHING,
          ],
        },
      },
      select: {
        id: true,
        shop: true,
        executionState: true,
        batch: true,
        rules: true,
        targetMirrorBatchId: true,
        targetSnapshotSetId: true,
        targetSnapshotCount: true,
        executionIdentity: true,
      },
    });

    if (!history) return null;
    return { ...history, batch: normalizeBatch(history.batch) };
  },

  async movePlannedToQueued(
    { id, shop, totalItems, targetSnapshotCount, targetSnapshotSetId = null, now, updatedAt = null },
    db = prisma,
  ) {
    assertIdAndShop(id, shop);
    assertDate(now, "now");
    assertNonNegativeInteger(totalItems, "totalItems");
    assertNonNegativeInteger(targetSnapshotCount, "targetSnapshotCount");

    const client = getClient(db);
    const history = await client.editHistory.findFirst({
      where: {
        id,
        shop,
        executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
        ...(updatedAt ? { updatedAt } : {}),
      },
      select: {
        id: true,
        shop: true,
        targetMirrorBatchId: true,
        batch: true,
      },
    });
    if (!history) return null;

    const frozenCount = await countTargetSnapshotRows(client, {
      id,
      shop,
      targetMirrorBatchId: history.targetMirrorBatchId,
    });
    if (frozenCount !== targetSnapshotCount) {
      throw new Error("targetSnapshotCount does not match frozen target snapshot count");
    }

    const batch = {
      ...normalizeBatch(history.batch),
      frozen: true,
      queuedAt: now.toISOString(),
    };

    const transition = await client.editHistory.updateMany({
      where: {
        id,
        shop,
        executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
        ...(updatedAt ? { updatedAt } : {}),
      },
      data: {
        totalItems,
        targetSnapshotCount,
        targetSnapshotSetId,
        batch,
        executionState: BULK_EDIT_EXECUTION_STATES.QUEUED,
      },
    });

    if (!transition.count) return null;
    return this.findQueuedReturnByIdForShop(id, shop, client);
  },

  async claimQueuedExecution({ id, shop, worker, now, leaseMs }, db = prisma) {
    assertIdAndShop(id, shop);
    assertDate(now, "now");
    if (!worker) throw new Error("worker is required");

    return getClient(db).editHistory.updateMany({
      where: {
        id,
        shop,
        executionState: BULK_EDIT_EXECUTION_STATES.QUEUED,
        OR: [
          { executionLeaseUntil: null },
          { executionLeaseUntil: { lt: now } },
        ],
      },
      data: {
        executionState: BULK_EDIT_EXECUTION_STATES.DISPATCHING,
        executionLeaseOwner: worker,
        executionLeaseUntil: leaseUntil(now, leaseMs),
        lastExecutionAttemptAt: now,
        executionAttemptCount: { increment: 1 },
      },
    });
  },

  async listStaleExecutions(shop, now, limit = 100, db = prisma) {
    if (!shop) throw new Error("shop is required");
    assertDate(now, "now");

    return getClient(db).editHistory.findMany({
      where: {
        shop,
        executionState: {
          in: [
            BULK_EDIT_EXECUTION_STATES.DISPATCHING,
            BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY,
            BULK_EDIT_EXECUTION_STATES.FINALIZING,
          ],
        },
        executionLeaseUntil: { lt: now },
      },
      select: QUEUED_RETURN_SELECT,
      orderBy: [{ executionLeaseUntil: "asc" }, { id: "asc" }],
      take: Math.min(Number.parseInt(limit, 10) || 100, 250),
    });
  },

  async updateBulkOperationId({ id, shop, bulkOperationId }, db = prisma) {
    assertIdAndShop(id, shop);
    if (!bulkOperationId) throw new Error("bulkOperationId is required");

    const transition = await getClient(db).editHistory.updateMany({
      where: {
        id,
        shop,
        executionState: {
          in: [
            BULK_EDIT_EXECUTION_STATES.DISPATCHING,
            BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY,
          ],
        },
        OR: [
          { bulkOperationId: null },
          { bulkOperationId },
        ],
      },
      data: {
        bulkOperationId,
        executionState: BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY,
      },
    });

    if (!transition.count) return null;
    return this.findQueuedReturnByIdForShop(id, shop, db);
  },

  async findByBulkOperationIdForShop(bulkOperationId, shop, db = prisma) {
    if (!bulkOperationId) throw new Error("bulkOperationId is required");
    if (!shop) throw new Error("shop is required");

    return getClient(db).editHistory.findFirst({
      where: { bulkOperationId, shop },
      select: QUEUED_RETURN_SELECT,
    });
  },

  async deleteById({ id, shop, now }, db = prisma) {
    assertIdAndShop(id, shop);
    assertDate(now, "now");

    return getClient(db).editHistory.updateMany({
      where: {
        id,
        shop,
        executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
      },
      data: {
        status: "cancelled",
        executionState: BULK_EDIT_EXECUTION_STATES.CANCELLED,
        completedAt: now,
      },
    });
  },

  async incrementProcessedCount({ id, shop, incrementBy, now }, db = prisma) {
    assertIdAndShop(id, shop);
    assertDate(now, "now");
    assertNonNegativeInteger(incrementBy, "incrementBy");

    return getClient(db).editHistory.updateMany({
      where: {
        id,
        shop,
        executionState: {
          in: [
            BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY,
            BULK_EDIT_EXECUTION_STATES.FINALIZING,
          ],
        },
      },
      data: {
        processedCount: { increment: incrementBy },
        lastExecutionAttemptAt: now,
      },
    });
  },

  async finalizeSuccess({ id, shop, processedCount = null, now }, db = prisma) {
    assertIdAndShop(id, shop);
    assertDate(now, "now");

    const history = await getClient(db).editHistory.findFirst({
      where: {
        id,
        shop,
        executionState: {
          in: [
            BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY,
            BULK_EDIT_EXECUTION_STATES.FINALIZING,
          ],
        },
      },
      select: { startedAt: true },
    });
    if (!history) return null;

    const transition = await getClient(db).editHistory.updateMany({
      where: {
        id,
        shop,
        executionState: {
          in: [
            BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY,
            BULK_EDIT_EXECUTION_STATES.FINALIZING,
          ],
        },
      },
      data: {
        status: "completed",
        executionState: BULK_EDIT_EXECUTION_STATES.COMPLETED,
        completedAt: now,
        durationMs: durationFrom(history.startedAt, now),
        executionLeaseUntil: null,
        executionLeaseOwner: null,
        ...(processedCount !== null ? { processedCount } : {}),
      },
    });

    if (!transition.count) return null;
    return this.findQueuedReturnByIdForShop(id, shop, db);
  },

  async markFailed({ id, shop, reason, stage = null, details = null, now }, db = prisma) {
    assertIdAndShop(id, shop);
    assertDate(now, "now");

    const history = await getClient(db).editHistory.findFirst({
      where: {
        id,
        shop,
        executionState: { in: FAILURE_STATES },
      },
      select: { startedAt: true },
    });
    if (!history) return null;

    return getClient(db).editHistory.updateMany({
      where: {
        id,
        shop,
        executionState: { in: FAILURE_STATES },
      },
      data: {
        status: "failed",
        executionState: BULK_EDIT_EXECUTION_STATES.FAILED,
        failureStage: stage,
        error: {
          message: reason || "Bulk edit failed",
          stage,
          details,
          occurredAt: now.toISOString(),
        },
        completedAt: now,
        durationMs: durationFrom(history.startedAt, now),
        executionLeaseUntil: null,
        executionLeaseOwner: null,
      },
    });
  },

  async transitionFromShopifyCallback({ id, shop, bulkOperationId, nextState, now }, db = prisma) {
    assertIdAndShop(id, shop);
    assertDate(now, "now");
    if (!bulkOperationId) throw new Error("bulkOperationId is required");
    if (isTerminalExecutionState(nextState)) {
      throw new Error("Use finalizeSuccess or markFailed for terminal states");
    }

    return getClient(db).editHistory.updateMany({
      where: {
        id,
        shop,
        bulkOperationId,
        executionState: BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY,
      },
      data: {
        executionState: nextState,
        lastExecutionAttemptAt: now,
      },
    });
  },

  async attachTargetSnapshotSet({ id, shop, targetSnapshotSetId, targetSnapshotCount, now }, db = prisma) {
    assertIdAndShop(id, shop);
    assertDate(now, "now");
    if (!targetSnapshotSetId) throw new Error("targetSnapshotSetId is required");
    assertNonNegativeInteger(targetSnapshotCount, "targetSnapshotCount");

    return getClient(db).editHistory.updateMany({
      where: {
        id,
        shop,
        executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
      },
      data: {
        targetSnapshotSetId,
        targetSnapshotCount,
        batch: {
          frozen: true,
          hasMore: false,
          lastProductId: null,
          size: DEFAULT_BATCH_SIZE,
          previewCount: targetSnapshotCount,
          currentBatchTargetCount: targetSnapshotCount,
          queuedAt: null,
          frozenAt: now.toISOString(),
        },
      },
    });
  },
};
