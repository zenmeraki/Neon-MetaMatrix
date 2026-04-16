import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";
import ProductBulkService from "../../services/productService/productBulkEditService.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { logWorkerError } from "../../utils/errorLogUtils.js";
import { finalizeRecurringRunFromHistory } from "../../services/recurringEditExecutionService.js";
import { finalizeAutomaticProductRuleRunFromHistory } from "../../services/automaticProductRuleExecutionService.js";
import { prisma } from "../../Config/database.js";
import { recordMirrorAnomaly } from "../../services/mirrorAnomalyService.js";
import {
  acquireExclusiveShopWork,
  assertExclusiveShopWorkLeaseActive,
  releaseExclusiveShopWork,
  startExclusiveShopWorkRenewal,
} from "../../services/shopWorkLeaseService.js";
import {
  getJobAttempt,
  isRetryExhausted,
  recordRetryExhausted,
} from "../../utils/workerTelemetry.js";
import { getSession } from "../../utils/sessionHandler.js";
import { addbulkEditJob } from "../Queues/bulkEditJob.js";
import { scheduledEditQueue } from "../Queues/scheduledEditQueue.js";
import logger from "../../utils/loggerUtils.js";
import {
  BULK_EDIT_EXECUTION_STATES,
  appendExecutionError,
  buildExecutionError,
  isTerminalExecutionState,
} from "../../services/bulkEditExecutionStateService.js";
import * as bulkMutationExecutionService from "../../services/execution/bulkMutationExecutionService.js";
import { sha256Hex } from "../../utils/deterministicHashUtils.js";
import { logBatchEvent } from "../../utils/batchObservability.js";

const QUEUE_NAME = process.env.EDIT_QUEUE || "bulk-edit";
const WORKER_NAME = "bulkEditWorker";
const STALE_DISPATCH_MS = 20 * 60 * 1000;

async function enqueueScheduledUndoAfterCompletion(history, shop) {
  if (!history?.scheduledUndoAt || history?.status !== "completed") {
    return null;
  }

  const scheduledUndoAt = new Date(history.scheduledUndoAt);
  if (Number.isNaN(scheduledUndoAt.getTime())) {
    return null;
  }

  const delay = Math.max(scheduledUndoAt.getTime() - Date.now(), 0);
  return scheduledEditQueue.add(
    "undo-task",
    { historyId: history.id, shop },
    {
      delay,
      jobId: `scheduled-undo:${shop}:${history.id}`,
    },
  );
}

class RetryableBulkEditError extends Error {
  constructor(message, code = "retryable_bulk_edit") {
    super(message);
    this.name = "RetryableBulkEditError";
    this.retryable = true;
    this.code = code;
  }
}

function isRetryableError(error) {
  return Boolean(error?.retryable);
}

function isStaleDispatch(batch) {
  const startedAt = batch?.dispatchStartedAt;
  if (!startedAt) return false;

  const startedTs = new Date(startedAt).getTime();
  if (Number.isNaN(startedTs)) return false;

  return Date.now() - startedTs > STALE_DISPATCH_MS;
}

function withExecutionSummary(history) {
  if (!history?.executionSummary) {
    return history;
  }

  const { executionSummary, ...parent } = history;
  return {
    ...parent,
    ...executionSummary,
    id: parent.id,
    shop: parent.shop,
  };
}

