import { Prisma } from "../generated/prisma/index.js";
import { Queue } from "bullmq";
import { connection } from "../Config/redis.js";
import { prisma } from "../Config/database.js";
import { recurringEditRepository } from "../repositories/recurringEditRepository.js";
import { recurringEditRunRepository } from "../repositories/recurringEditRunRepository.js";
import { computeRecurringEditNextRunAt } from "./recurringEditScheduleService.js";
import { getSession } from "../utils/sessionHandler.js";
import { logWorkerError } from "../utils/errorLogUtils.js";
import logger from "../utils/loggerUtils.js";
import ProductBulkService from "./productService/productBulkEditService.js";
import { addbulkEditJob } from "../Jobs/Queues/bulkEditJob.js";
import { createMultiLanguage } from "../utils/googleTranslator.js";
import { getCurrentBulkOperationStatus } from "../utils/bulkOperationHelper.js";
import {
  acquireExclusiveShopWork,
  assertExclusiveShopWorkLeaseActive,
  releaseExclusiveShopWork,
  startExclusiveShopWorkRenewal,
} from "./shopWorkLeaseService.js";
import {
  acquireRedisLock,
  releaseRedisLock,
  renewRedisLock,
} from "../utils/redisLockUtils.js";
import { logBatchEvent } from "../utils/batchObservability.js";

export const RECURRING_EDIT_EXECUTION_QUEUE =
  process.env.RECURRING_EDIT_EXECUTION_QUEUE || "recurring-edit-execution";

const recurringEditExecutionQueue = new Queue(RECURRING_EDIT_EXECUTION_QUEUE, {
  connection,
});

// ✅ Keep advisory lock only for transactional use inside prisma.$transaction
async function tryAdvisoryLock(client, lockKey) {
  const rows = await client.$queryRaw`
    SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS locked
  `;
  return Boolean(rows?.[0]?.locked);
}

// ✅ Redis locks for scheduler and shop — replaces pg_advisory_lock session locks
const SCHEDULER_LOCK_KEY = "lock:recurring-edit-scheduler";
const SCHEDULER_LOCK_TTL_MS = 55_000;

async function acquireSchedulerLock() {
  return acquireRedisLock(connection, SCHEDULER_LOCK_KEY, SCHEDULER_LOCK_TTL_MS);
}

async function releaseSchedulerLock(lock) {
  await releaseRedisLock(connection, lock).catch(() => {});
}

async function acquireShopLock(shop) {
  const key = `lock:recurring-edit-shop:${shop}`;
  return acquireRedisLock(connection, key, 120_000);
}

async function releaseShopLock(lock) {
  await releaseRedisLock(connection, lock).catch(() => {});
}

function buildExecutionKey(recurringEditId, scheduledFor) {
  return `${recurringEditId}:${new Date(scheduledFor).toISOString()}`;
}

function isTerminalRunStatus(status) {
  return ["SUCCESS", "FAILED", "SKIPPED"].includes(status);
}

function isRunnableRecurringEdit(recurringEdit) {
  return recurringEdit && !recurringEdit.isDeleted && recurringEdit.status === "ACTIVE";
}

function buildDeferredResult(reason, runId, recurringEditId = null) {
  return {
    success: true,
    deferred: true,
    reason,
    runId,
    recurringEditId,
  };
}

function buildRecurringEditHistoryBody(recurringEdit) {
  const [rule] = Array.isArray(recurringEdit.rules) ? recurringEdit.rules : [];
  if (!rule) {
    throw new Error("Recurring edit rule not found");
  }

  return {
    rules: recurringEdit.rules,
    editedField: rule.field,
    editedType: rule.editOption,
    filterParams: Array.isArray(recurringEdit.filterParams)
      ? recurringEdit.filterParams
      : [],
    value: rule.value ?? null,
    searchKey: rule.searchKey ?? null,
    replaceText: rule.replaceText ?? null,
    supportValue: rule.supportValue ?? null,
    locationId: rule.locationId ?? null,
  };
}

async function markRunFailed(run, recurringEdit, errorMessage) {
  const transition = await recurringEditRunRepository.markProcessingFinished(
    run.id,
    "FAILED",
    { errorMessage },
  );

  if (!transition.count) return null;

  await recurringEditRepository.updateById(recurringEdit.id, {
    runCount: { increment: 1 },
    lastRunAt: new Date(),
    lastFailureAt: new Date(),
    lastFailureReason: errorMessage,
  });

  return errorMessage;
}

