import { Worker } from "bullmq";
import { connection } from "../../config/redis.js";
import { updateProducts } from "../cron/scheduledEdit.js";
import { prisma } from "../../config/database.js";
import logger from "../../utils/loggerUtils.js";
import { logWorkerError } from "../../utils/errorLogUtils.js";
import {
  normalizeUndoState,
} from "../../services/bulkEditExecutionStateService.js";
import { scheduledEditRunRepository } from "../../repositories/scheduledEditRunRepository.js";
import { addDeadLetterJob } from "../queues/deadLetterQueue.js";
import { OPERATION_QUEUE_NAMES } from "../queues/operationQueueRegistry.js";
import { operationService } from "../../services/operationService.js";
import { editHistoryProjectionService } from "../../services/editHistoryProjectionService.js";

class ScheduledEditClaimSkipped extends Error {}

async function claimScheduledEdit(historyId, shop, scheduledRunId = null) {
  try {
    return await prisma.$transaction(async (tx) => {
      if (scheduledRunId) {
        const runClaim = await scheduledEditRunRepository.claimPending(
          scheduledRunId,
          {
            shop,
            scheduledEditId: historyId,
          },
          tx,
        );

        if (runClaim.count !== 1) {
          return false;
        }
      }

      const history = await tx.editHistory.findFirst({
        where: {
          id: historyId,
          shop,
        },
        select: {
          id: true,
          status: true,
          operationId: true,
        },
      });

      if (!history || history.status !== "pending") {
        throw new ScheduledEditClaimSkipped("scheduled edit already claimed");
      }

      if (!history.operationId) {
        throw new Error("SCHEDULED_EDIT_OPERATION_ID_REQUIRED");
      }

      await operationService.transitionOperation(
        {
          shop,
          operationId: history.operationId,
          from: "PLANNED",
          to: "SNAPSHOTTED",
          data: {
            startedAt: new Date(),
          },
        },
        tx,
      );

      await editHistoryProjectionService.syncFromOperation(
        {
          shop,
          operationId: history.operationId,
          editHistoryId: history.id,
        },
        tx,
      );

      return true;
    });
  } catch (error) {
    if (error instanceof ScheduledEditClaimSkipped) {
      return false;
    }

    throw error;
  }
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

  return true;
}

const scheduledEditWorker = new Worker(
  process.env.SCHEDULED_EDIT_QUEUE || OPERATION_QUEUE_NAMES.SCHEDULED_DISPATCH,
  async (job) => {
    const historyId = job.data?.historyId;
    const shop = job.data?.shop;
    const scheduledRunId = job.data?.scheduledRunId || null;
    const isUndo = job.name === "undo-task";

    if (!historyId || !shop) {
      throw new Error("scheduled-edit job requires historyId and shop");
    }

    try {
      const claimed = isUndo
        ? await claimScheduledUndo(historyId, shop)
        : await claimScheduledEdit(historyId, shop, scheduledRunId);

      if (!claimed) {
        return {
          skipped: true,
          reason: "already_claimed",
        };
      }

      return updateProducts(historyId, isUndo, shop, scheduledRunId);
    } catch (error) {
      if (scheduledRunId) {
        await scheduledEditRunRepository.markFailed(scheduledRunId, {
          errorCode: error.code || "SCHEDULED_EDIT_FAILED",
          errorMessage: error.message,
        }).catch(() => {});
      }

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

scheduledEditWorker.on("failed", async (job, error) => {
  logger.error("Scheduled edit worker failed", {
    worker: "scheduledEditWorker",
    jobId: job?.id,
    shop: job?.data?.shop,
    historyId: job?.data?.historyId,
    message: error.message,
  });

  await addDeadLetterJob("scheduled_failed", {
    job,
    error,
    reason: "scheduled_edit_failed",
  }).catch(() => {});
});

export default scheduledEditWorker;
