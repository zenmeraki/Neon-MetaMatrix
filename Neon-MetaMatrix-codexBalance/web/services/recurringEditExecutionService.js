import { Prisma } from "../generated/prisma/index.js";
import { Queue } from "bullmq";
import { connection } from "../Config/redis.js";
import { prisma } from "../config/database.js";
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
  releaseExclusiveShopWork,
} from "./shopWorkLeaseService.js";

export const RECURRING_EDIT_EXECUTION_QUEUE =
  process.env.RECURRING_EDIT_EXECUTION_QUEUE || "recurring-edit-execution";

const recurringEditExecutionQueue = new Queue(RECURRING_EDIT_EXECUTION_QUEUE, {
  connection,
});

// ✅ Keep advisory lock only for transactional use inside prisma.$transaction
async function tryAdvisoryLock(client, lockKey, transactional = true) {
  if (transactional) {
    const rows = await client.$queryRaw`
      SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS locked
    `;
    return Boolean(rows?.[0]?.locked);
  }

  const rows = await client.$queryRaw`
    SELECT pg_try_advisory_lock(hashtext(${lockKey})) AS locked
  `;
  return Boolean(rows?.[0]?.locked);
}

// ✅ Redis locks for scheduler and shop — replaces pg_advisory_lock session locks
const SCHEDULER_LOCK_KEY = "lock:recurring-edit-scheduler";
const SCHEDULER_LOCK_TTL_MS = 55_000;

async function acquireSchedulerLock() {
  const result = await connection.set(
    SCHEDULER_LOCK_KEY,
    process.pid,
    "NX",
    "PX",
    SCHEDULER_LOCK_TTL_MS,
  );
  return result === "OK";
}

async function releaseSchedulerLock() {
  await connection.del(SCHEDULER_LOCK_KEY).catch(() => {});
}

async function acquireShopLock(shop) {
  const key = `lock:recurring-edit-shop:${shop}`;
  const result = await connection.set(key, process.pid, "NX", "PX", 120_000);
  return { acquired: result === "OK", key };
}

async function releaseShopLock(key) {
  if (key) await connection.del(key).catch(() => {});
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
    run.shop,
    "FAILED",
    { completedAt: new Date(), errorMessage },
  );

  if (!transition.count) return null;

  if (recurringEdit?.id && recurringEdit?.shop) {
    await recurringEditRepository.updateById(recurringEdit.id, recurringEdit.shop, {
      runCount: { increment: 1 },
      lastRunAt: new Date(),
      lastFailureAt: new Date(),
      lastFailureReason: errorMessage,
    });
  }

  return errorMessage;
}