async function claimHistoryExecution(historyId, shop, executionId, jobId, attempt) {
  let history = await prisma.editHistory.findUnique({
    where: { id: historyId },
    select: {
      id: true,
      shop: true,
      status: true,
      executionState: true,
      rules: true,
      batch: true,
      targetSnapshotCount: true,
      targetSnapshotSetId: true,
      executionIdentity: true,
      bulkOperationId: true,
      targetCatalogBatchId: true,
      targetMirrorBatchId: true,
      error: true,
      completedAt: true,
      scheduledUndoAt: true,
      executionSummary: true,
    },
  });
  history = withExecutionSummary(history);

  if (!history) {
    throw new Error("Edit history not found");
  }

  if (history.shop !== shop) {
    throw new Error("Cross-shop bulk edit execution blocked");
  }

  if (executionId && history.executionIdentity && executionId !== history.executionIdentity) {
    throw new Error("Bulk edit execution identity mismatch");
  }

  if (isTerminalExecutionState(history.executionState) || ["completed", "failed", "cancelled", "partial"].includes(history.status)) {
    return { state: "terminal", history };
  }

  if (history.executionState === BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY && history.bulkOperationId) {
    return { state: "awaiting_shopify", history };
  }

  if (history.executionState === BULK_EDIT_EXECUTION_STATES.FINALIZING) {
    return { state: "finalizing", history };
  }

  const batch = history.batch && typeof history.batch === "object" ? history.batch : {};
  if (history.executionState === BULK_EDIT_EXECUTION_STATES.DISPATCHING) {
    if (!history.bulkOperationId && isStaleDispatch(batch)) {
      return { state: "stale_dispatch_reconciliation_required", history };
    }

    return { state: "already_running", history };
  }

  const nextBatch = {
    ...batch,
    dispatchStartedAt: new Date().toISOString(),
    dispatchJobId: jobId,
    dispatchAttempt: attempt,
    activeExecutionId: history.executionIdentity,
  };

  const updated = await prisma.editHistory.updateMany({
    where: {
      id: historyId,
      shop,
      bulkOperationId: null,
      executionState: {
        in: [
          BULK_EDIT_EXECUTION_STATES.PLANNED,
          BULK_EDIT_EXECUTION_STATES.QUEUED,
          BULK_EDIT_EXECUTION_STATES.FAILED,
        ],
      },
      status: { notIn: ["completed", "failed", "cancelled", "partial"] },
    },
    data: {
      status: "processing",
      executionState: BULK_EDIT_EXECUTION_STATES.DISPATCHING,
      error: null,
      failureStage: null,
      batch: nextBatch,
    },
  });

  if (!updated.count) {
    return { state: "not_claimed", history };
  }

  const claimedHistoryRow = await prisma.editHistory.findUnique({
    where: { id: historyId },
    select: {
      id: true,
      shop: true,
      rules: true,
      batch: true,
      targetSnapshotCount: true,
      targetSnapshotSetId: true,
      executionIdentity: true,
      targetCatalogBatchId: true,
      targetMirrorBatchId: true,
      executionSummary: true,
    },
  });
  const claimedHistory = withExecutionSummary(claimedHistoryRow);

  return { state: "claimed", history: claimedHistory };
}

async function reconcileStaleDispatch({ history, session, shop, historyId }) {
  const batch = history.batch && typeof history.batch === "object" ? history.batch : {};
  const current = await getCurrentBulkOperationStatus(session);
  const startedAt = batch.dispatchStartedAt
    ? new Date(batch.dispatchStartedAt).getTime()
    : null;
  const currentCreatedAt = current?.createdAt
    ? new Date(current.createdAt).getTime()
    : null;

  if (
    current?.id &&
    (!startedAt || !currentCreatedAt || currentCreatedAt >= startedAt)
  ) {
    const updated = await prisma.editHistory.updateMany({
      where: {
        id: historyId,
        shop,
        executionState: BULK_EDIT_EXECUTION_STATES.DISPATCHING,
        bulkOperationId: null,
      },
      data: {
        bulkOperationId: current.id,
        executionState: BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY,
        failureStage: null,
        batch: {
          ...batch,
          dispatchReconciledAt: new Date().toISOString(),
          lastSubmittedBulkOperationId: current.id,
        },
      },
    });

    if (updated.count) {
      return { reconciled: true, bulkOperationId: current.id };
    }
  }

  await recordMirrorAnomaly({
    shop,
    severity: "critical",
    type: "bulk_edit_dispatch_reconciliation_required",
    entityType: "editHistory",
    entityId: historyId,
    message: "Bulk edit dispatch stalled after Shopify submission boundary; automatic resubmission blocked",
    details: {
      dispatchStartedAt: batch.dispatchStartedAt || null,
      dispatchJobId: batch.dispatchJobId || null,
      currentBulkOperationId: current?.id || null,
      currentBulkOperationStatus: current?.status || null,
    },
  }).catch(() => {});

  return { reconciled: false };
}

