import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import { updateProducts } from "../Cron/scheduledEdit.js";
import { prisma } from "../../config/database.js";
import logger from "../../utils/loggerUtils.js";
import { logWorkerError } from "../../utils/errorLogUtils.js";
import {
  BULK_EDIT_EXECUTION_STATES,
  BULK_UNDO_STATES,
  normalizeUndoState,
} from "../../services/bulkEditExecutionStateService.js";
import { assertValidTransition } from "../../services/execution/executionStateMachine.js";
import { storeExecutionLockService } from "../../services/execution/storeExecutionLockService.js";

async function claimScheduledEdit(historyId, shop) {
  const history = await prisma.editHistory.findFirst({
    where: { id: historyId, shop },
    select: { executionState: true },
  });

  if (!history) return false;

  assertValidTransition({
    from: history.executionState,
    to: BULK_EDIT_EXECUTION_STATES.QUEUED,
  });

  const result = await prisma.editHistory.updateMany({
    where: {
      id: historyId,
      shop,
      status: "pending",
      executionState: history.executionState,
    },
    data: {
      status: "processing",
      executionState: BULK_EDIT_EXECUTION_STATES.QUEUED,
    },
  });

  return result.count === 1;
}

async function claimScheduledUndo(historyId, shop) {
  const history = await prisma.editHistory.findFirst({
    where: {
      id: historyId,
      shop,
    },
    select: { undo: true },
  });

  const undo = normalizeUndoState(history?.undo);
  if (!undo.allowed || ["processing", "completed"].includes(undo.status)) {
    return false;
  }

  assertValidTransition({
    from: undo.state || BULK_UNDO_STATES.PLANNED,
    to: BULK_UNDO_STATES.QUEUED,
  });

  await prisma.editHistory.updateMany({
    where: {
      id: historyId,
      shop,
    },
    data: {
      undo: {
        ...undo,
        status: "pending",
        state: BULK_UNDO_STATES.QUEUED,
        queuedAt: new Date(),
      },
    },
  });

  return true;
}

const scheduledEditWorker = new Worker(
  "scheduled-edit-queue",
  async (job) => {
    const historyId = job.data?.historyId;
    const shop = job.data?.shop;
    const isUndo = job.name === "undo-task";

    if (!historyId || !shop) {
      throw new Error("scheduled-edit job requires historyId and shop");
    }

    try {
      const writeLock = await storeExecutionLockService.acquireWriteLock({
        shop,
        operationId: historyId,
      });

      if (!writeLock.acquired) {
        return {
          skipped: true,
          reason: writeLock.reason,
        };
      }

      const claimed = isUndo
        ? await claimScheduledUndo(historyId, shop)
        : await claimScheduledEdit(historyId, shop);

      if (!claimed) {
        return {
          skipped: true,
          reason: "already_claimed",
        };
      }

      return updateProducts(historyId, isUndo, shop);
    } catch (error) {
      await logWorkerError({
        shop,
        err: error,
        source: "scheduledEditWorker",
      });
      throw error;
    }
  },
  { connection, concurrency: 1 },
);

scheduledEditWorker.on("failed", (job, error) => {
  logger.error("Scheduled edit worker failed", {
    worker: "scheduledEditWorker",
    jobId: job?.id,
    shop: job?.data?.shop,
    historyId: job?.data?.historyId,
    message: error.message,
  });
});

export default scheduledEditWorker;
