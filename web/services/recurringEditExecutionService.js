import { Prisma } from "../generated/prisma/index.js";
import crypto from "crypto";
import { Queue } from "bullmq";
import { connection } from "../config/redis.js";
import { prisma } from "../config/database.js";
import { merchantOperationRepository } from "../repositories/merchantOperationRepository.js";
import { bulkEditHistoryRepository } from "../repositories/bulkEditHistoryRepository.js";
import { recurringEditRepository } from "../repositories/recurringEditRepository.js";
import { recurringEditRunRepository } from "../repositories/recurringEditRunRepository.js";
import { computeRecurringEditNextRunAt } from "./recurringEditScheduleService.js";
import { getSession } from "../utils/sessionHandler.js";
import { logWorkerError } from "../utils/errorLogUtils.js";
import logger from "../utils/loggerUtils.js";
import ProductBulkService from "./productService/productBulkEditService.js";
import { bulkTargetFreezeQueue } from "../jobs/queues/bulkTargetFreezeQueue.js";
import { createMultiLanguage } from "../utils/googleTranslator.js";
import { applyQueueBackpressure } from "../jobs/queues/queueBackpressure.js";
import {
  acquireExclusiveShopWork,
  assertLeaseOwner,
  releaseExclusiveShopWork,
} from "./shopWorkLeaseService.js";
import {
  getFrozenTargetSnapshotSummary,
  resolveCanonicalProductTarget,
} from "./productService/productTargetingService.js";
import {
  BulkEditSource,
  createBulkEditIntent,
} from "../shared/bulkEdit/bulkEditIntent.schema.js";

export const RECURRING_EDIT_EXECUTION_QUEUE =
  process.env.RECURRING_EDIT_EXECUTION_QUEUE || "recurring-edit-execution";

const recurringEditExecutionQueue = applyQueueBackpressure(
  new Queue(RECURRING_EDIT_EXECUTION_QUEUE, {
    connection,
  }),
);

function assertExecutionClaimed(result, code = "EXECUTION_CLAIM_FAILED") {
  if (Number(result?.count || 0) !== 1) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
}

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
const SHOP_LOCK_TTL_MS = 120_000;
const LOCK_HEARTBEAT_INTERVAL_MS = 15_000;

const REDIS_COMPARE_AND_DELETE_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

