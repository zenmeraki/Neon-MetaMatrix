import { OPERATION_TYPES } from "../constants/operationTypes.js";
import {
  claimDueScheduledEdits,
  scheduledEditRunRepository,
} from "../repositories/scheduledEditRunRepository.js";
import { storeOperationRepository } from "../repositories/storeOperationRepository.js";
import { prisma } from "../config/database.js";
import { startBulkEditOperationForHistory } from "./execution/bulkEditOperationStartService.js";
import {
  BULK_EDIT_EXECUTION_STATES,
  isTerminalExecutionState,
} from "./bulkEditExecutionStateService.js";

const SCHEDULED_ALLOWED_HISTORY_STATES = new Set([
  BULK_EDIT_EXECUTION_STATES.PLANNED,
  BULK_EDIT_EXECUTION_STATES.QUEUED,
  BULK_EDIT_EXECUTION_STATES.FAILED,
]);

export const scheduledEditService = {
  async claimDueRuns({ limit = 50 } = {}) {
    return claimDueScheduledEdits(limit);
  },

  async createOperationForRun({ shop, scheduledRunId }) {
    const run = await scheduledEditRunRepository.findById(scheduledRunId);

    if (!run || run.shop !== shop) {
      throw new Error("SCHEDULED_RUN_NOT_FOUND");
    }

    if (run.operationId) {
      const existingOperation = await storeOperationRepository.findById(run.operationId);
      if (existingOperation) return existingOperation;
    }

    const createClaim = await scheduledEditRunRepository.markCreating(
      scheduledRunId,
      shop,
    );

    if (createClaim.count !== 1) {
      const latestRun = await scheduledEditRunRepository.findById(scheduledRunId);
      if (latestRun?.operationId) {
        const existingOperation = await storeOperationRepository.findById(
          latestRun.operationId,
        );
        if (existingOperation) return existingOperation;
      }

      const error = new Error("SCHEDULED_RUN_ALREADY_PROCESSED");
      error.code = "SCHEDULED_RUN_ALREADY_PROCESSED";
      throw error;
    }

    const history = await prisma.editHistory.findFirst({
      where: {
        id: run.scheduledEditId,
        shop,
      },
      select: {
        id: true,
        shop: true,
        status: true,
        executionState: true,
        triggerType: true,
        scheduledTask: true,
        scheduledAt: true,
        scheduledUndoAt: true,
        queryFilter: true,
        rules: true,
        targetMirrorBatchId: true,
        totalItems: true,
        targetSnapshotCount: true,
        batch: true,
      },
    });

    if (!history) {
      await scheduledEditRunRepository.resetCreatingToClaimed(
        scheduledRunId,
        shop,
      );
      throw new Error("SCHEDULED_EDIT_HISTORY_NOT_FOUND");
    }

    if (isTerminalExecutionState(history.executionState)) {
      await scheduledEditRunRepository.resetCreatingToClaimed(
        scheduledRunId,
        shop,
      );
      const error = new Error("SCHEDULED_EDIT_HISTORY_TERMINAL_STATE");
      error.code = "SCHEDULED_EDIT_HISTORY_TERMINAL_STATE";
      throw error;
    }

    if (!SCHEDULED_ALLOWED_HISTORY_STATES.has(history.executionState)) {
      await scheduledEditRunRepository.resetCreatingToClaimed(
        scheduledRunId,
        shop,
      );
      const error = new Error("SCHEDULED_EDIT_HISTORY_NOT_DISPATCHABLE");
      error.code = "SCHEDULED_EDIT_HISTORY_NOT_DISPATCHABLE";
      throw error;
    }

    if (history.status !== "pending") {
      await scheduledEditRunRepository.resetCreatingToClaimed(
        scheduledRunId,
        shop,
      );
      const error = new Error("SCHEDULED_EDIT_HISTORY_STATUS_INVALID");
      error.code = "SCHEDULED_EDIT_HISTORY_STATUS_INVALID";
      throw error;
    }

    const isScheduledCompatible =
      history.triggerType === "SCHEDULED_ONCE" ||
      Boolean(history.scheduledTask) ||
      Boolean(history.scheduledAt) ||
      Boolean(history.scheduledUndoAt);

    if (!isScheduledCompatible) {
      await scheduledEditRunRepository.resetCreatingToClaimed(
        scheduledRunId,
        shop,
      );
      const error = new Error("SCHEDULED_EDIT_HISTORY_NOT_SCHEDULED_COMPATIBLE");
      error.code = "SCHEDULED_EDIT_HISTORY_NOT_SCHEDULED_COMPATIBLE";
      throw error;
    }

    try {
      const operation = await startBulkEditOperationForHistory({
        history,
        operationType: OPERATION_TYPES.SCHEDULED_EDIT,
        source: "SCHEDULED",
        userId: "system",
        clientRequestId: run.id,
        onStarted: async (startedOperation) => {
          const linked = await scheduledEditRunRepository.markStartedIfUnlinked(
            run.id,
            shop,
            startedOperation.id,
          );

          if (linked.count !== 1) {
            const error = new Error("SCHEDULED_RUN_LINK_FAILED");
            error.code = "SCHEDULED_RUN_LINK_FAILED";
            throw error;
          }
        },
      });

      const persistedRun = await scheduledEditRunRepository.findById(run.id);
      if (!persistedRun?.operationId) {
        const error = new Error("SCHEDULED_RUN_OPERATION_LINK_MISSING");
        error.code = "SCHEDULED_RUN_OPERATION_LINK_MISSING";
        throw error;
      }

      return operation;
    } catch (error) {
      await scheduledEditRunRepository.resetCreatingToClaimed(
        scheduledRunId,
        shop,
      );
      throw error;
    }
  },
};
