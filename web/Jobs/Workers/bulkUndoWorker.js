import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import UndoEditService from "../../services/productService/productBulkUndoService.js";
import { getSession } from "../../utils/sessionHandler.js";
import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import logger from "../../utils/loggerUtils.js";
import { logWorkerError } from "../../utils/errorLogUtils.js";
import { prisma } from "../../Config/database.js";
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
import { recordMirrorAnomaly } from "../../services/mirrorAnomalyService.js";
import {
  BULK_UNDO_STATES,
  buildExecutionError,
  normalizeUndoState,
} from "../../services/bulkEditExecutionStateService.js";
import { logBatchEvent } from "../../utils/batchObservability.js";

const QUEUE_NAME = process.env.UNDO_QUEUE || "bulk-undo";
const WORKER_NAME = "bulkUndoWorker";
const STALE_DISPATCH_MS = 20 * 60 * 1000;

class RetryableBulkUndoError extends Error {
  constructor(message, code = "retryable_bulk_undo") {
    super(message);
    this.name = "RetryableBulkUndoError";
    this.retryable = true;
    this.code = code;
  }
}

function isRetryableError(error) {
  return Boolean(error?.retryable);
}

function isStaleUndoDispatch(undo) {
  const startedAt = undo?.dispatchStartedAt;
  if (!startedAt) return false;
  const startedTs = new Date(startedAt).getTime();
  return Number.isFinite(startedTs) && Date.now() - startedTs > STALE_DISPATCH_MS;
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

async function claimUndo(historyId, shop, executionId, jobId, attempt) {
  let history = await prisma.editHistory.findFirst({
    where: {
      id: historyId,
      shop,
    },
    select: {
      id: true,
      shop: true,
      batch: true,
      rules: true,
      undo: true,
      executionSummary: true,
    },
  });
  history = withExecutionSummary(history);

  if (!history) {
    throw new Error(`EditHistory not found for shop ${shop} and id ${historyId}`);
  }

  const undo = normalizeUndoState(history.undo);
  if (executionId && undo.executionIdentity && executionId !== undo.executionIdentity) {
    throw new Error("Bulk undo execution identity mismatch");
  }

  if (
    [
      BULK_UNDO_STATES.AWAITING_SHOPIFY,
      BULK_UNDO_STATES.FINALIZING,
      BULK_UNDO_STATES.COMPLETED,
      BULK_UNDO_STATES.PARTIAL,
    ].includes(undo.state)
  ) {
    return null;
  }

  if (undo.state === BULK_UNDO_STATES.DISPATCHING) {
    return isStaleUndoDispatch(undo)
      ? { state: "stale_dispatch_reconciliation_required", history }
      : null;
  }

  const updated = await prisma.editHistory.updateMany({
    where: {
      id: historyId,
      shop,
    },
    data: {
      undo: {
        ...undo,
        status: "processing",
        state: BULK_UNDO_STATES.DISPATCHING,
        startedAt: undo.startedAt || new Date(),
        dispatchStartedAt: new Date(),
        dispatchJobId: jobId,
        dispatchAttempt: attempt,
      },
    },
  });

  if (!updated.count) {
    return null;
  }

  return { state: "claimed", history };
}

async function reconcileStaleUndoDispatch({ historyId, shop, session, undo }) {
  const current = await getCurrentBulkOperationStatus(session);
  const dispatchStartedAt = undo.dispatchStartedAt
    ? new Date(undo.dispatchStartedAt).getTime()
    : null;
  const currentCreatedAt = current.createdAt
    ? new Date(current.createdAt).getTime()
    : null;

  if (current.id && (!dispatchStartedAt || !currentCreatedAt || currentCreatedAt >= dispatchStartedAt)) {
    const updated = await prisma.editHistory.updateMany({
      where: { id: historyId, shop },
      data: {
        bulkOperationId: current.id,
        undo: {
          ...undo,
          status: "processing",
          state: BULK_UNDO_STATES.AWAITING_SHOPIFY,
          bulkOperationId: current.id,
          dispatchReconciledAt: new Date(),
        },
      },
    });

    return { reconciled: updated.count === 1, bulkOperationId: current.id };
  }

  await recordMirrorAnomaly({
    shop,
    severity: "critical",
    type: "bulk_undo_dispatch_reconciliation_required",
    entityType: "editHistory",
    entityId: historyId,
    message: "Bulk undo dispatch stalled after Shopify submission boundary; automatic resubmission blocked",
    details: {
      currentBulkOperationId: current.id,
      currentBulkOperationStatus: current.status,
      dispatchStartedAt: undo.dispatchStartedAt || null,
    },
  }).catch(() => {});

  return { reconciled: false, bulkOperationId: null };
}

const bulkUndoWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { shop, historyId, source = "undo", executionId = null } = job.data || {};
    const attempt = getJobAttempt(job);

    if (!shop || !historyId) {
      throw new Error("bulk undo job requires shop and historyId");
    }

    let shopLease = null;
    let leaseRenewal = null;

    try {
      const lock = await acquireExclusiveShopWork({
        shop,
        activity: "bulk_undo_execution",
        worker: WORKER_NAME,
        queue: QUEUE_NAME,
        jobId: job.id,
        entityType: "editHistory",
        entityId: historyId,
        executionId,
      });

      if (!lock.acquired) {
        throw new RetryableBulkUndoError(
          "Another heavy job is already running for this shop",
          "shop_work_conflict",
        );
      }

      shopLease = lock;
      leaseRenewal = startExclusiveShopWorkRenewal(lock, {
        onRenewalError: (error) => {
          logger.error("Failed to renew bulk undo shop lease", {
            shop,
            historyId,
            message: error.message,
          });
        },
      });

      const session = await getSession(shop);
      if (!session?.shop || session.shop !== shop) {
        throw new Error("Shop session not available for bulk undo execution");
      }

      assertExclusiveShopWorkLeaseActive(shopLease);
      const { status } = await getCurrentBulkOperationStatus(session);
      if (["CREATED", "RUNNING", "CANCELING"].includes(status)) {
        throw new RetryableBulkUndoError(
          "Another bulk operation is already running in background",
          "shopify_bulk_busy",
        );
      }

      const claimResult = await claimUndo(historyId, shop, executionId, job.id, attempt);
      if (!claimResult) {
        return {
          skipped: true,
          reason: "undo_already_processing",
          shop,
          historyId,
        };
      }

      if (claimResult.state === "stale_dispatch_reconciliation_required") {
        const undo = normalizeUndoState(claimResult.history.undo);
        const reconciliation = await reconcileStaleUndoDispatch({
          historyId,
          shop,
          session,
          undo,
        });

        return {
          skipped: true,
          reason: reconciliation.reconciled
            ? "stale_dispatch_reconciled"
            : "stale_dispatch_reconciliation_required",
          shop,
          historyId,
          bulkOperationId: reconciliation.bulkOperationId,
        };
      }

      const historyRow = await prisma.editHistory.findFirst({
        where: {
          id: historyId,
          shop,
        },
        select: {
          id: true,
          batch: true,
          rules: true,
          undo: true,
          targetCatalogBatchId: true,
          targetMirrorBatchId: true,
          executionSummary: true,
        },
      });
      const history = withExecutionSummary(historyRow);

      const rule = Array.isArray(history?.rules) ? history.rules[0] || {} : {};
      const batch = history?.batch && typeof history.batch === "object" ? history.batch : {};
      const undo = normalizeUndoState(history?.undo);
      const limit = batch.size || 75;
      const cursorId = batch.lastProductId || null;

      const products = await prisma.changeRecord.findMany({
        where: {
          editHistoryId: historyId,
          shop,
          status: { in: ["completed", "SUCCEEDED", "PARTIAL"] },
        },
        orderBy: { id: "asc" },
        take: limit,
        ...(cursorId
          ? {
              skip: 1,
              cursor: { id: cursorId },
            }
          : {}),
      });

      if (!products.length) {
        throw new Error("No original products found to undo changes");
      }

      await clearKeyCaches(`${shop}:fetchHistories`);

      const service = new UndoEditService(session);
      assertExclusiveShopWorkLeaseActive(shopLease);
      const { bulkOperationId, lastProductId, count } = await service.undoEditBulkOperation(
        products,
        rule.field,
      );

      assertExclusiveShopWorkLeaseActive(shopLease);
      await prisma.editHistory.updateMany({
        where: {
          id: historyId,
          shop,
        },
        data: {
          bulkOperationId,
          processingBatchId: `${undo.executionIdentity || historyId}:${cursorId || "start"}`,
          batch: {
            ...batch,
            lastProductId,
            hasMore: count === limit,
            currentBatchTargetCount: count,
          },
          undo: {
            ...undo,
            status: "processing",
            state: BULK_UNDO_STATES.AWAITING_SHOPIFY,
            bulkOperationId,
          },
        },
      });

      logger.info("Bulk undo worker queued Shopify bulk mutation", {
        worker: WORKER_NAME,
        queue: QUEUE_NAME,
        jobId: job.id,
        shop,
        historyId,
        executionId: executionId || undo.executionIdentity || null,
        attempt,
        source,
        bulkOperationId,
      });

      logBatchEvent("catalog_batch_edit_execution", {
        shop,
        bulkOperationId,
        oldMirrorBatchId:
          history.targetMirrorBatchId &&
          history.targetMirrorBatchId !==
            (history.targetCatalogBatchId || history.targetMirrorBatchId)
            ? history.targetMirrorBatchId
            : null,
        resolvedCatalogBatchId:
          history.targetCatalogBatchId || history.targetMirrorBatchId,
        path: "undo",
        extra: {
          worker: WORKER_NAME,
          queue: QUEUE_NAME,
          jobId: job.id,
          historyId,
          executionId: executionId || undo.executionIdentity || null,
          targetCount: count,
        },
      });

      return {
        success: true,
        shop,
        historyId,
        bulkOperationId,
      };
    } catch (error) {
      const existingRow = await prisma.editHistory.findFirst({
        where: {
          id: historyId,
          shop,
        },
        select: { undo: true, executionSummary: true },
      }).catch(() => null);
      const existing = withExecutionSummary(existingRow);

      if (existing) {
        const undo = normalizeUndoState(existing.undo);
        await prisma.editHistory.updateMany({
          where: {
            id: historyId,
            shop,
          },
          data: {
            undo: {
              ...undo,
              ...(isRetryableError(error)
                ? {
                    status: "pending",
                    state: BULK_UNDO_STATES.QUEUED,
                  }
                : {
                    status: "failed",
                    state: BULK_UNDO_STATES.FAILED,
                    completedAt: new Date(),
                    error: buildExecutionError({
                      code: error.code || "bulk_undo_worker_failure",
                      stage: "queue_execution",
                      message: error.message,
                      retryable: false,
                      details: {
                        attempt,
                        source,
                        executionId,
                      },
                    }),
                  }),
            },
          },
        }).catch(() => {});
      }

      await clearKeyCaches(`${shop}:fetchHistories`);
      await clearKeyCaches(`${shop}:historyDetails:${historyId}`);

      await recordMirrorAnomaly({
        shop,
        severity: "high",
        type: "bulk_undo_worker_failure",
        entityType: "editHistory",
        entityId: historyId,
        message: error.message,
        details: {
          worker: WORKER_NAME,
          queue: QUEUE_NAME,
          jobId: job?.id || null,
          attempt,
          source,
          executionId,
          retryable: isRetryableError(error),
        },
      }).catch(() => {});

      await logWorkerError({
        shop,
        err: error,
        source: "BulkUndoWorker",
        metadata: {
          queue: QUEUE_NAME,
          worker: WORKER_NAME,
          jobId: job?.id || null,
          historyId,
          attempt,
          source,
          executionId,
          retryable: isRetryableError(error),
        },
      });

      throw error;
    } finally {
      if (leaseRenewal) {
        clearInterval(leaseRenewal);
      }
      await releaseExclusiveShopWork(shopLease);
    }
  },
  { connection, concurrency: 1 },
);

bulkUndoWorker.on("failed", async (job, error) => {
  logger.error("Bulk undo worker failed", {
    worker: WORKER_NAME,
    queue: QUEUE_NAME,
    jobId: job?.id,
    shop: job?.data?.shop,
    historyId: job?.data?.historyId,
    executionId: job?.data?.executionId || null,
    attempt: getJobAttempt(job),
    message: error.message,
  });

  if (isRetryExhausted(job)) {
    await recordRetryExhausted({
      job,
      shop: job?.data?.shop,
      worker: WORKER_NAME,
      queue: QUEUE_NAME,
      entityType: "editHistory",
      entityId: job?.data?.historyId,
      executionId: job?.data?.executionId || null,
      message: "Bulk undo worker exhausted retries",
      details: {
        source: job?.data?.source || null,
      },
    });
  }
});

export default bulkUndoWorker;
