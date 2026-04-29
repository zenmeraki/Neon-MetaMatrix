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
  buildPlannedUndoState,
} from "../../services/bulkEditExecutionStateService.js";
import { addbulkUndoJob } from "../../Jobs/Queues/bulkUndoJob.js";
import crypto from "crypto";

import { clearKeyCaches } from "../../utils/cacheUtils.js";

async function claimScheduledEdit(historyId, shop) {
  const result = await prisma.editHistory.updateMany({
    where: {
      id: historyId,
      shop,
      status: "pending",
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
      status: "completed", // important
    },
    select: {
      undo: true,
    },
  });

  if (!history) return false;

  const undo = normalizeUndoState(
    history.undo,
    buildPlannedUndoState({ allowed: false }),
  );

  if (!undo.allowed) return false;

  if (
    [
      BULK_UNDO_STATES.QUEUED,
      BULK_UNDO_STATES.DISPATCHING,
      BULK_UNDO_STATES.AWAITING_SHOPIFY,
      BULK_UNDO_STATES.FINALIZING,
      BULK_UNDO_STATES.COMPLETED,
    ].includes(undo.state)
  ) {
    return false;
  }

  const executionIdentity = undo.executionIdentity || crypto.randomUUID();

  const updated = await prisma.editHistory.updateMany({
    where: {
      id: historyId,
      shop,
      status: "completed",
    },
    data: {
      undo: {
        ...undo,
        status: "pending",
        state: BULK_UNDO_STATES.QUEUED,
        queuedAt: new Date(),
        startedAt: null,
        completedAt: null,
        processedCount: 0,
        durationMs: 0,
        bulkOperationId: null,
        executionIdentity,
        error: null,
      },
    },
  });

  if (!updated.count) return false;

  await clearKeyCaches(`${shop}:fetchHistories`);
  await clearKeyCaches(`${shop}:historyDetails:${historyId}`);

  await addbulkUndoJob({
    historyId,
    shop,
    source: "scheduled_undo",
    executionId: executionIdentity,
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
      const claimed = isUndo
        ? await claimScheduledUndo(historyId, shop)
        : await claimScheduledEdit(historyId, shop);

      if (!claimed) {
        return {
          skipped: true,
          reason: "already_claimed",
        };
      }

      if (isUndo) {
  return { success: true, type: "scheduled_undo_enqueued" };
}

return updateProducts(historyId, false, shop);
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