async function markRunSkipped(run, recurringEdit, reason) {
  const transition = await recurringEditRunRepository.markPendingSkipped(run.id, {
    errorMessage: reason,
  });

  if (!transition.count) return null;

  await recurringEditRepository.updateById(recurringEdit.id, {
    runCount: { increment: 1 },
    lastRunAt: new Date(),
  });

  return reason;
}

export async function enqueueRecurringEditExecutionJob({ runId, shop }) {
  return recurringEditExecutionQueue.add(
    "recurring-edit-execution",
    { runId, shop },
    {
      jobId: runId,
      removeOnComplete: 100,
      removeOnFail: 100,
      attempts: 6,
      backoff: {
        type: "exponential",
        delay: 30_000,
      },
    },
  );
}

export async function scheduleDueRecurringEditRuns({ limit = 100 } = {}) {
  // ✅ Redis lock instead of pg_advisory_lock
  const schedulerLock = await acquireSchedulerLock();
  if (!schedulerLock.acquired) {
    return { scheduled: 0, skipped: 0, reason: "scheduler_locked" };
  }

  let schedulerRenewInterval = null;
  let schedulerLockLost = false;
  try {
    schedulerRenewInterval = setInterval(async () => {
      const renewed = await renewRedisLock(connection, schedulerLock).catch(() => false);
      if (!renewed) {
        schedulerLockLost = true;
        clearInterval(schedulerRenewInterval);
      }
    }, 30_000);

    const now = new Date();
    const dueIds = await recurringEditRepository.findDueRecurringEditIds(now, limit);
    let scheduled = 0;
    let skipped = 0;

    for (const { id } of dueIds) {
      if (schedulerLockLost) {
        skipped += 1;
        break;
      }

      try {
        const reservation = await prisma.$transaction(async (tx) => {
          const locked = await tryAdvisoryLock(tx, `recurring-edit:${id}`, true);
          if (!locked) return null;

          const recurringEdit = await recurringEditRepository.findById(id, tx);
          if (
            !isRunnableRecurringEdit(recurringEdit) ||
            !recurringEdit.nextRunAt ||
            recurringEdit.nextRunAt > now
          ) {
            return null;
          }

          const scheduledFor = recurringEdit.nextRunAt;
          const executionKey = buildExecutionKey(id, scheduledFor);
          const existingRun = await recurringEditRunRepository.findByExecutionKey(
            executionKey,
            tx,
          );

          if (existingRun) {
            return { runId: existingRun.id, shop: recurringEdit.shop };
          }

          const run = await recurringEditRunRepository.create(
            {
              recurringEditId: recurringEdit.id,
              shop: recurringEdit.shop,
              scheduledFor,
              status: "PENDING",
              executionKey,
            },
            tx,
          );

          const nextRunAt = computeRecurringEditNextRunAt(
            recurringEdit,
            new Date(scheduledFor.getTime() + 1000),
          );

          await recurringEditRepository.updateById(
            recurringEdit.id,
            {
              nextRunAt,
              status: nextRunAt ? "ACTIVE" : "COMPLETED",
            },
            tx,
          );

          return { runId: run.id, shop: recurringEdit.shop };
        });

        if (!reservation?.runId) {
          skipped += 1;
          continue;
        }

        await enqueueRecurringEditExecutionJob({
          runId: reservation.runId,
          shop: reservation.shop,
        });
        scheduled += 1;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          skipped += 1;
          continue;
        }

        await logWorkerError({
          shop: "unknown",
          err: error,
          source: "RecurringEditExecutionService.scheduleDueRecurringEditRuns",
        });
        skipped += 1;
      }
    }

    return { scheduled, skipped, scanned: dueIds.length };
  } finally {
    if (schedulerRenewInterval) {
      clearInterval(schedulerRenewInterval);
    }
    await releaseSchedulerLock(schedulerLock); // ✅ always releases
  }
}