async function markHistoryRetryable(historyId, shop, error, attempt, details = {}) {
  const history = await prisma.editHistory.findFirst({
    where: { id: historyId, shop },
    select: {
      error: true,
      batch: true,
    },
  });

  if (!history) return;

  const batch = history.batch && typeof history.batch === "object" ? history.batch : {};

  await prisma.editHistory.updateMany({
    where: {
      id: historyId,
      shop,
      executionState: BULK_EDIT_EXECUTION_STATES.DISPATCHING,
      bulkOperationId: null,
    },
    data: {
      status: "pending",
      executionState: BULK_EDIT_EXECUTION_STATES.QUEUED,
      failureStage: error.code || "retryable",
      error: appendExecutionError(
        history.error,
        buildExecutionError({
          code: error.code || "retryable_execution",
          stage: "dispatch",
          message: error.message,
          retryable: true,
          details: {
            ...details,
            attempt,
          },
        }),
      ),
      batch: {
        ...batch,
        lastRetryableErrorAt: new Date().toISOString(),
        lastRetryableErrorCode: error.code || "retryable_execution",
      },
    },
  });
}

async function markHistoryFailure(historyId, shop, error, attempt, executionId, source) {
  const history = await prisma.editHistory.findFirst({
    where: { id: historyId, shop },
    select: {
      error: true,
    },
  });
  const integrityViolation = error?.integrityViolation === true ||
    error?.code === "FROZEN_TARGET_INTEGRITY_VIOLATION";

  await prisma.editHistory.updateMany({
    where: { id: historyId, shop },
    data: {
      status: "failed",
      executionState: integrityViolation
        ? BULK_EDIT_EXECUTION_STATES.FAILED_INTEGRITY_CHECK
        : BULK_EDIT_EXECUTION_STATES.FAILED,
      failureStage: integrityViolation ? "target_integrity_check" : "queue_execution",
      completedAt: new Date(),
      error: appendExecutionError(
        history?.error,
        buildExecutionError({
          code: error.code || "bulk_edit_worker_failure",
          stage: integrityViolation ? "target_integrity_check" : "queue_execution",
          message: error.message,
          retryable: false,
          details: {
            stack: error.stack || null,
            attempt,
            source,
            executionId,
            notifyUser: integrityViolation,
          },
        }),
      ),
    },
  }).catch(() => {});
}

