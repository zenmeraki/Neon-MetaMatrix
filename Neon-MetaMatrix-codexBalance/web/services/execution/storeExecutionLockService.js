import { prisma } from "../../config/database.js";

const CONFLICTING_WRITE_STATES = [
  "queued",
  "freezing",
  "frozen",
  "dispatching",
  "awaiting_shopify",
  "finalizing",
  "running",
  "QUEUED",
  "FREEZING",
  "FROZEN",
  "DISPATCHING",
  "AWAITING_SHOPIFY",
  "FINALIZING",
  "RUNNING",
];

export const storeExecutionLockService = {
  async assertNoConflictingWrite({
    shop,
    excludeHistoryId = null,
    excludeUndoExecutionIdentity = null,
  }) {
    const activeEdit = await prisma.editHistory.findFirst({
      where: {
        shop,
        ...(excludeHistoryId ? { id: { not: excludeHistoryId } } : {}),
        executionState: { in: CONFLICTING_WRITE_STATES },
      },
      select: { id: true, executionState: true },
    });

    if (activeEdit) {
      return {
        allowed: false,
        reason: "ACTIVE_BULK_EDIT",
        entityId: activeEdit.id,
        state: activeEdit.executionState,
      };
    }

    const activeUndo = await prisma.bulkUndoExecution.findFirst({
      where: {
        shop,
        ...(excludeUndoExecutionIdentity
          ? { executionIdentity: { not: excludeUndoExecutionIdentity } }
          : {}),
        state: { in: CONFLICTING_WRITE_STATES },
      },
      select: {
        id: true,
        historyId: true,
        state: true,
      },
    });

    if (activeUndo) {
      return {
        allowed: false,
        reason: "ACTIVE_BULK_UNDO",
        entityId: activeUndo.id,
        historyId: activeUndo.historyId,
        state: activeUndo.state,
      };
    }

    return { allowed: true };
  },

  async acquireWriteLock({
    shop,
    operationId,
    excludeUndoExecutionIdentity = null,
  }) {
    const conflict = await this.assertNoConflictingWrite({
      shop,
      excludeHistoryId: operationId,
      excludeUndoExecutionIdentity,
    });

    if (!conflict.allowed) {
      return {
        acquired: false,
        ...conflict,
      };
    }

    return {
      acquired: true,
      lockKey: `write:${shop}:${operationId}`,
    };
  },

  async releaseWriteLock() {
    return { released: true };
  },
};

export { CONFLICTING_WRITE_STATES };
