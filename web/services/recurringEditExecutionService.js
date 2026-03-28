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

export const RECURRING_EDIT_EXECUTION_QUEUE =
  process.env.RECURRING_EDIT_EXECUTION_QUEUE || "recurring-edit-execution";

const recurringEditExecutionQueue = new Queue(
  RECURRING_EDIT_EXECUTION_QUEUE,
  { connection },
);

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

async function unlockAdvisoryLock(client, lockKey) {
  await client.$queryRaw`
    SELECT pg_advisory_unlock(hashtext(${lockKey}))
  `;
}

function buildExecutionKey(recurringEditId, scheduledFor) {
  return `${recurringEditId}:${new Date(scheduledFor).toISOString()}`;
}

function isTerminalRunStatus(status) {
  return ["SUCCESS", "FAILED", "SKIPPED"].includes(status);
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

async function markRunFailed(runId, recurringEditId, shop, errorMessage) {
  const completedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await recurringEditRunRepository.updateById(
      runId,
      {
        status: "FAILED",
        errorMessage,
        completedAt,
      },
      tx,
    );

    await recurringEditRepository.updateById(
      recurringEditId,
      {
        runCount: {
          increment: 1,
        },
        lastRunAt: completedAt,
        lastFailureAt: completedAt,
        lastFailureReason: errorMessage,
      },
      tx,
    );
  });

  logger.error("Recurring edit run failed", {
    shop,
    runId,
    recurringEditId,
    errorMessage,
  });
}

async function markRunSkipped(runId, recurringEditId, shop, reason) {
  const completedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await recurringEditRunRepository.updateById(
      runId,
      {
        status: "SKIPPED",
        errorMessage: reason,
        completedAt,
      },
      tx,
    );

    await recurringEditRepository.updateById(
      recurringEditId,
      {
        runCount: {
          increment: 1,
        },
        lastRunAt: completedAt,
      },
      tx,
    );
  });

  logger.warn("Recurring edit run skipped", {
    shop,
    runId,
    recurringEditId,
    reason,
  });
}

export async function enqueueRecurringEditExecutionJob({ runId }) {
  return recurringEditExecutionQueue.add(
    "recurring-edit-execution",
    { runId },
    {
      jobId: runId,
      removeOnComplete: 100,
      removeOnFail: 100,
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 30_000,
      },
    },
  );
}

export async function scheduleDueRecurringEditRuns({ limit = 100 } = {}) {
  const schedulerLockKey = "recurring-edit-scheduler";
  const hasSchedulerLock = await tryAdvisoryLock(
    prisma,
    schedulerLockKey,
    false,
  );

  if (!hasSchedulerLock) {
    return {
      scheduled: 0,
      skipped: 0,
      reason: "scheduler_locked",
    };
  }

  try {
    const now = new Date();
    const dueIds = await recurringEditRepository.findDueRecurringEditIds(
      now,
      limit,
    );

    let scheduled = 0;
    let skipped = 0;

    for (const { id } of dueIds) {
      let reservation = null;

      try {
        reservation = await prisma.$transaction(
          async (tx) => {
            const locked = await tryAdvisoryLock(
              tx,
              `recurring-edit:${id}`,
              true,
            );

            if (!locked) {
              return null;
            }

            const recurringEdit = await recurringEditRepository.findById(id, tx);
            if (
              !recurringEdit ||
              recurringEdit.isDeleted ||
              recurringEdit.status !== "ACTIVE" ||
              !recurringEdit.nextRunAt ||
              recurringEdit.nextRunAt > now
            ) {
              return null;
            }

            const scheduledFor = recurringEdit.nextRunAt;
            const nextRunAt = computeRecurringEditNextRunAt(
              recurringEdit,
              new Date(scheduledFor.getTime() + 1000),
            );

            const run = await recurringEditRunRepository.create(
              {
                recurringEditId: recurringEdit.id,
                shop: recurringEdit.shop,
                scheduledFor,
                status: "PENDING",
                executionKey: buildExecutionKey(id, scheduledFor),
              },
              tx,
            );

            await recurringEditRepository.updateById(
              recurringEdit.id,
              {
                nextRunAt,
                status: nextRunAt ? "ACTIVE" : "COMPLETED",
              },
              tx,
            );

            return {
              runId: run.id,
              recurringEditId: recurringEdit.id,
              shop: recurringEdit.shop,
            };
          },
          {
            maxWait: 10_000,
            timeout: 20_000,
          },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          skipped += 1;
          continue;
        }

        await recurringEditRepository.updateById(id, {
          status: "FAILED",
          lastFailureAt: new Date(),
          lastFailureReason: error.message || "Failed to reserve recurring edit run",
        }).catch(() => {});

        await logWorkerError({
          shop: "unknown",
          err: error,
          source: "RecurringEditExecutionService.scheduleDueRecurringEditRuns",
        });

        skipped += 1;
        continue;
      }

      if (!reservation?.runId) {
        skipped += 1;
        continue;
      }

      try {
        await enqueueRecurringEditExecutionJob({ runId: reservation.runId });
        scheduled += 1;
      } catch (error) {
        await markRunFailed(
          reservation.runId,
          reservation.recurringEditId,
          reservation.shop,
          error.message || "Failed to enqueue recurring edit execution job",
        );
      }
    }

    return {
      scheduled,
      skipped,
      scanned: dueIds.length,
    };
  } finally {
    await unlockAdvisoryLock(prisma, schedulerLockKey);
  }
}

