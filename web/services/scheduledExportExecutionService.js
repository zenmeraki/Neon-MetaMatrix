import { Prisma } from "../generated/prisma/index.js";
import { Queue } from "bullmq";
import { connection } from "../Config/redis.js";
import { prisma } from "../config/database.js";
import { scheduledExportRepository } from "../repositories/scheduledExportRepository.js";
import { scheduledExportRunRepository } from "../repositories/scheduledExportRunRepository.js";
import { computeScheduledExportNextRunAt } from "./scheduledExportScheduleService.js";
import {
  getScheduledExportPlanContext,
  hasScheduledExportAccess,
} from "./scheduledExportPlanService.js";
import { addbulkExportJob } from "../Jobs/Queues/bulkExportJob.js";
import logger from "../utils/loggerUtils.js";
import { logWorkerError } from "../utils/errorLogUtils.js";
import {
  freezeTargetSnapshot,
  resolveCanonicalProductTarget,
} from "./productService/productTargetingService.js";
import {
  acquireExclusiveShopWork,
  releaseExclusiveShopWork,
} from "./shopWorkLeaseService.js";
import { EXPORT_EXECUTION_STATES } from "./exportExecutionStateService.js";

export const SCHEDULED_EXPORT_EXECUTION_QUEUE =
  process.env.SCHEDULED_EXPORT_EXECUTION_QUEUE || "scheduled-export-execution";

const scheduledExportExecutionQueue = new Queue(SCHEDULED_EXPORT_EXECUTION_QUEUE, {
  connection,
});

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

function buildExecutionKey(scheduledExportId, scheduledFor) {
  return `${scheduledExportId}:${new Date(scheduledFor).toISOString()}`;
}

function isTerminalRunStatus(status) {
  return ["SUCCESS", "FAILED", "SKIPPED"].includes(status);
}

async function markRunFailed(run, scheduledExport, errorMessage) {
  const transition = await scheduledExportRunRepository.markProcessingFinished(
    run.id,
    "FAILED",
    {
      errorMessage,
    },
  );

  if (!transition.count) {
    return null;
  }

  await scheduledExportRepository.updateById(scheduledExport.id, {
    runCount: { increment: 1 },
    lastRunAt: new Date(),
    lastFailureAt: new Date(),
    lastFailureReason: errorMessage,
  });

  return errorMessage;
}

async function markRunSkipped(run, scheduledExport, reason) {
  const transition = await scheduledExportRunRepository.markPendingSkipped(run.id, {
    errorMessage: reason,
  });

  if (!transition.count) {
    return null;
  }

  await scheduledExportRepository.updateById(scheduledExport.id, {
    runCount: { increment: 1 },
    lastRunAt: new Date(),
  });

  return reason;
}

