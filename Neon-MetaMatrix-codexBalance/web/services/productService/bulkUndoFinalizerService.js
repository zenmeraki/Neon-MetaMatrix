import axios from "axios";
import readline from "readline";
import { prisma } from "../../config/database.js";
import { bulkUndoExecutionRepository, UNDO_EXECUTION_STATES } from "../../repositories/bulkUndoExecutionRepository.js";
import { getBulkEditStatus } from "../../utils/bulkOperationHelper.js";
import { getSession } from "../../utils/sessionHandler.js";
import {
  BULK_UNDO_STATES,
  buildExecutionError,
  normalizeUndoState,
} from "../bulkEditExecutionStateService.js";

function parseUserErrors(payload) {
  const errors =
    payload?.data?.productSet?.userErrors ||
    payload?.productSet?.userErrors ||
    payload?.userErrors ||
    [];

  return Array.isArray(errors) ? errors : [];
}

function readProductId(payload) {
  return (
    payload?.data?.productSet?.product?.id ||
    payload?.productSet?.product?.id ||
    payload?.product?.id ||
    null
  );
}

async function streamJsonl(url, onLine) {
  const response = await axios.get(url, {
    responseType: "stream",
    timeout: 120_000,
  });

  const rl = readline.createInterface({
    input: response.data,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    await onLine(JSON.parse(line));
  }
}

function mapExecutionStateToUndoState(state) {
  if (state === UNDO_EXECUTION_STATES.COMPLETED) return BULK_UNDO_STATES.COMPLETED;
  if (state === UNDO_EXECUTION_STATES.PARTIAL) return BULK_UNDO_STATES.PARTIAL;
  return BULK_UNDO_STATES.FAILED;
}

async function updateEditHistoryUndo({
  tx,
  shop,
  execution,
  finalState,
  completedAt,
  processedCount,
  bulkOperationId,
  error,
}) {
  const history = await tx.editHistory.findFirst({
    where: {
      id: execution.historyId,
      shop,
    },
    select: { undo: true },
  });

  const undo = normalizeUndoState(history?.undo);
  const undoState = mapExecutionStateToUndoState(finalState);

  await tx.editHistory.updateMany({
    where: {
      id: execution.historyId,
      shop,
    },
    data: {
      undoState,
      undoCompletedAt: completedAt,
      undo: {
        ...undo,
        status:
          undoState === BULK_UNDO_STATES.COMPLETED
            ? "completed"
            : undoState === BULK_UNDO_STATES.PARTIAL
              ? "partial"
              : "failed",
        state: undoState,
        completedAt,
        processedCount,
        bulkOperationId,
        error,
      },
    },
  });
}

async function markUndoFailed({ shop, execution, errorCode, message }) {
  const completedAt = new Date();

  await prisma.$transaction(async (tx) => {
    const dispatched = await tx.bulkUndoDispatchProduct.findMany({
      where: {
        shop,
        executionIdentity: execution.executionIdentity,
        status: "DISPATCHED",
      },
      select: { targetIds: true },
    });
    const targetIds = dispatched.flatMap((product) => product.targetIds);

    await tx.bulkUndoDispatchProduct.updateMany({
      where: {
        shop,
        executionIdentity: execution.executionIdentity,
        status: "DISPATCHED",
      },
      data: {
        status: "FAILED",
        errorCode,
        errorMessage: message,
      },
    });

    if (targetIds.length) {
      await tx.bulkUndoTargetSnapshot.updateMany({
        where: {
          shop,
          executionIdentity: execution.executionIdentity,
          id: { in: targetIds },
        },
        data: {
          status: "FAILED",
          errorCode,
          errorMessage: message,
        },
      });
    }

    await tx.bulkUndoExecution.update({
      where: { id: execution.id },
      data: {
        state: UNDO_EXECUTION_STATES.FAILED,
        errorMessage: message,
        completedAt,
        heartbeatAt: completedAt,
        leaseOwner: null,
        leaseUntil: null,
      },
    });

    await updateEditHistoryUndo({
      tx,
      shop,
      execution,
      finalState: UNDO_EXECUTION_STATES.FAILED,
      completedAt,
      processedCount: execution.processedCount || 0,
      bulkOperationId: execution.bulkOperationId,
      error: buildExecutionError({
        code: errorCode,
        stage: "finalizing",
        message,
        retryable: false,
      }),
    });
  });
}

export const bulkUndoFinalizerService = {
  async tryFinalizeUndoBulkOperation({ shop, bulkOperationId }) {
    const execution = await prisma.bulkUndoExecution.findFirst({
      where: {
        shop,
        bulkOperationId,
      },
    });

    if (!execution) {
      return { handled: false };
    }

    if (execution.state !== UNDO_EXECUTION_STATES.AWAITING_SHOPIFY) {
      return {
        handled: true,
        skipped: true,
        reason: "undo_execution_not_awaiting_shopify",
        state: execution.state,
      };
    }

    const session = await getSession(shop);

    if (!session?.shop || session.shop !== shop) {
      throw new Error("SHOP_SESSION_NOT_AVAILABLE_FOR_UNDO_FINALIZER");
    }

    const bulkStatus = await getBulkEditStatus(bulkOperationId, session);

    if (!bulkStatus) {
      throw new Error("SHOPIFY_BULK_OPERATION_NOT_FOUND");
    }

    const claimed = await prisma.bulkUndoExecution.updateMany({
      where: {
        id: execution.id,
        shop,
        bulkOperationId,
        state: UNDO_EXECUTION_STATES.AWAITING_SHOPIFY,
      },
      data: {
        state: UNDO_EXECUTION_STATES.FINALIZING,
        heartbeatAt: new Date(),
      },
    });

    if (claimed.count !== 1) {
      return {
        handled: true,
        skipped: true,
        reason: "undo_execution_already_claimed",
      };
    }

    if (bulkStatus.status !== "COMPLETED") {
      await markUndoFailed({
        shop,
        execution,
        errorCode: bulkStatus.errorCode || bulkStatus.status,
        message: `Shopify bulk undo failed with status ${bulkStatus.status}`,
      });

      return {
        handled: true,
        finalized: true,
        status: UNDO_EXECUTION_STATES.FAILED,
      };
    }

    if (!bulkStatus.url) {
      await markUndoFailed({
        shop,
        execution,
        errorCode: "SHOPIFY_BULK_RESULT_URL_MISSING",
        message: "Shopify completed undo bulk operation without result URL",
      });

      return {
        handled: true,
        finalized: true,
        status: UNDO_EXECUTION_STATES.FAILED,
      };
    }

    let successCount = 0;
    let failureCount = 0;

    await streamJsonl(bulkStatus.url, async (payload) => {
      const productId = readProductId(payload);
      const userErrors = parseUserErrors(payload);
      const isSuccess = userErrors.length === 0;

      if (!productId) {
        failureCount += 1;
        return;
      }

      const result = await bulkUndoExecutionRepository.markDispatchProductResult({
        shop,
        executionIdentity: execution.executionIdentity,
        productId,
        status: isSuccess ? "SUCCEEDED" : "FAILED",
        errorCode: isSuccess ? null : "SHOPIFY_USER_ERROR",
        errorMessage: isSuccess ? null : JSON.stringify(userErrors),
      });

      if (isSuccess) {
        successCount += result.targets.count;
      } else {
        failureCount += result.targets.count;
      }
    });

    const remainingDispatched = await prisma.bulkUndoDispatchProduct.findMany({
      where: {
        shop,
        executionIdentity: execution.executionIdentity,
        status: "DISPATCHED",
      },
      select: { targetIds: true },
    });
    const remainingTargetIds = remainingDispatched.flatMap((product) => product.targetIds);

    if (remainingDispatched.length > 0) {
      await prisma.$transaction([
        prisma.bulkUndoDispatchProduct.updateMany({
          where: {
            shop,
            executionIdentity: execution.executionIdentity,
            status: "DISPATCHED",
          },
          data: {
            status: "FAILED",
            errorCode: "MISSING_SHOPIFY_RESULT",
            errorMessage: "No matching Shopify result row returned",
          },
        }),
        prisma.bulkUndoTargetSnapshot.updateMany({
          where: {
            shop,
            executionIdentity: execution.executionIdentity,
            id: { in: remainingTargetIds },
          },
          data: {
            status: "FAILED",
            errorCode: "MISSING_SHOPIFY_RESULT",
            errorMessage: "No matching Shopify result row returned",
          },
        }),
      ]);

      failureCount += remainingTargetIds.length;
    }

    const finalStatus =
      failureCount === 0
        ? UNDO_EXECUTION_STATES.COMPLETED
        : successCount > 0
          ? UNDO_EXECUTION_STATES.PARTIAL
          : UNDO_EXECUTION_STATES.FAILED;

    const completedAt = new Date();
    const processedCount = successCount + failureCount;

    await prisma.$transaction(async (tx) => {
      await tx.bulkUndoExecution.update({
        where: { id: execution.id },
        data: {
          state: finalStatus,
          processedCount,
          completedAt,
          heartbeatAt: completedAt,
          leaseOwner: null,
          leaseUntil: null,
          errorMessage:
            finalStatus === UNDO_EXECUTION_STATES.COMPLETED
              ? null
              : `Undo completed with ${failureCount} failed targets`,
        },
      });

      await updateEditHistoryUndo({
        tx,
        shop,
        execution,
        finalState: finalStatus,
        completedAt,
        processedCount,
        bulkOperationId,
        error:
          finalStatus === UNDO_EXECUTION_STATES.COMPLETED
            ? null
            : buildExecutionError({
                code: "BULK_UNDO_PARTIAL_OR_FAILED",
                stage: "finalizing",
                message: `Undo finalized with ${failureCount} failed targets`,
                retryable: false,
                details: {
                  successCount,
                  failureCount,
                  bulkOperationId,
                },
              }),
      });
    });

    return {
      handled: true,
      finalized: true,
      status: finalStatus,
      successCount,
      failureCount,
    };
  },
};
