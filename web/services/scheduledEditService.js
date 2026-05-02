import { OPERATION_TYPES } from "../constants/operationTypes.js";
import {
  claimDueScheduledEdits,
  scheduledEditRunRepository,
} from "../repositories/scheduledEditRunRepository.js";
import { storeOperationRepository } from "../repositories/storeOperationRepository.js";
import { prisma } from "../config/database.js";
import { startBulkEditOperationForHistory } from "./execution/bulkEditOperationStartService.js";

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

    const history = await prisma.editHistory.findFirst({
      where: {
        id: run.scheduledEditId,
        shop,
      },
    });

    if (!history) {
      throw new Error("SCHEDULED_EDIT_HISTORY_NOT_FOUND");
    }

    const operation = await startBulkEditOperationForHistory({
      history,
      operationType: OPERATION_TYPES.SCHEDULED_EDIT,
      source: "SCHEDULED",
      userId: "system",
      clientRequestId: run.id,
    });

    await scheduledEditRunRepository.markStarted(run.id, operation.id);

    return operation;
  },
};
