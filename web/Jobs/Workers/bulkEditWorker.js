import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";
import ProductBulkService from "../../services/productService/productBulkEditService.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { logWorkerError } from "../../utils/errorLogUtils.js";
import { finalizeRecurringRunFromHistory } from "../../services/recurringEditExecutionService.js";
import { finalizeAutomaticProductRuleRunFromHistory } from "../../services/automaticProductRuleExecutionService.js";
import { prisma } from "../../config/database.js";
import { recordMirrorAnomaly } from "../../services/mirrorAnomalyService.js";
import {
  acquireExclusiveShopWork,
  releaseExclusiveShopWork,
} from "../../services/shopWorkLeaseService.js";
import {
  getJobAttempt,
  isRetryExhausted,
  recordRetryExhausted,
} from "../../utils/workerTelemetry.js";
import { requireJobData } from "../../utils/jobPayloadValidation.js";
import { getSession } from "../../utils/sessionHandler.js";
import logger from "../../utils/loggerUtils.js";
import {
  BULK_EDIT_EXECUTION_STATES,
  appendExecutionError,
  buildExecutionError,
  isTerminalExecutionState,
} from "../../services/bulkEditExecutionStateService.js";

const QUEUE_NAME = process.env.EDIT_QUEUE || "bulk-edit";
const WORKER_NAME = "bulkEditWorker";
const STALE_DISPATCH_MS = 20 * 60 * 1000;

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

async function claimHistoryExecution(historyId, shop, executionId, jobId, attempt) {
  const history = await prisma.editHistory.findUnique({
    where: { id: historyId },
    select: {
      id: true,
      shop: true,
      status: true,
      executionState: true,
      rules: true,
      batch: true,
      targetSnapshotCount: true,
      executionIdentity: true,
      bulkOperationId: true,
      error: true,
      completedAt: true,
    },
  });

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
      const structuredError = buildExecutionError({
        code: "dispatch_stalled",
        stage: "dispatch",
        message: "Bulk edit dispatch stalled before Shopify mutation confirmation",
        retryable: false,
        details: {
          dispatchStartedAt: batch.dispatchStartedAt,
          dispatchJobId: batch.dispatchJobId || null,
          dispatchAttempt: batch.dispatchAttempt || null,
        },
      });

      await prisma.editHistory.updateMany({
        where: {
          id: historyId,
          shop,
          executionState: BULK_EDIT_EXECUTION_STATES.DISPATCHING,
          bulkOperationId: null,
        },
        data: {
          status: "failed",
          executionState: BULK_EDIT_EXECUTION_STATES.FAILED,
          failureStage: "dispatch_timeout",
          error: appendExecutionError(history.error, structuredError),
          completedAt: new Date(),
        },
      });

      return { state: "stale_dispatch_failed", history };
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

  const claimedHistory = await prisma.editHistory.findUnique({
    where: { id: historyId },
    select: {
      id: true,
      shop: true,
      rules: true,
      batch: true,
      targetSnapshotCount: true,
      executionIdentity: true,
    },
  });

  return { state: "claimed", history: claimedHistory };
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

  await prisma.editHistory.updateMany({
    where: { id: historyId, shop },
    data: {
      status: "failed",
      executionState: BULK_EDIT_EXECUTION_STATES.FAILED,
      failureStage: "queue_execution",
      completedAt: new Date(),
      error: appendExecutionError(
        history?.error,
        buildExecutionError({
          code: error.code || "bulk_edit_worker_failure",
          stage: "queue_execution",
          message: error.message,
          retryable: false,
          details: {
            stack: error.stack || null,
            attempt,
            source,
            executionId,
          },
        }),
      ),
    },
  }).catch(() => {});
}

async function processBulkEdit(job) {
  const data = requireJobData(job, ["historyId", "shop"], "bulk edit");
  const { historyId, shop, source = "bulk-edit", executionId = null } = data;
  const attempt = getJobAttempt(job);

  let shopLockKey = null;

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

    shopLockKey = lock.lockKey;

    const claimResult = await claimHistoryExecution(
      historyId,
      shop,
      executionId,
      job.id,
      attempt,
    );

    if (["terminal", "awaiting_shopify", "finalizing", "already_running", "not_claimed", "stale_dispatch_failed"].includes(claimResult.state)) {
      return { skipped: true, reason: claimResult.state, shop, historyId };
    }

    const { status } = await getCurrentBulkOperationStatus(session);
    if (status === "RUNNING") {
      throw new RetryableBulkEditError(
        "Another Shopify bulk operation is already running",
        "shopify_bulk_busy",
      );
    }

    await clearKeyCaches(`${shop}:fetchHistories`);
    await clearKeyCaches(`${shop}:historyDetails:${historyId}`);

    const service = new ProductBulkService(session);
    const history = claimResult.history;

    const {
      formattedProducts,
      changes,
      hasMore,
      lastProductId,
      lastOrdinal,
      batchId,
      batchTargetCount,
    } = await service._preparingBulkOperation({ historyId });

    if (!formattedProducts) {
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
          lastOrdinal: 0,
          currentBatchTargetCount: 0,
          dispatchCompletedAt: new Date().toISOString(),
        },
        },
      });

      return {
        success: true,
        skipped: true,
        reason: "no_frozen_targets_remaining",
        shop,
        historyId,
      };
    }

    await prisma.changeRecord.deleteMany({
      where: {
        editHistoryId: historyId,
        shop,
        batchId,
      },
    });

    if (changes.length > 0) {
      await prisma.changeRecord.createMany({
        data: changes,
      });
    }

    await clearKeyCaches(`${shop}:historyChanges:${historyId}`);

    const result = await service._bulkOperationHelper({
      formattedProducts,
      field: history.rules?.[0]?.field || "",
      fields: Array.isArray(history.rules)
        ? history.rules.map((rule) => rule?.field).filter(Boolean)
        : [],
    });

    if (!result?.bulkOperation?.id) {
      throw new Error("Missing bulkOperationId in Shopify response");
    }

    const existingBatch = history.batch ?? {};
    const updatedBatch = {
      ...existingBatch,
      lastProductId,
      lastOrdinal,
      hasMore,
      currentBatchCount: changes.length,
      currentBatchTargetCount: batchTargetCount,
      currentBatchId: batchId,
      dispatchCompletedAt: new Date().toISOString(),
      lastSubmittedBulkOperationId: result.bulkOperation.id,
    };

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

    return {
      success: true,
      shop,
      historyId,
      bulkOperationId: result.bulkOperation.id,
      attempt,
    };
  } catch (err) {
    if (isRetryableError(err)) {
      await markHistoryRetryable(historyId, shop, err, attempt, {
        source,
        worker: WORKER_NAME,
        queue: QUEUE_NAME,
        jobId: job?.id || null,
      }).catch(() => {});
    } else {
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
      },
    });

    throw err;
  } finally {
    await releaseExclusiveShopWork(shopLockKey);
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