async function markRunSkipped(run, recurringEdit, reason) {
  const transition = await recurringEditRunRepository.markPendingSkipped(run.id, run.shop, {
    completedAt: new Date(),
    errorMessage: reason,
  });

  if (!transition.count) return null;

  if (recurringEdit?.id && recurringEdit?.shop) {
    await recurringEditRepository.updateById(recurringEdit.id, recurringEdit.shop, {
      runCount: { increment: 1 },
      lastRunAt: new Date(),
    });
  }

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
  const hasSchedulerLock = await acquireSchedulerLock();
  if (!hasSchedulerLock) {
    return { scheduled: 0, skipped: 0, reason: "scheduler_locked" };
  }

  try {
    const now = new Date();
    const worker = `recurring-edit-scheduler:${process.pid}`;
    const dueShops = await recurringEditRepository.findDueShops(now, limit);
    const perShopLimit = Math.max(1, Math.ceil(limit / Math.max(dueShops.length, 1)));
    const dueIds = [];
    for (const shop of dueShops) {
      await recurringEditRepository.releaseExpiredClaims({ shop, now }).catch(() => {});
      const shopDueIds = await recurringEditRepository.findDueRecurringEditIds({
        shop,
        now,
        limit: perShopLimit,
      });
      dueIds.push(...shopDueIds);
      if (dueIds.length >= limit) break;
    }
    let scheduled = 0;
    let skipped = 0;

    for (const { id, shop } of dueIds.slice(0, limit)) {
      try {
        const reservation = await prisma.$transaction(async (tx) => {
          const locked = await tryAdvisoryLock(tx, `recurring-edit:${id}`, true);
          if (!locked) return null;

          const recurringEdit = await recurringEditRepository.claimDueRecurringEdit(
            { id, shop, now, worker },
            tx,
          );
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
            recurringEdit.shop,
            tx,
          );

          if (existingRun) {
            await recurringEditRepository.recordDispatch(
              {
                id: recurringEdit.id,
                shop: recurringEdit.shop,
                worker,
                runId: existingRun.id,
                nextRunAt: computeRecurringEditNextRunAt(
                  recurringEdit,
                  new Date(scheduledFor.getTime() + 1000),
                ),
                now,
              },
              tx,
            );
            return { runId: existingRun.id, shop: recurringEdit.shop };
          }

          const run = await recurringEditRunRepository.createByExecutionKey(
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

          await recurringEditRepository.recordDispatch(
            {
              id: recurringEdit.id,
              shop: recurringEdit.shop,
              worker,
              runId: run.id,
              nextRunAt,
              status: nextRunAt ? "ACTIVE" : "COMPLETED",
              now,
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
        await recurringEditRepository.releaseClaim({ id, shop, worker }).catch(() => {});
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
    await releaseSchedulerLock(); // ✅ always releases
  }
}

export async function executeRecurringEditRun(runId, shopFromJob = null) {
  if (!shopFromJob) {
    throw new Error("shop is required to execute a recurring edit run");
  }

  let run = await recurringEditRunRepository.findByIdWithRecurringEdit(runId, shopFromJob);
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

  let exclusiveShopLockKey = null;

  try {
    run = await recurringEditRunRepository.findByIdWithRecurringEdit(runId, shopFromJob);
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

    exclusiveShopLockKey = exclusiveLock.lockKey;

    if (run.editHistoryId) {
      return {
        success: true,
        runId: run.id,
        editHistoryId: run.editHistoryId,
        reused: true,
      };
    }

    const claimed = await recurringEditRunRepository.updatePendingToProcessing(
      run.id,
      currentRecurringEdit.shop,
      { now: new Date(), worker: "recurringEditExecutionService" },
    );
    if (!claimed.count && run.status !== "PROCESSING") {
      return { skipped: true, reason: "run_not_claimed" };
    }

    const session = await getSession(currentRecurringEdit.shop);
    if (!session?.shop || session.shop !== currentRecurringEdit.shop) {
      throw new Error("Shop session not available for recurring edit execution");
    }

    const { status } = await getCurrentBulkOperationStatus(session);
    if (status === "RUNNING") {
      return buildDeferredResult("shopify_bulk_busy", run.id, currentRecurringEdit.id);
    }

    const service = new ProductBulkService(session);
    const body = buildRecurringEditHistoryBody(currentRecurringEdit);
    const baseHistory = await service._bulkOperationEdit(body, {
      planName: "Pro Monthly",
      isUnlimited: true,
      limit: Number.MAX_SAFE_INTEGER,
    });

    const localizedTitle = await createMultiLanguage(currentRecurringEdit.title);
    const editHistory = await prisma.editHistory.create({
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

    const frozenCount = await service.freezeEditHistoryTargets(editHistory.id);
    await prisma.editHistory.update({
      where: { id: editHistory.id },
      data: {
        totalItems: frozenCount,
        targetSnapshotCount: frozenCount,
        executionState: "queued",
      },
    });

    const queuedHistory = await prisma.editHistory.findUnique({
      where: { id: editHistory.id },
      select: { executionIdentity: true },
    });

    await recurringEditRunRepository.updateById(run.id, currentRecurringEdit.shop, {
      editHistoryId: editHistory.id,
    });

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
    await releaseExclusiveShopWork(exclusiveShopLockKey);
    await releaseShopLock(shopLock.key); // ✅ Redis release
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
      shop: true,
      completedAt: true,
      status: true,
    },
  });

  if (!history?.recurringRunId || !history?.recurringEditId) {
    return null;
  }

  const run = await recurringEditRunRepository.findById(history.recurringRunId, history.shop);
  if (!run || isTerminalRunStatus(run.status)) {
    return run;
  }

  if (run.shop !== history.shop) {
    throw new Error("Cross-shop recurring run finalization blocked");
  }

  const completedAt = history.completedAt || new Date();
  const normalizedStatus =
    status === "SUCCESS" || history.status === "completed" ? "SUCCESS" : "FAILED";

  const transition = await recurringEditRunRepository.markProcessingFinished(
    history.recurringRunId,
    run.shop,
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

  await recurringEditRepository.updateById(history.recurringEditId, run.shop, {
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
