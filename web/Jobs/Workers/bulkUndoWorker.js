import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import UndoEditService from "../../services/productService/productBulkUndoService.js";
import { getSession } from "../../utils/sessionHandler.js";
import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import logger from "../../utils/loggerUtils.js";
import { logWorkerError } from "../../utils/errorLogUtils.js";
import { prisma } from "../../config/database.js";
import {
  acquireExclusiveShopWork,
  releaseExclusiveShopWork,
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

const QUEUE_NAME = process.env.UNDO_QUEUE || "bulk-undo";
const WORKER_NAME = "bulkUndoWorker";

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

async function claimUndo(historyId, shop, executionId, jobId, attempt) {
  const history = await prisma.editHistory.findFirst({
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
    },
  });

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

  return history;
}

const bulkUndoWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { shop, historyId, source = "undo", executionId = null } = job.data || {};
    const attempt = getJobAttempt(job);

    if (!shop || !historyId) {
      throw new Error("bulk undo job requires shop and historyId");
    }

    let shopLockKey = null;

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

      shopLockKey = lock.lockKey;

      const session = await getSession(shop);
      if (!session?.shop || session.shop !== shop) {
        throw new Error("Shop session not available for bulk undo execution");
      }

      const { status } = await getCurrentBulkOperationStatus(session);
      if (status === "RUNNING") {
        throw new RetryableBulkUndoError(
          "Another bulk operation is already running in background",
          "shopify_bulk_busy",
        );
      }

      const claimedHistory = await claimUndo(historyId, shop, executionId, job.id, attempt);
      if (!claimedHistory) {
        return {
          skipped: true,
          reason: "undo_already_processing",
          shop,
          historyId,
        };
      }

      const history = await prisma.editHistory.findFirst({
        where: {
          id: historyId,
          shop,
        },
        select: {
          id: true,
          batch: true,
          rules: true,
          undo: true,
        },
      });

      const rule = Array.isArray(history?.rules) ? history.rules[0] || {} : {};
      const batch = history?.batch && typeof history.batch === "object" ? history.batch : {};
      const undo = normalizeUndoState(history?.undo);
      const limit = batch.size || 75;
      const cursorId = batch.lastProductId || null;

      const products = await prisma.changeRecord.findMany({
        where: {
          editHistoryId: historyId,
          shop,
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
      const { bulkOperationId, lastProductId, count } = await service.undoEditBulkOperation(
        products,
        rule.field,
      );

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

      return {
        success: true,
        shop,
        historyId,
        bulkOperationId,
      };
    } catch (error) {
      const existing = await prisma.editHistory.findFirst({
        where: {
          id: historyId,
          shop,
        },
        select: { undo: true },
      }).catch(() => null);

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
      await releaseExclusiveShopWork(shopLockKey);
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