export async function executeRecurringEditRun(runId) {
  const run = await recurringEditRunRepository.findByIdWithRecurringEdit(runId);
  if (!run) {
    return { skipped: true, reason: "run_not_found" };
  }

  if (isTerminalRunStatus(run.status)) {
    return { skipped: true, reason: "run_already_completed" };
  }

  const recurringEdit = run.recurringEdit;
  if (!recurringEdit) {
    await markRunFailed(run.id, run.recurringEditId, run.shop, "Recurring edit not found");
    return { skipped: false, reason: "recurring_edit_not_found" };
  }

  if (recurringEdit.isDeleted || ["PAUSED", "CANCELLED", "FAILED"].includes(recurringEdit.status)) {
    await markRunSkipped(
      run.id,
      recurringEdit.id,
      recurringEdit.shop,
      "Recurring edit is not active",
    );
    return { skipped: true, reason: "recurring_edit_inactive" };
  }

  await recurringEditRunRepository.updateById(run.id, {
    status: "PROCESSING",
    startedAt: run.startedAt || new Date(),
  });

  try {
    const session = await getSession(recurringEdit.shop);
    const service = new ProductBulkService(session);
    const body = buildRecurringEditHistoryBody(recurringEdit);
    const baseHistory = await service._bulkOperationEdit(body, {
      planName: "Pro Monthly",
      isUnlimited: true,
      limit: Number.MAX_SAFE_INTEGER,
    });

    const localizedTitle = await createMultiLanguage(recurringEdit.title);
    const editHistory = await prisma.editHistory.create({
      data: {
        ...baseHistory,
        title: localizedTitle,
        type: "Recurring edit",
        isRecurring: true,
        recurringEditId: recurringEdit.id,
        recurringRunId: run.id,
        triggerType: "RECURRING",
      },
    });

    await recurringEditRunRepository.updateById(run.id, {
      editHistoryId: editHistory.id,
    });

    await addbulkEditJob({
      historyId: editHistory.id,
      session,
    });

    logger.info("Recurring edit execution queued", {
      shop: recurringEdit.shop,
      runId: run.id,
      recurringEditId: recurringEdit.id,
      editHistoryId: editHistory.id,
    });

    return {
      success: true,
      runId: run.id,
      editHistoryId: editHistory.id,
    };
  } catch (error) {
    await markRunFailed(
      run.id,
      recurringEdit.id,
      recurringEdit.shop,
      error.message || "Recurring edit execution failed",
    );

    await logWorkerError({
      shop: recurringEdit.shop,
      err: error,
      source: "RecurringEditExecutionService.executeRecurringEditRun",
    });

    throw error;
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
    status === "SUCCESS" || history.status === "completed"
      ? "SUCCESS"
      : status === "SKIPPED"
        ? "SKIPPED"
        : "FAILED";

  await prisma.$transaction(async (tx) => {
    await recurringEditRunRepository.updateById(
      history.recurringRunId,
      {
        status: normalizedStatus,
        completedAt,
        errorMessage:
          normalizedStatus === "FAILED"
            ? errorMessage || "Recurring run failed"
            : null,
      },
      tx,
    );

    await recurringEditRepository.updateById(
      history.recurringEditId,
      {
        runCount: {
          increment: 1,
        },
        lastRunAt: completedAt,
        ...(normalizedStatus === "SUCCESS"
          ? {
              lastSuccessAt: completedAt,
              lastFailureReason: null,
            }
          : normalizedStatus === "FAILED"
            ? {
                lastFailureAt: completedAt,
                lastFailureReason: errorMessage || "Recurring run failed",
              }
            : {}),
      },
      tx,
    );
  });

  return normalizedStatus;
}