async function processBulkEdit(job) {
  const { historyId, shop, source = "bulk-edit", executionId = null } = job.data || {};
  const attempt = getJobAttempt(job);

  if (!historyId || !shop) {
    throw new Error("bulk edit job requires historyId and shop");
  }

  let shopLease = null;
  let leaseRenewal = null;
  let bulkMutationSubmissionId = null;

  try {
    const session = await getSession(shop);
    if (!session?.shop || session.shop !== shop) {
      throw new Error("Shop session not available for bulk edit execution");
    }

    const lock = await acquireExclusiveShopWork({
      shop,
      activity: "bulk_edit_execution",
      worker: WORKER_NAME,
      queue: QUEUE_NAME,
      jobId: job.id,
      entityType: "editHistory",
      entityId: historyId,
      executionId,
    });

    if (!lock.acquired) {
      throw new RetryableBulkEditError(
        "Another heavy job is already running for this shop",
        "shop_work_conflict",
      );
    }

    shopLease = lock;
    leaseRenewal = startExclusiveShopWorkRenewal(lock, {
      onRenewalError: (error) => {
        logger.error("Failed to renew bulk edit shop lease", {
          shop,
          historyId,
          message: error.message,
        });
      },
    });

    const claimResult = await claimHistoryExecution(
      historyId,
      shop,
      executionId,
      job.id,
      attempt,
    );

    if (claimResult.state === "stale_dispatch_reconciliation_required") {
      const reconciliation = await reconcileStaleDispatch({
        history: claimResult.history,
        session,
        shop,
        historyId,
      });

      return {
        skipped: true,
        reason: reconciliation.reconciled
          ? "stale_dispatch_reconciled"
          : "stale_dispatch_reconciliation_required",
        shop,
        historyId,
        bulkOperationId: reconciliation.bulkOperationId || null,
      };
    }

    if (["terminal", "awaiting_shopify", "finalizing", "already_running", "not_claimed"].includes(claimResult.state)) {
      return { skipped: true, reason: claimResult.state, shop, historyId };
    }

    assertExclusiveShopWorkLeaseActive(shopLease);
    const { status } = await getCurrentBulkOperationStatus(session);
    if (["CREATED", "RUNNING", "CANCELING"].includes(status)) {
      throw new RetryableBulkEditError(
        "Another Shopify bulk operation is already running",
        "shopify_bulk_busy",
      );
    }

    const service = new ProductBulkService(session);
    const history = claimResult.history;

    const {
      formattedProducts,
      changes,
      hasMore,
      lastProductId,
      targetCursorKey,
      batchId,
      batchTargetCount,
    } = await service._preparingBulkOperation({ historyId });

    if (!formattedProducts) {
      if (hasMore) {
        await prisma.editHistory.updateMany({
          where: {
            id: historyId,
            shop,
            executionState: BULK_EDIT_EXECUTION_STATES.DISPATCHING,
            bulkOperationId: null,
          },
          data: {
            status: "pending",
            executionState: BULK_EDIT_EXECUTION_STATES.QUEUED,
            processingBatchId: null,
            batch: {
              ...(history.batch || {}),
              hasMore,
              lastProductId,
              targetCursorKey,
              currentBatchTargetCount: batchTargetCount,
              currentBatchCount: 0,
              skippedEmptyBatchAt: new Date().toISOString(),
            },
          },
        });

        await addbulkEditJob({
          historyId,
          shop,
          source: "bulk_edit_empty_batch_continuation",
          executionId: history.executionIdentity || historyId,
        });

        return {
          success: true,
          skipped: true,
          continued: true,
          reason: "empty_batch_continued",
          shop,
          historyId,
        };
      }

      await prisma.editHistory.updateMany({
        where: {
          id: historyId,
          shop,
          executionState: BULK_EDIT_EXECUTION_STATES.DISPATCHING,
          bulkOperationId: null,
        },
        data: {
          status: "completed",
          executionState: BULK_EDIT_EXECUTION_STATES.COMPLETED,
          completedAt: new Date(),
          processedCount: history.targetSnapshotCount,
          processingBatchId: null,
          batch: {
            ...(history.batch || {}),
            hasMore: false,
            lastProductId: null,
            targetCursorKey: null,
            currentBatchTargetCount: 0,
            dispatchCompletedAt: new Date().toISOString(),
          },
        },
      });

      await enqueueScheduledUndoAfterCompletion(
        { ...history, id: historyId, status: "completed" },
        shop,
      ).catch((error) => {
        logger.error("Failed to enqueue scheduled undo after edit completion", {
          shop,
          historyId,
          message: error.message,
        });
      });

      return {
        success: true,
        skipped: true,
        reason: "no_frozen_targets_remaining",
        shop,
        historyId,
      };
    }

    const submission =
      await bulkMutationExecutionService.createBulkMutationSubmission({
        shop,
        mutationType: "PRODUCT_SET",
        editHistoryId: historyId,
        targetSnapshotSetId: history.targetSnapshotSetId,
        batchId,
        inputArtifactSha256: sha256Hex(formattedProducts),
        inputRowHash: sha256Hex({
          historyId,
          batchId,
          formattedProducts,
        }),
        status: "PLANNED",
      });

    bulkMutationSubmissionId = submission.id;

    await prisma.changeRecord.deleteMany({
      where: {
        editHistoryId: historyId,
        shop,
        batchId,
      },
    });

    if (changes.length > 0) {
      await prisma.changeRecord.createMany({
        data: changes.map((change) => ({
          ...change,
          bulkMutationSubmissionId,
          targetKey: change.targetKey || `product:${change.productId}`,
        })),
      });
    }

    assertExclusiveShopWorkLeaseActive(shopLease);
    const result = await service._bulkOperationHelper({
      formattedProducts,
      field: history.rules?.[0]?.field || "",
      fields: Array.isArray(history.rules)
        ? history.rules.map((rule) => rule?.field).filter(Boolean)
        : [],
      batchId,
      executionIdentity: executionId || history.executionIdentity || historyId,
    });

    if (!result?.bulkOperation?.id) {
      throw new Error("Missing bulkOperationId in Shopify response");
    }

    assertExclusiveShopWorkLeaseActive(shopLease);
    await bulkMutationExecutionService.markBulkMutationSubmitted({
      bulkMutationSubmissionId,
      bulkOperationId: result.bulkOperation.id,
    });

    const existingBatch = history.batch ?? {};
    const updatedBatch = {
      ...existingBatch,
      lastProductId,
      targetCursorKey,
      hasMore,
      currentBatchCount: changes.length,
      currentBatchTargetCount: batchTargetCount,
      currentBatchId: batchId,
      dispatchCompletedAt: new Date().toISOString(),
      lastSubmittedBulkOperationId: result.bulkOperation.id,
      bulkMutationSubmissionId,
    };

    assertExclusiveShopWorkLeaseActive(shopLease);
    const updated = await prisma.editHistory.updateMany({
      where: {
        id: historyId,
        shop,
        bulkOperationId: null,
        executionState: BULK_EDIT_EXECUTION_STATES.DISPATCHING,
      },
      data: {
        bulkOperationId: result.bulkOperation.id,
        batch: updatedBatch,
        processingBatchId: batchId,
        failureStage: null,
        executionState: BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY,
      },
    });

    if (!updated.count) {
      throw new Error("Bulk edit dispatch state could not be persisted safely");
    }

    logger.info("Bulk edit worker queued Shopify bulk mutation", {
      worker: WORKER_NAME,
      queue: QUEUE_NAME,
      shop,
      jobId: job.id,
      historyId,
      executionId: executionId || history.executionIdentity || null,
      attempt,
      source,
      batchId,
      targetCount: batchTargetCount,
      changeCount: changes.length,
      bulkOperationId: result.bulkOperation.id,
    });

    logBatchEvent("catalog_batch_edit_execution", {
      shop,
      bulkOperationId: result.bulkOperation.id,
      oldMirrorBatchId:
        history.targetMirrorBatchId &&
        history.targetMirrorBatchId !==
          (history.targetCatalogBatchId || history.targetMirrorBatchId)
          ? history.targetMirrorBatchId
          : null,
      resolvedCatalogBatchId:
        history.targetCatalogBatchId || history.targetMirrorBatchId,
      path: "execute",
      extra: {
        worker: WORKER_NAME,
        queue: QUEUE_NAME,
        jobId: job.id,
        historyId,
        executionId: executionId || history.executionIdentity || null,
        batchId,
        targetSnapshotSetId: history.targetSnapshotSetId,
        targetCount: batchTargetCount,
        changeCount: changes.length,
      },
    });

    return {
      success: true,
      shop,
      historyId,
      bulkOperationId: result.bulkOperation.id,
      attempt,
    };
  } catch (err) {
    const integrityViolation = err?.integrityViolation === true ||
      err?.code === "FROZEN_TARGET_INTEGRITY_VIOLATION";
    if (isRetryableError(err)) {
      await markHistoryRetryable(historyId, shop, err, attempt, {
        source,
        worker: WORKER_NAME,
        queue: QUEUE_NAME,
        jobId: job?.id || null,
      }).catch(() => {});
    } else {
      if (bulkMutationSubmissionId) {
        await bulkMutationExecutionService.markBulkMutationFailed({
          bulkMutationSubmissionId,
          failureCode: err.code || "BULK_EDIT_DISPATCH_FAILED",
          failureMessage: err.message || "Bulk edit dispatch failed",
          failureCategory: "INTERNAL",
          failureStage: "bulk_edit_dispatch",
          retryable: false,
        }).catch(async (transitionErr) => {
          if (
            transitionErr instanceof
            bulkMutationExecutionService.InvalidBulkMutationStatusTransitionError
          ) {
            await bulkMutationExecutionService.markBulkMutationCancelled({
              bulkMutationSubmissionId,
              failureCode: err.code || "BULK_EDIT_DISPATCH_FAILED",
              failureMessage: err.message || "Bulk edit dispatch failed",
              failureCategory: "INTERNAL",
              failureStage: "bulk_edit_dispatch",
              retryable: false,
            });
          }
        });
      }

      await markHistoryFailure(historyId, shop, err, attempt, executionId, source);

      await finalizeRecurringRunFromHistory({
        historyId,
        status: "FAILED",
        errorMessage: err.message,
      }).catch(() => {});

      await finalizeAutomaticProductRuleRunFromHistory({
        historyId,
        status: "FAILED",
        errorMessage: err.message,
      }).catch(() => {});

      await recordMirrorAnomaly({
        shop: shop || "unknown",
        severity: "high",
        type: "bulk_edit_worker_failure",
        entityType: "editHistory",
        entityId: historyId,
        message: err.message,
        details: {
          stage: "queue_execution",
          worker: WORKER_NAME,
          queue: QUEUE_NAME,
          jobId: job?.id || null,
          attempt,
          source,
          executionId,
        },
      }).catch(() => {});
    }

    await clearKeyCaches(`${shop}:fetchHistories`);
    await clearKeyCaches(`${shop}:historyDetails:${historyId}`);

    await logWorkerError({
      shop,
      err,
      source: "BulkEditWorker",
      metadata: {
        queue: QUEUE_NAME,
        worker: WORKER_NAME,
        jobId: job?.id || null,
        historyId,
        executionId,
        attempt,
        source,
        retryable: isRetryableError(err),
        integrityViolation,
      },
    });

    if (integrityViolation) {
      return {
        success: false,
        skipped: true,
        reason: "failed_integrity_check",
        shop,
        historyId,
      };
    }

    throw err;
  } finally {
    if (leaseRenewal) {
      clearInterval(leaseRenewal);
    }
    await releaseExclusiveShopWork(shopLease);
  }
}

