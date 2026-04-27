import { prisma } from "../../../config/database.js";
import { getBulkEditStatus } from "../../../utils/bulkOperationHelper.js";
import { getSession } from "../../../utils/sessionHandler.js";
import { clearKeyCaches } from "../../../utils/cacheUtils.js";
import { addbulkEditJob } from "../../../Jobs/Queues/bulkEditJob.js";
import {
  BULK_EDIT_EXECUTION_STATES,
  appendExecutionError,
  buildExecutionError,
} from "../../../services/bulkEditExecutionStateService.js";

export async function handleBulkEditOperation({ bulkOperationId, shop }) {
  const history = await prisma.editHistory.findFirst({
    where: {
      shop,
      bulkOperationId,
    },
  });

  if (!history) {
    return {
      handled: false,
      reason: "edit_history_not_found",
    };
  }

  if (
    ["completed", "failed", "partial", "cancelled"].includes(history.status) ||
    [
      BULK_EDIT_EXECUTION_STATES.COMPLETED,
      BULK_EDIT_EXECUTION_STATES.FAILED,
      BULK_EDIT_EXECUTION_STATES.PARTIAL,
      BULK_EDIT_EXECUTION_STATES.CANCELLED,
    ].includes(history.executionState)
  ) {
    return {
      handled: true,
      skipped: true,
      reason: "already_terminal",
      historyId: history.id,
    };
  }

  const session = await getSession(shop);
  const bulkOperation = await getBulkEditStatus(bulkOperationId, session);

  if (!bulkOperation) {
    throw new Error(`Bulk operation not found: ${bulkOperationId}`);
  }

  if (bulkOperation.errorCode) {
    await prisma.editHistory.update({
      where: { id: history.id },
      data: {
        status: "failed",
        executionState: BULK_EDIT_EXECUTION_STATES.FAILED,
        failureStage: "shopify_bulk_operation_failed",
        completedAt: new Date(),
        error: appendExecutionError(
          history.error,
          buildExecutionError({
            code: "shopify_bulk_operation_failed",
            stage: "awaiting_shopify",
            message: `Shopify bulk operation failed: ${bulkOperation.errorCode}`,
            retryable: false,
            details: {
              bulkOperationId,
              shopifyStatus: bulkOperation.status,
              errorCode: bulkOperation.errorCode,
            },
          }),
        ),
      },
    });

    return {
      handled: true,
      failed: true,
      historyId: history.id,
      bulkOperationId,
    };
  }

  if (bulkOperation.status !== "COMPLETED") {
    throw new Error(
      `Bulk edit operation is not completed yet. status=${bulkOperation.status}`,
    );
  }

  const batch = history.batch && typeof history.batch === "object" ? history.batch : {};
  const batchProcessedCount = Number(batch.currentBatchTargetCount || 0);
  const nextProcessedCount = Math.min(
    Number(history.processedCount || 0) + batchProcessedCount,
    Number(history.totalItems || batchProcessedCount),
  );

  if (history.processingBatchId) {
    await prisma.changeRecord.updateMany({
      where: {
        shop,
        editHistoryId: history.id,
        batchId: history.processingBatchId,
        status: "pending",
      },
      data: {
        status: "completed",
      },
    });
  }

  if (batch.hasMore) {
    await prisma.editHistory.update({
      where: { id: history.id },
      data: {
        status: "pending",
        executionState: BULK_EDIT_EXECUTION_STATES.QUEUED,
        bulkOperationId: null,
        processedCount: nextProcessedCount,
        processingBatchId: null,
        batch: {
          ...batch,
          currentBatchTargetCount: 0,
          currentBatchCount: 0,
          lastCompletedBulkOperationId: bulkOperationId,
          finalizedAt: new Date().toISOString(),
        },
      },
    });

    await addbulkEditJob(
      {
        historyId: history.id,
        shop,
        source: "bulk_edit_next_batch",
        executionId: history.executionIdentity,
      },
      {
        jobId: `bulk-edit:${history.id}:${Date.now()}`,
      },
    );

    await clearKeyCaches(`${shop}:fetchHistories`);
    await clearKeyCaches(`${shop}:historyDetails:${history.id}`);

    return {
      handled: true,
      historyId: history.id,
      queuedNextBatch: true,
      processedCount: nextProcessedCount,
    };
  }

  await prisma.editHistory.update({
    where: { id: history.id },
    data: {
      status: "completed",
      executionState: BULK_EDIT_EXECUTION_STATES.COMPLETED,
      processedCount: Number(history.totalItems || nextProcessedCount),
      completedAt: new Date(),
      processingBatchId: null,
      batch: {
        ...batch,
        hasMore: false,
        currentBatchTargetCount: 0,
        currentBatchCount: 0,
        lastCompletedBulkOperationId: bulkOperationId,
        finalizedAt: new Date().toISOString(),
      },
    },
  });

  await clearKeyCaches(`${shop}:fetchHistories`);
  await clearKeyCaches(`${shop}:historyDetails:${history.id}`);

  return {
    handled: true,
    historyId: history.id,
    completed: true,
    processedCount: Number(history.totalItems || nextProcessedCount),
  };
}