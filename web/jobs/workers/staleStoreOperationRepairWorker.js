import { prisma } from "../../config/database.js";
import logger from "../../utils/loggerUtils.js";
import { alertingService } from "../../services/operationalAlertService.js";
import {
  OPERATION_QUEUE_NAMES,
  addShopScopedJob,
  buildOperationJobId,
  createOperationWorker,
} from "../queues/operationQueueRegistry.js";
import { addbulkExportJob, getBulkExportQueue } from "../queues/bulkExportJob.js";
import { transitionOperation } from "../../services/operationTransitionService.js";

const REPAIR_INTERVAL_MS = 2 * 60 * 1000;
const STALE_OPERATION_MS = 2 * 60 * 1000;
const STALE_SCHEDULED_RUN_MS = 30 * 60 * 1000;
const QUEUED_EXPORT_MISSING_JOB_MS = 5 * 60 * 1000;
const STALE_SUBMISSION_MS = 30 * 60 * 1000;
const STALE_MERCHANT_OPERATION_MS = 60 * 60 * 1000;

function normalizeMerchantOperationStatus(status) {
  return String(status || "").toUpperCase();
}

function mapLegacyEditStateToOperationStatus(row) {
  const executionState = String(row?.executionState || "").toLowerCase();
  const status = String(row?.status || "").toLowerCase();

  if (["completed", "success"].includes(status)) return "COMPLETED";
  if (["failed", "partial"].includes(status)) return "FAILED";
  if (executionState === "awaiting_shopify") return "AWAITING_SHOPIFY";
  if (executionState === "finalizing") return "APPLYING_RESULTS";
  if (executionState === "dispatching") return "DISPATCHING";
  if (executionState === "snapshotting") return "SNAPSHOTTING";
  if (executionState === "snapshotted") return "SNAPSHOTTED";
  return "PLANNED";
}

async function repairStaleStoreOperations() {
  const expired = await prisma.merchantOperation.findMany({
    where: {
      status: { in: ["DISPATCHING", "AWAITING_SHOPIFY", "APPLYING_RESULTS"] },
      updatedAt: {
        lt: new Date(Date.now() - STALE_OPERATION_MS),
      },
    },
    select: {
      id: true,
      shop: true,
    },
  });

  if (!expired.length) {
    return { expiredCount: 0 };
  }

  const expiredIds = expired.map((operation) => operation.id);

  for (const operation of expired) {
    try {
      await transitionOperation({
        shop: operation.shop,
        operationId: operation.id,
        from: "DISPATCHING",
        to: "FAILED",
        data: {
          failedAt: new Date(),
          errorCode: "OPERATION_HEARTBEAT_EXPIRED",
          errorMessage: "Operation heartbeat expired.",
        },
      });
    } catch (_error) {
      try {
        await transitionOperation({
          shop: operation.shop,
          operationId: operation.id,
          from: "AWAITING_SHOPIFY",
          to: "FAILED",
          data: {
            failedAt: new Date(),
            errorCode: "OPERATION_HEARTBEAT_EXPIRED",
            errorMessage: "Operation heartbeat expired.",
          },
        });
      } catch (_innerError) {
        await transitionOperation({
          shop: operation.shop,
          operationId: operation.id,
          from: "APPLYING_RESULTS",
          to: "FAILED",
          data: {
            failedAt: new Date(),
            errorCode: "OPERATION_HEARTBEAT_EXPIRED",
            errorMessage: "Operation heartbeat expired.",
          },
        }).catch(() => {});
      }
    }
  }

  const BATCH_SIZE = 100;
  for (let index = 0; index < expired.length; index += BATCH_SIZE) {
    const slice = expired.slice(index, index + BATCH_SIZE);
    // Bounded fan-out prevents connection spikes on large expiry bursts.
    await Promise.all(
      slice.map((operation) =>
        prisma.storeOperationalState.updateMany({
          where: {
            shop: operation.shop,
            activeWriteOperationId: operation.id,
          },
          data: {
            activeWriteOperationId: null,
          },
        }),
      ),
    );
  }

  logger.warn("Expired stale store operations", {
    expiredCount: expired.length,
    operationIds: expiredIds,
  });

  if (expired.length >= Number(process.env.LEASE_EXPIRY_SPIKE_THRESHOLD || 5)) {
    alertingService.leaseExpirySpike({
      expiredCount: expired.length,
      operationIds: expiredIds,
    });
  }

  return { expiredCount: expired.length };
}

async function repairStuckScheduledRuns() {
  const staleCutoff = new Date(Date.now() - STALE_SCHEDULED_RUN_MS);
  const stuck = await prisma.scheduledExportRun.findMany({
    where: {
      status: "PROCESSING",
      exportJobId: null,
      startedAt: { lt: staleCutoff },
    },
    select: { id: true, shop: true },
  });

  if (!stuck.length) return { repairedCount: 0 };

  const ids = stuck.map((row) => row.id);
  await prisma.scheduledExportRun.updateMany({
    where: { id: { in: ids }, status: "PROCESSING", exportJobId: null },
    data: {
      status: "FAILED",
      errorMessage: "RUN_STUCK_WITHOUT_EXPORT_JOB",
      completedAt: new Date(),
    },
  });

  return { repairedCount: ids.length };
}