const bulkEditWorker = new Worker(QUEUE_NAME, processBulkEdit, {
  connection,
  concurrency: 1,
});

bulkEditWorker.on("completed", (job, result) => {
  logger.info("Bulk edit worker completed job", {
    worker: WORKER_NAME,
    queue: QUEUE_NAME,
    jobId: job?.id,
    shop: job?.data?.shop,
    historyId: job?.data?.historyId,
    executionId: job?.data?.executionId || null,
    attempt: getJobAttempt(job),
    result,
  });
});

bulkEditWorker.on("failed", async (job, error) => {
  const shop = job?.data?.shop;
  const historyId = job?.data?.historyId;
  const executionId = job?.data?.executionId || null;

  logger.error("Bulk edit worker failed", {
    worker: WORKER_NAME,
    queue: QUEUE_NAME,
    jobId: job?.id,
    shop,
    historyId,
    executionId,
    attempt: getJobAttempt(job),
    message: error.message,
  });

  if (isRetryExhausted(job)) {
    await recordRetryExhausted({
      job,
      shop,
      worker: WORKER_NAME,
      queue: QUEUE_NAME,
      entityType: "editHistory",
      entityId: historyId,
      executionId,
      message: "Bulk edit worker exhausted retries",
      details: {
        source: job?.data?.source || null,
      },
    });
  }
});

export default bulkEditWorker;