export async function executeRecurringEditRun(runId, shopFromJob = null) {
  let run = await recurringEditRunRepository.findByIdWithRecurringEdit(runId);
  if (!run) return { skipped: true, reason: "run_not_found" };

  if (isTerminalRunStatus(run.status)) {
    return { skipped: true, reason: "run_already_completed" };
  }

  const recurringEdit = run.recurringEdit;
  if (shopFromJob && recurringEdit?.shop && recurringEdit.shop !== shopFromJob) {
    throw new Error("Cross-shop recurring edit execution blocked");
  }
  if (!isRunnableRecurringEdit(recurringEdit)) {
    await markRunSkipped(run, recurringEdit || { id: run.recurringEditId }, "Recurring edit is not active");
    return { skipped: true, reason: "recurring_edit_inactive" };
  }

  // ✅ Redis lock instead of pg_advisory_lock
  const shopLock = await acquireShopLock(recurringEdit.shop);
  if (!shopLock.acquired) {
    return buildDeferredResult("shop_execution_locked", run.id, recurringEdit.id);
  }

  let shopLease = null;
  let leaseRenewal = null;
  let shopRenewInterval = null;

  try {
    shopRenewInterval = setInterval(async () => {
      const renewed = await renewRedisLock(connection, shopLock, 120_000).catch(() => false);
      if (!renewed) {
        clearInterval(shopRenewInterval);
      }
    }, 60_000);

    run = await recurringEditRunRepository.findByIdWithRecurringEdit(runId);
    if (!run || isTerminalRunStatus(run.status)) {
      return { skipped: true, reason: "run_not_actionable" };
    }

    const currentRecurringEdit = run.recurringEdit;
    if (!isRunnableRecurringEdit(currentRecurringEdit)) {
      await markRunSkipped(run, currentRecurringEdit, "Recurring edit is not active");
      return { skipped: true, reason: "recurring_edit_inactive_after_lock" };
    }

    const exclusiveLock = await acquireExclusiveShopWork({
      shop: currentRecurringEdit.shop,
      activity: "recurring_edit_execution",
      worker: "recurringEditExecutionService",
      queue: RECURRING_EDIT_EXECUTION_QUEUE,
      jobId: run.id,
      entityType: "recurringEditRun",
      entityId: run.id,
      executionId: run.id,
    });

    if (!exclusiveLock.acquired) {
      return buildDeferredResult("shop_work_conflict", run.id, currentRecurringEdit.id);
    }

    shopLease = exclusiveLock;
    leaseRenewal = startExclusiveShopWorkRenewal(exclusiveLock, {
      onRenewalError: (error) => {
        logger.error("Failed to renew recurring edit lease", {
          shop: currentRecurringEdit.shop,
          runId: run.id,
          error: error.message,
        });
      },
    });

    if (run.editHistoryId) {
      return {
        success: true,
        runId: run.id,
        editHistoryId: run.editHistoryId,
        reused: true,
      };
    }

    const claimed = await recurringEditRunRepository.updatePendingToProcessing(run.id);
    if (!claimed.count && run.status !== "PROCESSING") {
      return { skipped: true, reason: "run_not_claimed" };
    }

    const session = await getSession(currentRecurringEdit.shop);
    if (!session?.shop || session.shop !== currentRecurringEdit.shop) {
      throw new Error("Shop session not available for recurring edit execution");
    }

    assertExclusiveShopWorkLeaseActive(shopLease);
    const { status } = await getCurrentBulkOperationStatus(session);
    if (["CREATED", "RUNNING", "CANCELING"].includes(status)) {
      return buildDeferredResult("shopify_bulk_busy", run.id, currentRecurringEdit.id);
    }

    const service = new ProductBulkService(session);
    const body = buildRecurringEditHistoryBody(currentRecurringEdit);
    assertExclusiveShopWorkLeaseActive(shopLease);
    const baseHistory = await service._bulkOperationEdit(body, {
      planName: "Pro Monthly",
      isUnlimited: true,
      limit: Number.MAX_SAFE_INTEGER,
      path: "scheduler",
    });

    assertExclusiveShopWorkLeaseActive(shopLease);
    const localizedTitle = await createMultiLanguage(currentRecurringEdit.title);
    const { editHistory, frozenSnapshot } = await prisma.$transaction(async (tx) => {
      const createdHistory = await tx.editHistory.create({
        data: {
          ...baseHistory,
          title: localizedTitle,
          type: "Recurring edit",
          isRecurring: true,
          recurringEditId: currentRecurringEdit.id,
          recurringRunId: run.id,
          triggerType: "RECURRING",
        },
      });

      const snapshot = await service.freezeEditHistoryTargets(createdHistory.id, {
        client: tx,
      });

      const queuedHistory = await tx.editHistory.update({
        where: { id: createdHistory.id },
        data: {
          totalItems: snapshot.count,
          targetSnapshotCount: snapshot.count,
          targetSnapshotSetId: snapshot.targetSnapshotSetId,
          targetLevel: snapshot.targetLevel,
          executionState: "queued",
        },
      });

      return { editHistory: queuedHistory, frozenSnapshot: snapshot };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    logBatchEvent("catalog_batch_edit_execution", {
      shop: currentRecurringEdit.shop,
      oldMirrorBatchId:
        baseHistory.targetMirrorBatchId &&
        baseHistory.targetMirrorBatchId !==
          (baseHistory.targetCatalogBatchId || baseHistory.targetMirrorBatchId)
          ? baseHistory.targetMirrorBatchId
          : null,
      resolvedCatalogBatchId:
        baseHistory.targetCatalogBatchId || baseHistory.targetMirrorBatchId,
      path: "scheduler",
      extra: {
        runId: run.id,
        recurringEditId: currentRecurringEdit.id,
        editHistoryId: editHistory.id,
        targetSnapshotSetId: frozenSnapshot.targetSnapshotSetId,
        targetCount: frozenSnapshot.count,
      },
    });

    const queuedHistory = await prisma.editHistory.findUnique({
      where: { id: editHistory.id },
      select: { executionIdentity: true },
    });

    await recurringEditRunRepository.updateById(run.id, {
      editHistoryId: editHistory.id,
    });

    assertExclusiveShopWorkLeaseActive(shopLease);
    await addbulkEditJob({
      historyId: editHistory.id,
      shop: currentRecurringEdit.shop,
      source: "recurring_edit",
      executionId:
        queuedHistory?.executionIdentity || editHistory.executionIdentity || editHistory.id,
    });

    logger.info("Recurring edit execution queued", {
      shop: currentRecurringEdit.shop,
      runId: run.id,
      recurringEditId: currentRecurringEdit.id,
      editHistoryId: editHistory.id,
    });

    return {
      success: true,
      runId: run.id,
      editHistoryId: editHistory.id,
    };
  } catch (error) {
    await markRunFailed(run, recurringEdit, error.message || "Recurring edit execution failed").catch(() => {});
    await logWorkerError({
      shop: recurringEdit.shop,
      err: error,
      source: "RecurringEditExecutionService.executeRecurringEditRun",
    });
    throw error;
  } finally {
    if (shopRenewInterval) {
      clearInterval(shopRenewInterval);
    }

    if (leaseRenewal) {
      clearInterval(leaseRenewal);
    }

    await releaseExclusiveShopWork(shopLease);
    await releaseShopLock(shopLock); // ✅ Redis release
  }
}

export async function finalizeRecurringRunFromHistory({
  historyId,
  status,
  errorMessage = null,
}) {
  const history = await prisma.editHistory.findUnique({
    where: { id: historyId },
    select: {
      recurringRunId: true,
      recurringEditId: true,
      completedAt: true,
      status: true,
    },
  });

  if (!history?.recurringRunId || !history?.recurringEditId) {
    return null;
  }

  const run = await recurringEditRunRepository.findById(history.recurringRunId);
  if (!run || isTerminalRunStatus(run.status)) {
    return run;
  }

  const completedAt = history.completedAt || new Date();
  const normalizedStatus =
    status === "SUCCESS" || history.status === "completed" ? "SUCCESS" : "FAILED";

  const transition = await recurringEditRunRepository.markProcessingFinished(
    history.recurringRunId,
    normalizedStatus,
    {
      completedAt,
      errorMessage:
        normalizedStatus === "FAILED"
          ? errorMessage || "Recurring run failed"
          : null,
    },
  );

  if (!transition.count) {
    return run.status;
  }

  await recurringEditRepository.updateById(history.recurringEditId, {
    runCount: { increment: 1 },
    lastRunAt: completedAt,
    ...(normalizedStatus === "SUCCESS"
      ? { lastSuccessAt: completedAt, lastFailureReason: null }
      : {
          lastFailureAt: completedAt,
          lastFailureReason: errorMessage || "Recurring run failed",
        }),
  });

  return normalizedStatus;
}
