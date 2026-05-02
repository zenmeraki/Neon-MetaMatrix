import { prisma } from "../config/database.js";
import {
  BULK_EDIT_EXECUTION_STATES,
  buildPlannedUndoState,
  normalizeUndoState,
} from "../services/bulkEditExecutionStateService.js";

function getClient(db) {
  return db || prisma;
}

function normalizeBatch(batch) {
  if (!batch || typeof batch !== "object" || Array.isArray(batch)) {
    return {
      frozen: false,
      hasMore: false,
      lastProductId: null,
      size: 75,
      previewCount: 0,
      currentBatchTargetCount: 0,
    };
  }

  return {
    frozen: Boolean(batch.frozen),
    hasMore: Boolean(batch.hasMore),
    lastProductId: batch.lastProductId ?? null,
    size: Number.isInteger(batch.size) && batch.size > 0 ? batch.size : 75,
    previewCount:
      Number.isFinite(Number(batch.previewCount)) ? Number(batch.previewCount) : 0,
    currentBatchTargetCount:
      Number.isFinite(Number(batch.currentBatchTargetCount))
        ? Number(batch.currentBatchTargetCount)
        : 0,
    queuedAt: batch.queuedAt ?? null,
  };
}

function assertIdAndShop(id, shop) {
  if (!id) {
    throw new Error("editHistory id is required");
  }

  if (!shop) {
    throw new Error("shop is required");
  }
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

function buildCreateData(data) {
  return {
    shop: data.shop,
    title: data.title,
    queryFilter: data.queryFilter,
    rules: data.rules,
    startedAt: data.startedAt,
    status: data.status,
    executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
    executionIdentity: data.executionIdentity,
    processedCount: 0,
    totalItems: data.totalItems,
    targetSnapshotCount: 0,
    targetMirrorBatchId: data.targetMirrorBatchId,
    durationMs: 0,
    batch: normalizeBatch(data.batch),
    undo: buildUndoState(data.undo, data.executionIdentity),
    ...(data.locationId ? { locationId: data.locationId } : {}),
  };
}

const QUEUED_RETURN_SELECT = {
  id: true,
  shop: true,
  title: true,
  status: true,
  executionState: true,
  executionIdentity: true,
  processedCount: true,
  totalItems: true,
  targetSnapshotCount: true,
  targetMirrorBatchId: true,
  bulkOperationId: true,
  startedAt: true,
  completedAt: true,
  durationMs: true,
  batch: true,
  undo: true,
  locationId: true,
  createdAt: true,
  updatedAt: true,
};

const FIND_BY_ID_FOR_SHOP_SELECT = {
  ...QUEUED_RETURN_SELECT,
};

const MUTABLE_FAILURE_STATES = [
  BULK_EDIT_EXECUTION_STATES.PLANNED,
  BULK_EDIT_EXECUTION_STATES.QUEUED,
  BULK_EDIT_EXECUTION_STATES.DISPATCHING,
  BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY,
  BULK_EDIT_EXECUTION_STATES.FINALIZING,
];

async function findSelectedByIdForShop(id, shop, select, db = prisma) {
  assertIdAndShop(id, shop);

  return getClient(db).editHistory.findFirst({
    where: {
      id,
      shop,
    },
    select,
  });
}

export const bulkEditHistoryRepository = {
  async create(data, db = prisma) {
    return getClient(db).editHistory.create({
      data: buildCreateData(data),
    });
  },

  async findByIdForShop(id, shop, db = prisma) {
    return findSelectedByIdForShop(id, shop, FIND_BY_ID_FOR_SHOP_SELECT, db);
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
      },
      select: {
        shop: true,
        queryFilter: true,
        targetMirrorBatchId: true,
        batch: true,
      },
    });

    if (!history) return null;

    return {
      ...history,
      batch: normalizeBatch(history.batch),
    };
  },

  async findPreparationPayloadByIdForShop(id, shop, db = prisma) {
    assertIdAndShop(id, shop);

    const history = await getClient(db).editHistory.findFirst({
      where: {
        id,
        shop,
      },
      select: {
        shop: true,
        batch: true,
        rules: true,
        targetMirrorBatchId: true,
        targetSnapshotCount: true,
        executionIdentity: true,
      },
    });

    if (!history) return null;

    return {
      ...history,
      batch: normalizeBatch(history.batch),
    };
  },

  async movePlannedToQueued(
    { id, shop, totalItems, targetSnapshotCount },
    db = prisma,
  ) {
    assertIdAndShop(id, shop);

    return getClient(db).editHistory.updateMany({
      where: {
        id,
        shop,
        executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
      },
      data: {
        totalItems,
        targetSnapshotCount,
        executionState: BULK_EDIT_EXECUTION_STATES.QUEUED,
      },
    });
  },

  async updateBulkOperationId({ id, shop, bulkOperationId }, db = prisma) {
    assertIdAndShop(id, shop);

    if (!bulkOperationId) {
      throw new Error("bulkOperationId is required");
    }

    const existing = await getClient(db).editHistory.findUnique({
      where: { id },
      select: { id: true, shop: true },
    });

    if (!existing || existing.shop !== shop) {
      throw new Error("Edit history not found for shop");
    }

    return getClient(db).editHistory.update({
      where: {
        id,
      },
      data: {
        bulkOperationId,
      },
    });
  },

  async deleteById({ id, shop }, db = prisma) {
    assertIdAndShop(id, shop);

    return getClient(db).editHistory.deleteMany({
      where: {
        id,
        shop,
        executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
      },
    });
  },

  async markFailed({ id, shop, reason }, db = prisma) {
    assertIdAndShop(id, shop);

    return getClient(db).editHistory.updateMany({
      where: {
        id,
        shop,
        executionState: {
          in: MUTABLE_FAILURE_STATES,
        },
      },
      data: {
        status: "failed",
        executionState: BULK_EDIT_EXECUTION_STATES.FAILED,
        errorMessage: reason || "Bulk edit failed",
        completedAt: new Date(),
      },
    });
  },
};