const REDIS_COMPARE_AND_PEXPIRE_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
`;

function buildLockToken(scope) {
  return `${scope}:${process.pid}:${crypto.randomUUID()}`;
}

async function releaseOwnedLock(key, token) {
  if (!key || !token) return false;
  const released = await connection.eval(REDIS_COMPARE_AND_DELETE_LUA, 1, key, token);
  return Number(released || 0) === 1;
}

async function extendOwnedLock(key, token, ttlMs) {
  if (!key || !token) return false;
  const extended = await connection.eval(
    REDIS_COMPARE_AND_PEXPIRE_LUA,
    1,
    key,
    token,
    String(ttlMs),
  );
  return Number(extended || 0) === 1;
}

async function acquireSchedulerLock() {
  const token = buildLockToken("recurring-edit-scheduler");
  const result = await connection.set(
    SCHEDULER_LOCK_KEY,
    token,
    "NX",
    "PX",
    SCHEDULER_LOCK_TTL_MS,
  );
  return result === "OK"
    ? { acquired: true, key: SCHEDULER_LOCK_KEY, token }
    : { acquired: false, key: SCHEDULER_LOCK_KEY, token: null };
}

async function releaseSchedulerLock(lock) {
  await releaseOwnedLock(lock?.key, lock?.token).catch(() => {});
}

async function acquireShopLock(shop) {
  const key = `lock:recurring-edit-shop:${shop}`;
  const token = buildLockToken(`recurring-edit-shop:${shop}`);
  const result = await connection.set(key, token, "NX", "PX", SHOP_LOCK_TTL_MS);
  return { acquired: result === "OK", key, token };
}

async function releaseShopLock(lock) {
  await releaseOwnedLock(lock?.key, lock?.token).catch(() => {});
}

function startLockHeartbeat(lock, ttlMs) {
  if (!lock?.key || !lock?.token) {
    return () => {};
  }

  const timer = setInterval(() => {
    extendOwnedLock(lock.key, lock.token, ttlMs).catch(() => {});
  }, LOCK_HEARTBEAT_INTERVAL_MS);

  return () => clearInterval(timer);
}

function buildExecutionKey(recurringEditId, scheduledFor) {
  return `${recurringEditId}:${new Date(scheduledFor).toISOString()}`;
}

function getScheduleFingerprint(recurringEdit) {
  const fingerprint =
    recurringEdit?.scheduleConfig?.__scheduleDeterminism?.scheduleFingerprint;
  return typeof fingerprint === "string" && fingerprint ? fingerprint : "schedule-fp-unknown";
}

function buildScheduleExecutionKey(recurringEditId, scheduledFor, scheduleFingerprint) {
  return `${buildExecutionKey(recurringEditId, scheduledFor)}:${scheduleFingerprint}`;
}

function getSchedulerWatermark(scheduleConfig) {
  const watermark = scheduleConfig?.__schedulerWatermark;
  return {
    occurrenceIndex: Number(watermark?.occurrenceIndex || 0),
    lastScheduledOccurrence: watermark?.lastScheduledOccurrence || null,
  };
}

function withSchedulerWatermark(scheduleConfig, scheduledFor, occurrenceIndex) {
  const base =
    scheduleConfig && typeof scheduleConfig === "object" && !Array.isArray(scheduleConfig)
      ? { ...scheduleConfig }
      : {};
  return {
    ...base,
    __schedulerWatermark: {
      occurrenceIndex,
      lastScheduledOccurrence: new Date(scheduledFor).toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

function buildRunSnapshotFingerprint(recurringEdit, scheduledFor) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        recurringEditId: recurringEdit.id,
        shop: recurringEdit.shop,
        scheduledFor: new Date(scheduledFor).toISOString(),
        scheduleFingerprint:
          recurringEdit?.scheduleConfig?.__scheduleDeterminism?.scheduleFingerprint || null,
        filterParams: Array.isArray(recurringEdit.filterParams)
          ? recurringEdit.filterParams
          : [],
        rules: Array.isArray(recurringEdit.rules) ? recurringEdit.rules : [],
      }),
    )
    .digest("hex");
}

function isTerminalRunStatus(status) {
  return [
    "SUCCESS",
    "FAILED",
    "SKIPPED",
    "CANCELLED",
    "ABANDONED",
    "FAILED_FINAL",
    "TIMED_OUT",
  ].includes(status);
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

function buildRecurringEditHistoryBody(recurringEdit, targetSnapshotId) {
  const [rule] = Array.isArray(recurringEdit.rules) ? recurringEdit.rules : [];
  if (!rule) {
    throw new Error("Recurring edit rule not found");
  }

  const intent = createBulkEditIntent({
    shop: recurringEdit.shop,
    actorId: null,
    source: BulkEditSource.RECURRING_RULE_RUN,
    runtimeRule: {
      filterParams: Array.isArray(recurringEdit.filterParams)
        ? recurringEdit.filterParams
        : [],
    },
    field: rule.field,
    editType: rule.editOption,
    value:
      rule.searchKey || rule.replaceText
        ? {
            type: "SEARCH_REPLACE",
            search: rule.searchKey || "",
            replace: rule.replaceText || "",
            caseSensitive: false,
          }
        : Array.isArray(rule.value)
        ? { type: "ARRAY", items: rule.value }
        : { type: "RAW", value: rule.value ?? "" },
    locationId: rule.locationId ?? null,
    confirmationToken: "RECURRING_RULE_RUN",
    idempotencyKey: `recurring-run:${recurringEdit.id}:${targetSnapshotId}`,
    metadata: {
      recurringEditId: recurringEdit.id,
      recurringRuleRun: true,
    },
  });

  return {
    editedField: rule.field,
    editedType: rule.editOption,
    filterParams: [],
    value: rule.value ?? null,
    searchKey: rule.searchKey ?? null,
    replaceText: rule.replaceText ?? null,
    supportValue: rule.supportValue ?? null,
    locationId: rule.locationId ?? null,
    targetSnapshotId,
    intent,
  };
}

function buildRecurringExecutionLineage(run) {
  return {
    runId: run.id,
    recurringEditId: run.recurringEditId,
    targetSnapshotId: run.targetSnapshotId || null,
    mirrorBatchId: run.mirrorBatchId || null,
    plannerFingerprint: run.plannerFingerprint || null,
    executionId: run.executionId || null,
    frozenAt: run.frozenAt || null,
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

async function requeueOrphanPendingRecurringRuns(limit = 100) {
  const pendingRuns = await prisma.recurringRuleRun.findMany({
    where: {
      status: "PENDING",
      startedAt: null,
      completedAt: null,
      recurringEdit: {
        isDeleted: false,
        status: "ACTIVE",
      },
    },
    select: {
      id: true,
      shop: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
  });

  for (const run of pendingRuns) {
    await enqueueRecurringEditExecutionJob({
      runId: run.id,
      shop: run.shop,
    }).catch(() => {});
  }

  return pendingRuns.length;
}

async function reconcileRecurringFreezeDispatchOutbox(limit = 100) {
  const rows = await prisma.operationExecution.findMany({
    where: {
      status: "PLANNED",
      workerJobId: { not: null },
      executionKey: { startsWith: "recurring-run:" },
      merchantOperation: { type: "RECURRING_EDIT" },
    },
    orderBy: [{ createdAt: "asc" }],
    take: limit,
  });

  let requeued = 0;
  for (const row of rows) {
    const match = /^recurring-run:(.+):freeze$/.exec(String(row.executionKey || ""));
    if (!match?.[1]) continue;
    const run = await recurringEditRunRepository.findById(match[1]);
    if (!run?.editHistoryId || !run?.operationId) continue;

    await bulkTargetFreezeQueue.add(
      "bulk.target.freeze",
      {
        shop: run.shop,
        operationId: run.operationId,
        recurringRunId: run.id,
        recurringEditId: run.recurringEditId,
        editHistoryId: run.editHistoryId,
        executionId: run.executionId || run.id,
      },
      {
        jobId: row.workerJobId,
        priority: 4,
      },
    ).catch(() => {});
    requeued += 1;
  }
  return requeued;
}

export async function scheduleDueRecurringEditRuns({ limit = 100 } = {}) {
  // ✅ Redis lock instead of pg_advisory_lock
  const schedulerLock = await acquireSchedulerLock();
  if (!schedulerLock.acquired) {
    return { scheduled: 0, skipped: 0, reason: "scheduler_locked" };
  }
  const stopSchedulerHeartbeat = startLockHeartbeat(
    schedulerLock,
    SCHEDULER_LOCK_TTL_MS,
  );

  try {
    const requeued = await requeueOrphanPendingRecurringRuns(limit);
    const outboxRequeued = await reconcileRecurringFreezeDispatchOutbox(limit);
    const now = new Date();
    const dueIds = await recurringEditRepository.findDueRecurringEditIds(now, limit);
    let scheduled = 0;
    let skipped = 0;

    for (const { id } of dueIds) {
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
          const watermark = getSchedulerWatermark(recurringEdit.scheduleConfig);
          if (
            watermark.lastScheduledOccurrence &&
            new Date(watermark.lastScheduledOccurrence).getTime() >=
              new Date(scheduledFor).getTime()
          ) {
            return null;
          }
          const occurrenceIndex = Math.max(0, watermark.occurrenceIndex || 0) + 1;
          const executionKey = buildScheduleExecutionKey(
            id,
            scheduledFor,
            getScheduleFingerprint(recurringEdit),
          ) + `:occ:${occurrenceIndex}`;
          const existingRun = await recurringEditRunRepository.findByExecutionKey(
            executionKey,
            tx,
          );

          if (existingRun) {
            if (isTerminalRunStatus(existingRun.status)) {
              return null;
            }
            return {
              runId: existingRun.id,
              shop: recurringEdit.shop,
              recurringEditId: recurringEdit.id,
              scheduledFor,
              occurrenceIndex,
              shouldEnqueue: existingRun.status === "PENDING",
            };
          }

          const snapshotFingerprint = buildRunSnapshotFingerprint(
            recurringEdit,
            scheduledFor,
          );
          const run = await recurringEditRunRepository.create(
            {
              recurringEditId: recurringEdit.id,
              shop: recurringEdit.shop,
              scheduledFor,
              status: "PENDING",
              executionKey,
              plannerFingerprint: snapshotFingerprint,
              frozenAt: new Date(),
            },
            tx,
          );
          return {
            runId: run.id,
            shop: recurringEdit.shop,
            recurringEditId: recurringEdit.id,
            scheduledFor,
            occurrenceIndex,
            shouldEnqueue: true,
          };
        });

        if (!reservation?.runId) {
          skipped += 1;
          continue;
        }

        if (reservation.shouldEnqueue) {
          await enqueueRecurringEditExecutionJob({
            runId: reservation.runId,
            shop: reservation.shop,
          });
          await prisma.$transaction(async (tx) => {
            const currentEdit = await recurringEditRepository.findById(
              reservation.recurringEditId,
              tx,
            );
            if (
              !currentEdit ||
              !currentEdit.nextRunAt ||
              new Date(currentEdit.nextRunAt).getTime() !==
                new Date(reservation.scheduledFor).getTime()
            ) {
              return;
            }
            const nextRunAt = computeRecurringEditNextRunAt(
              currentEdit,
              new Date(reservation.scheduledFor.getTime() + 1000),
            );
            await recurringEditRepository.updateById(
              currentEdit.id,
              {
                nextRunAt,
                status: nextRunAt ? "ACTIVE" : "COMPLETED",
                scheduleConfig: withSchedulerWatermark(
                  currentEdit.scheduleConfig,
                  reservation.scheduledFor,
                  reservation.occurrenceIndex || 1,
                ),
              },
              tx,
            );
          });
          scheduled += 1;
        } else {
          skipped += 1;
        }
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

    return {
      scheduled,
      skipped,
      requeued,
      outboxRequeued,
      scanned: dueIds.length,
    };
  } finally {
    stopSchedulerHeartbeat();
    await releaseSchedulerLock(schedulerLock); // ✅ ownership-validated release
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
  const stopShopLockHeartbeat = startLockHeartbeat(shopLock, SHOP_LOCK_TTL_MS);

  let exclusiveShopLockKey = null;

  try {
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
      entityType: "recurringRuleRun",
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

    if (run.status === "PENDING") {
      const claimed = await recurringEditRunRepository.updatePendingToProcessing(run.id);
      assertExecutionClaimed(claimed, "RECURRING_RUN_CLAIM_FAILED");
    } else if (run.status !== "PROCESSING") {
      const error = new Error("RECURRING_RUN_NOT_CLAIMABLE");
      error.code = "RECURRING_RUN_NOT_CLAIMABLE";
      throw error;
    }

    const session = await getSession(currentRecurringEdit.shop);
    if (!session?.shop || session.shop !== currentRecurringEdit.shop) {
      throw new Error("Shop session not available for recurring edit execution");
    }

    const service = new ProductBulkService(session);
    const targetSnapshotId = `target_${crypto.randomBytes(12).toString("hex")}`;
    const executionId = crypto.randomUUID();

    await resolveCanonicalProductTarget({
      shop: currentRecurringEdit.shop,
      filterParams: Array.isArray(currentRecurringEdit.filterParams)
        ? currentRecurringEdit.filterParams
        : [],
      queryParams: { page: 1, limit: 1 },
      sampleLimit: 1,
      freeze: true,
      ownerType: "AD_HOC_PRODUCT_TARGET",
      ownerId: targetSnapshotId,
    });
    const snapshotSummary = await getFrozenTargetSnapshotSummary({
      ownerType: "AD_HOC_PRODUCT_TARGET",
      ownerId: targetSnapshotId,
      shop: currentRecurringEdit.shop,
    });

    await recurringEditRunRepository.updateById(run.id, {
      executionId,
      targetSnapshotId,
      mirrorBatchId: snapshotSummary?.mirrorBatchId || null,
      plannerFingerprint:
        run.plannerFingerprint ||
        snapshotSummary?.plannerFingerprint ||
        null,
      frozenAt: new Date(),
    });

    run = await recurringEditRunRepository.findByIdWithRecurringEdit(run.id);
    if (!run?.targetSnapshotId) {
      throw new Error("RECURRING_RULE_RUN_LINEAGE_NOT_PERSISTED");
    }

    const body = buildRecurringEditHistoryBody(
      currentRecurringEdit,
      run.targetSnapshotId,
    );
    const baseHistory = await service._bulkOperationEdit(body, {
      planName: "Pro Monthly",
      isUnlimited: true,
      limit: Number.MAX_SAFE_INTEGER,
    });

    const freezeJobId = `bulk:freeze:${currentRecurringEdit.shop}:${run.id}`;
    const persisted = await prisma.$transaction(async (tx) => {
      const localizedTitle = await createMultiLanguage(currentRecurringEdit.title);
      const operation = await merchantOperationRepository.createPlannedOperationForEdit({
        shop: currentRecurringEdit.shop,
        type: "RECURRING_EDIT",
        title: "Recurring edit",
        source: "write_through",
        idempotencyKey: `recurring-edit-history:${run.id}`,
        totalItems: Number(baseHistory.totalItems || 0),
        startedAt: null,
      }, tx);
      const editHistory = await bulkEditHistoryRepository.create({
        operationId: operation.id,
        ...baseHistory,
        title: localizedTitle,
        type: "Recurring edit",
        isRecurring: true,
        recurringEditId: currentRecurringEdit.id,
        recurringRunId: run.id,
        triggerType: "RECURRING",
        summary: {
          ...(baseHistory.summary && typeof baseHistory.summary === "object"
            ? baseHistory.summary
            : {}),
          recurringExecution: buildRecurringExecutionLineage(run),
        },
        batch: {
          ...(baseHistory.batch && typeof baseHistory.batch === "object"
            ? baseHistory.batch
            : {}),
          recurringExecution: buildRecurringExecutionLineage(run),
          sourceTargetSnapshotId: run.targetSnapshotId,
        },
      }, tx);

      await bulkEditHistoryRepository.applyProjectionUpdate({
        where: {
          id: editHistory.id,
          shop: currentRecurringEdit.shop,
        },
        data: {
          targetSnapshotCount: Number(snapshotSummary?.count || 0),
          executionState: "planned",
        },
      }, tx);

      const queuedHistory = await tx.editHistory.findFirst({
        where: {
          id: editHistory.id,
          shop: currentRecurringEdit.shop,
        },
        select: { executionIdentity: true },
      });

      await recurringEditRunRepository.updateById(run.id, {
        editHistoryId: editHistory.id,
        operationId: operation.id,
      }, tx);

      await tx.operationExecution.upsert({
        where: {
          shop_executionKey: {
            shop: currentRecurringEdit.shop,
            executionKey: `recurring-run:${run.id}:freeze`,
          },
        },
        update: {
          merchantOperationId: operation.id,
          status: "PLANNED",
          workerJobId: freezeJobId,
        },
        create: {
          shop: currentRecurringEdit.shop,
          merchantOperationId: operation.id,
          executionKey: `recurring-run:${run.id}:freeze`,
          status: "PLANNED",
          workerJobId: freezeJobId,
        },
      });

      return {
        operationId: operation.id,
        editHistoryId: editHistory.id,
        executionId:
          queuedHistory?.executionIdentity || editHistory.executionIdentity || editHistory.id,
      };
    });

    await bulkTargetFreezeQueue.add(
      "bulk.target.freeze",
      {
        shop: currentRecurringEdit.shop,
        operationId: persisted.operationId,
        recurringRunId: run.id,
        recurringEditId: currentRecurringEdit.id,
        editHistoryId: persisted.editHistoryId,
        executionId: persisted.executionId,
      },
      {
        jobId: freezeJobId,
        priority: 4,
      },
    );
    await prisma.operationExecution.updateMany({
      where: {
        shop: currentRecurringEdit.shop,
        executionKey: `recurring-run:${run.id}:freeze`,
      },
      data: {
        status: "DISPATCHING",
      },
    });

    logger.info("Recurring edit execution queued", {
      shop: currentRecurringEdit.shop,
      runId: run.id,
      recurringEditId: currentRecurringEdit.id,
      editHistoryId: persisted.editHistoryId,
      operationId: persisted.operationId,
      freezeJobId,
    });

    return {
      success: true,
      runId: run.id,
      editHistoryId: persisted.editHistoryId,
      operationId: persisted.operationId,
      freezeJobId,
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
    stopShopLockHeartbeat();
    if (exclusiveShopLockKey) {
      const stillOwner = await assertLeaseOwner(exclusiveShopLockKey)
        .then(() => true)
        .catch(() => false);
      if (stillOwner) {
        await releaseExclusiveShopWork(exclusiveShopLockKey);
      }
    }
    await releaseShopLock(shopLock); // ✅ ownership-validated release
  }
}

export async function finalizeRecurringRunFromHistory({
  historyId,
  status,
  errorMessage = null,
}) {
  const history = await prisma.editHistory.findFirst({
    where: {
      id: historyId,
    },
    select: {
      shop: true,
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
  if (!run || run.shop !== history.shop || isTerminalRunStatus(run.status)) {
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
