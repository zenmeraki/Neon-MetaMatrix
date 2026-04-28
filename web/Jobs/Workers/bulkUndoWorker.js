import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import UndoEditService from "../../services/productService/productBulkUndoService.js";
import { getSession } from "../../utils/sessionHandler.js";
import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import logger from "../../utils/loggerUtils.js";
import { logWorkerError } from "../../utils/errorLogUtils.js";
import { prisma } from "../../config/database.js";
import { bulkUndoExecutionRepository } from "../../repositories/bulkUndoExecutionRepository.js";
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

function calculateUndoDurationMs(startedAt, completedAt) {
  const start = startedAt ? new Date(startedAt).getTime() : NaN;
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();

  if (Number.isNaN(start)) {
    return 0;
  }

  return Math.max(0, end - start);
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

  return history;
}

const bulkUndoWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const data = requireJobData(job, ["shop", "historyId"], "bulk undo");
    const { shop, historyId, source = "undo", executionId = null } = data;
    const attempt = getJobAttempt(job);

    if (!shop || !historyId || !executionId) {
      throw new Error("bulk undo job requires shop, historyId, and executionId");
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
          startedAt: true,
        },
      });

      const rule = Array.isArray(history?.rules) ? history.rules[0] || {} : {};
      const batch = history?.batch && typeof history.batch === "object" ? history.batch : {};
      const undo = normalizeUndoState(history?.undo);
      const service = new UndoEditService(session);
      const limit = batch.size || 75;
      const batchData = await service.prepareUndoBatch({
        historyId,
        executionId,
        limit,
      });

      if (!batchData.products.length) {
        const completedAt = new Date();
        const completion = await bulkUndoExecutionRepository.markCompleted({
          shop,
          executionIdentity: executionId,
        });

        if (completion.count !== 1) {
          throw new Error("Undo execution could not be completed after snapshot exhaustion");
        }

        const completedExecution = await bulkUndoExecutionRepository.findExecution({
          shop,
          executionIdentity: executionId,
        });

        await prisma.editHistory.updateMany({
          where: {
            id: historyId,
            shop,
          },
          data: {
            undoState: BULK_UNDO_STATES.COMPLETED,
            undoCompletedAt: completedAt,
            undo: {
              ...undo,
              status: "completed",
              state: BULK_UNDO_STATES.COMPLETED,
              completedAt,
              processedCount: Number(
                completedExecution?.processedCount ?? undo.processedCount ?? 0,
              ),
              durationMs: calculateUndoDurationMs(
                undo.startedAt || history?.startedAt,
                completedAt,
              ),
              error: null,
            },
            batch: {
              ...batch,
              hasMore: false,
              currentBatchTargetCount: 0,
            },
          },
        });

        await clearKeyCaches(`${shop}:fetchHistories`);
        await clearKeyCaches(`${shop}:historyDetails:${historyId}`);

        return {
          success: true,
          reason: "undo_completed_snapshot_exhausted",
          shop,
          historyId,
        };
      }

      await clearKeyCaches(`${shop}:fetchHistories`);

      const result = await service.undoEditBulkOperation(
        batchData.products,
        rule.field,
      );

      await bulkUndoExecutionRepository.markAwaitingShopify({
        shop,
        executionIdentity: executionId,
        bulkOperationId: result.bulkOperationId,
        lastSnapshotOrdinal: batchData.lastSnapshotOrdinal,
        count: result.count,
      });

      await prisma.editHistory.updateMany({
        where: {
          id: historyId,
          shop,
        },
        data: {
          bulkOperationId: result.bulkOperationId,
          processingBatchId: `${undo.executionIdentity || historyId}:${batchData.lastSnapshotOrdinal || "start"}`,
          batch: {
            ...batch,
            hasMore: batchData.hasMore,
            currentBatchTargetCount: result.count,
          },
          undo: {
            ...undo,
            status: "processing",
            state: BULK_UNDO_STATES.AWAITING_SHOPIFY,
            bulkOperationId: result.bulkOperationId,
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
        bulkOperationId: result.bulkOperationId,
      });

      return {
        success: true,
        shop,
        historyId,
        bulkOperationId: result.bulkOperationId,
      };
    } catch (error) {
      if (executionId) {
        await bulkUndoExecutionRepository.markFailed({
          shop,
          executionIdentity: executionId,
          errorMessage: error.message,
        }).catch(() => {});
      }

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