async function repairQueuedExportsWithoutBullJobs() {
  if (String(process.env.SKIP_QUEUE_REPAIR_CHECK || "") === "true") {
    return { skipped: true, reason: "queue_repair_disabled" };
  }

  const staleCutoff = new Date(Date.now() - QUEUED_EXPORT_MISSING_JOB_MS);
  const queued = await prisma.exportJob.findMany({
    where: {
      status: "PENDING",
      executionState: "queued",
      createdAt: { lt: staleCutoff },
    },
    select: { id: true, shop: true, fields: true },
    take: 100,
  });

  if (!queued.length) return { requeuedCount: 0 };

  const queue = getBulkExportQueue();
  let requeuedCount = 0;
  for (const job of queued) {
    const jobId = `export:${job.shop}:${job.id}`;
    const existing = await queue.getJob(jobId);
    if (existing) continue;

    await addbulkExportJob({
      exportJobId: job.id,
      shop: job.shop,
      fields: Array.isArray(job.fields) ? job.fields : [],
      source: "repair_export_missing_queue_job",
      executionId: job.id,
    }, { jobId });
    requeuedCount += 1;
  }

  return { requeuedCount };
}

async function repairStaleSubmittedWithoutFinalization() {
  const staleCutoff = new Date(Date.now() - STALE_SUBMISSION_MS);
  const stale = await prisma.operationSubmission.findMany({
    where: {
      status: "AWAITING_SHOPIFY",
      updatedAt: { lt: staleCutoff },
    },
    select: {
      id: true,
      shop: true,
      merchantOperationId: true,
      bulkOperationId: true,
      metadata: true,
    },
    take: 100,
  });

  if (!stale.length) return { flaggedCount: 0 };

  for (const row of stale) {
    await prisma.operationFailure.create({
      data: {
        shop: row.shop,
        operationId: row.merchantOperationId,
        entityId: row.metadata?.historyId || row.id,
        errorCode: "SUBMISSION_FINALIZATION_STALLED",
        errorMessage: `Submission ${row.id} stalled in AWAITING_SHOPIFY`,
      },
    }).catch(() => {});
  }

  return { flaggedCount: stale.length };
}

async function reconcileLegacyHistoryWithMerchantOperation() {
  const missingEditOperationLink = await prisma.editHistory.count({
    where: {
      operationId: null,
      status: { not: "pending" },
    },
  });

  const missingExportOperationLink = await prisma.exportHistory.count({
    where: {
      operationId: null,
    },
  });

  const candidateMismatches = await prisma.editHistory.findMany({
    where: {
      operationId: { not: null },
    },
    select: {
      id: true,
      shop: true,
      status: true,
      executionState: true,
      operation: {
        select: {
          id: true,
          status: true,
        },
      },
    },
    take: 500,
    orderBy: { updatedAt: "desc" },
  });

  const mismatches = candidateMismatches.filter((row) => {
    const parent = row.operation;
    if (!parent?.id) return false;
    return mapLegacyEditStateToOperationStatus(row) !== normalizeMerchantOperationStatus(parent.status);
  });

  const staleCutoff = new Date(Date.now() - STALE_MERCHANT_OPERATION_MS);
  const staleOps = await prisma.merchantOperation.findMany({
    where: {
      status: { in: ["SNAPSHOTTING", "DISPATCHING", "AWAITING_SHOPIFY", "APPLYING_RESULTS"] },
      updatedAt: { lt: staleCutoff },
    },
    select: { id: true, shop: true, status: true },
    take: 200,
  });

  let repairedStaleOps = 0;
  for (const op of staleOps) {
    try {
      await transitionOperation({
        shop: op.shop,
        operationId: op.id,
        from: op.status,
        to: "FAILED",
        data: {
          failedAt: new Date(),
          errorCode: "OPERATION_STUCK_TTL_EXPIRED",
          errorMessage: "Operation exceeded recovery TTL and was failed by reconciler",
        },
      });
      repairedStaleOps += 1;
    } catch (_error) {}
  }

  return {
    missingLinks: {
      editHistory: missingEditOperationLink,
      exportHistory: missingExportOperationLink,
    },
    statusMismatchCount: mismatches.length,
    staleOperationFailedCount: repairedStaleOps,
  };
}

export async function runRecoverySweeperPass() {
  const [ops, runs, exports, submissions, reconciliation] = await Promise.all([
    repairStaleStoreOperations().catch((error) => ({ error: error.message })),
    repairStuckScheduledRuns().catch((error) => ({ error: error.message })),
    repairQueuedExportsWithoutBullJobs().catch((error) => ({ error: error.message })),
    repairStaleSubmittedWithoutFinalization().catch((error) => ({ error: error.message })),
    reconcileLegacyHistoryWithMerchantOperation().catch((error) => ({ error: error.message })),
  ]);
  return { ops, runs, exports, submissions, reconciliation };
}

const staleStoreOperationRepairWorker = {
  interval: null,
  worker: createOperationWorker(
    OPERATION_QUEUE_NAMES.OPERATION_REPAIR,
    async () => runRecoverySweeperPass(),
    { concurrency: 1 },
  ),

  start() {
    if (this.interval) return this;

    this.interval = setInterval(() => {
      addShopScopedJob(
        OPERATION_QUEUE_NAMES.OPERATION_REPAIR,
        "repair",
        { shop: "all", operationId: "stale-operation-repair" },
        {
          jobId: buildOperationJobId(OPERATION_QUEUE_NAMES.OPERATION_REPAIR, {
            runAt: new Date(),
          }),
        },
      ).catch((error) => {
        logger.error("Stale store operation repair failed", {
          message: error.message,
        });
      });
    }, REPAIR_INTERVAL_MS);

    this.interval.unref?.();
    return this;
  },

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  },
};

if (String(process.env.DISABLE_STALE_OPERATION_REPAIR_AUTOSTART || "") !== "true") {
  staleStoreOperationRepairWorker.start();
}

export { repairStaleStoreOperations, staleStoreOperationRepairWorker };
export default staleStoreOperationRepairWorker;