export async function enqueueScheduledExportExecutionJob({
  runId,
  shop,
  delay = 0,
  jobId = runId,
}) {
  return scheduledExportExecutionQueue.add(
    "scheduled-export-execution",
    { runId, shop },
    {
      jobId,
      delay,
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

async function deferScheduledExportRun(runId, shop, reason, delay = 60_000) {
  await enqueueScheduledExportExecutionJob({
    runId,
    shop,
    delay,
    jobId: `${runId}:retry:${Date.now()}`,
  });

  return {
    success: true,
    deferred: true,
    reason,
    runId,
  };
}

export async function scheduleDueScheduledExportRuns({ limit = 100 } = {}) {
  const schedulerLockKey = "scheduled-export-scheduler";
  const hasSchedulerLock = await tryAdvisoryLock(prisma, schedulerLockKey, false);

  if (!hasSchedulerLock) {
    return {
      scheduled: 0,
      skipped: 0,
      reason: "scheduler_locked",
    };
  }

  try {
    const now = new Date();
    const dueIds = await scheduledExportRepository.findDueScheduledExportIds(now, limit);
    let scheduled = 0;
    let skipped = 0;

    for (const { id } of dueIds) {
      try {
        const reservation = await prisma.$transaction(async (tx) => {
          const locked = await tryAdvisoryLock(tx, `scheduled-export:${id}`, true);
          if (!locked) {
            return null;
          }

          const scheduledExport = await scheduledExportRepository.findById(id, tx);
          if (
            !scheduledExport ||
            scheduledExport.isDeleted ||
            scheduledExport.status !== "ACTIVE" ||
            !scheduledExport.nextRunAt ||
            scheduledExport.nextRunAt > now
          ) {
            return null;
          }

          const scheduledFor = scheduledExport.nextRunAt;
          const executionKey = buildExecutionKey(id, scheduledFor);
          const existingRun = await scheduledExportRunRepository.findByExecutionKey(
            executionKey,
            tx,
          );

          if (existingRun) {
            return { runId: existingRun.id, shop: scheduledExport.shop };
          }

          const run = await scheduledExportRunRepository.create(
            {
              scheduledExportId: scheduledExport.id,
              shop: scheduledExport.shop,
              scheduledFor,
              status: "PENDING",
              executionKey,
            },
            tx,
          );

          const nextRunAt = computeScheduledExportNextRunAt(
            scheduledExport,
            new Date(scheduledFor.getTime() + 1000),
          );

          await scheduledExportRepository.updateById(
            scheduledExport.id,
            {
              nextRunAt,
              status: nextRunAt ? "ACTIVE" : "COMPLETED",
            },
            tx,
          );

          return { runId: run.id, shop: scheduledExport.shop };
        });

        if (!reservation?.runId) {
          skipped += 1;
          continue;
        }

        await enqueueScheduledExportExecutionJob({
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
          source: "ScheduledExportExecutionService.scheduleDueScheduledExportRuns",
        });
        skipped += 1;
      }
    }

    return {
      scheduled,
      skipped,
      scanned: dueIds.length,
    };
  } finally {
    await unlockAdvisoryLock(prisma, schedulerLockKey).catch(() => {});
  }
}

export async function executeScheduledExportRun(runId, shopFromJob = null) {
  let run = await scheduledExportRunRepository.findByIdWithScheduledExport(runId);
  if (!run) {
    return { skipped: true, reason: "run_not_found" };
  }

  if (isTerminalRunStatus(run.status)) {
    return { skipped: true, reason: "run_already_completed" };
  }

  const scheduledExport = run.scheduledExport;
  if (shopFromJob && scheduledExport?.shop && scheduledExport.shop !== shopFromJob) {
    throw new Error("Cross-shop scheduled export execution blocked");
  }
  if (
    !scheduledExport ||
    scheduledExport.isDeleted ||
    ["PAUSED", "CANCELLED", "FAILED"].includes(scheduledExport.status)
  ) {
    await markRunSkipped(run, scheduledExport || { id: run.scheduledExportId }, "Scheduled export is not active");
    return { skipped: true, reason: "scheduled_export_inactive" };
  }

  const planContext = await getScheduledExportPlanContext(scheduledExport.shop);
  if (!hasScheduledExportAccess(planContext)) {
    await markRunSkipped(run, scheduledExport, "Shop is not eligible for scheduled exports");
    return { skipped: true, reason: "plan_ineligible" };
  }

  const executionLockKey = `scheduled-export-shop:${scheduledExport.shop}`;
  const hasShopLock = await tryAdvisoryLock(prisma, executionLockKey, false);
  if (!hasShopLock) {
    return deferScheduledExportRun(
      run.id,
      scheduledExport.shop,
      "shop_execution_locked",
    );
  }

  let exclusiveShopLockKey = null;

  try {
    run = await scheduledExportRunRepository.findByIdWithScheduledExport(runId);
    if (!run || isTerminalRunStatus(run.status)) {
      return { skipped: true, reason: "run_not_actionable" };
    }

    const exclusiveLock = await acquireExclusiveShopWork({
      shop: scheduledExport.shop,
      activity: "scheduled_export_execution",
      worker: "scheduledExportExecutionService",
      queue: SCHEDULED_EXPORT_EXECUTION_QUEUE,
      jobId: run.id,
      entityType: "scheduledExportRun",
      entityId: run.id,
      executionId: run.id,
    });

    if (!exclusiveLock.acquired) {
      return deferScheduledExportRun(
        run.id,
        scheduledExport.shop,
        "shop_work_conflict",
      );
    }

    exclusiveShopLockKey = exclusiveLock.lockKey;

    if (run.exportJobId) {
      return {
        success: true,
        runId: run.id,
        exportJobId: run.exportJobId,
        reused: true,
      };
    }

    const claimed = await scheduledExportRunRepository.updateProcessingState(run.id);
    if (!claimed.count && run.status !== "PROCESSING") {
      return { skipped: true, reason: "run_not_claimed" };
    }

    const exportJob = await prisma.$transaction(async (tx) => {
      const locked = await tryAdvisoryLock(tx, `scheduled-export-run:${run.id}`, true);
      if (!locked) {
        return null;
      }

      const currentRun = await scheduledExportRunRepository.findByIdWithScheduledExport(run.id, tx);
      if (!currentRun || isTerminalRunStatus(currentRun.status)) {
        return null;
      }

      if (currentRun.exportJobId) {
        return tx.exportJob.findUnique({
          where: { id: currentRun.exportJobId },
        });
      }

      const target = await resolveCanonicalProductTarget({
        shop: currentRun.shop,
        filterParams: currentRun.scheduledExport.filterParams,
        queryParams: { page: 1, limit: 20 },
        sampleLimit: 20,
      });

      const createdExportJob = await tx.exportJob.create({
        data: {
          shop: currentRun.shop,
          filename: currentRun.scheduledExport.filename,
          fields: currentRun.scheduledExport.fields,
          filterQuery: JSON.stringify(target.where),
          status: "PENDING",
          executionState: EXPORT_EXECUTION_STATES.PLANNED,
          type: "Scheduled export",
          isScheduled: true,
          scheduledExportId: currentRun.scheduledExport.id,
          scheduledExportRunId: currentRun.id,
          triggerType: "SCHEDULED",
          targetMirrorBatchId: target.mirrorBatchId,
        },
      });

      await scheduledExportRunRepository.updateById(
        currentRun.id,
        {
          exportJobId: createdExportJob.id,
        },
        tx,
      );

      return createdExportJob;
    });

    if (!exportJob?.id) {
      return {
        skipped: true,
        reason: "export_job_not_created",
      };
    }

    const frozenCount = await freezeTargetSnapshot({
      ownerType: "EXPORT_JOB",
      ownerId: exportJob.id,
      shop: exportJob.shop,
      where: JSON.parse(exportJob.filterQuery || "{}"),
      mirrorBatchId: exportJob.targetMirrorBatchId,
    });

    await prisma.exportJob.update({
      where: { id: exportJob.id },
      data: {
        targetSnapshotCount: frozenCount,
        executionState: EXPORT_EXECUTION_STATES.QUEUED,
      },
    });

    await addbulkExportJob({
      exportJobId: exportJob.id,
      shop: exportJob.shop,
      fields: exportJob.fields,
      source: "scheduled_export",
      executionId: exportJob.id,
    });

    logger.info("Scheduled export execution queued", {
      shop: exportJob.shop,
      runId: run.id,
      scheduledExportId: scheduledExport.id,
      exportJobId: exportJob.id,
    });

    return {
      success: true,
      runId: run.id,
      exportJobId: exportJob.id,
    };
  } catch (error) {
    await markRunFailed(run, scheduledExport, error.message || "Scheduled export execution failed").catch(() => {});
    await logWorkerError({
      shop: scheduledExport.shop,
      err: error,
      source: "ScheduledExportExecutionService.executeScheduledExportRun",
    });
    throw error;
  } finally {
    await releaseExclusiveShopWork(exclusiveShopLockKey);
    await unlockAdvisoryLock(prisma, executionLockKey).catch(() => {});
  }
}

export async function finalizeScheduledExportRunFromExportJob({
  exportJobId,
  status,
  errorMessage = null,
}) {
  const exportJob = await prisma.exportJob.findUnique({
    where: { id: exportJobId },
    select: {
      scheduledExportId: true,
      scheduledExportRunId: true,
      fileUrl: true,
      totalItems: true,
      durationMs: true,
      completedAt: true,
      status: true,
      error: true,
    },
  });

  if (!exportJob?.scheduledExportId || !exportJob?.scheduledExportRunId) {
    return null;
  }

  const run = await scheduledExportRunRepository.findById(exportJob.scheduledExportRunId);
  if (!run || isTerminalRunStatus(run.status)) {
    return run;
  }

  const completedAt = exportJob.completedAt || new Date();
  const normalizedStatus =
    status === "SUCCESS" || exportJob.status === "COMPLETED" ? "SUCCESS" : "FAILED";

  const transition = await scheduledExportRunRepository.markProcessingFinished(
    exportJob.scheduledExportRunId,
    normalizedStatus,
    {
      completedAt,
      errorMessage:
        normalizedStatus === "FAILED"
          ? errorMessage || exportJob.error || "Scheduled export run failed"
          : null,
      fileUrl: normalizedStatus === "SUCCESS" ? exportJob.fileUrl : null,
      totalItems: exportJob.totalItems ?? null,
      durationMs: exportJob.durationMs ?? null,
    },
  );

  if (!transition.count) {
    return run.status;
  }

  await scheduledExportRepository.updateById(exportJob.scheduledExportId, {
    runCount: { increment: 1 },
    lastRunAt: completedAt,
    ...(normalizedStatus === "SUCCESS"
      ? {
          lastSuccessAt: completedAt,
          lastFailureReason: null,
        }
      : {
          lastFailureAt: completedAt,
          lastFailureReason:
            errorMessage || exportJob.error || "Scheduled export run failed",
        }),
  });

  return normalizedStatus;
}