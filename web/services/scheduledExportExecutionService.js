import { Prisma } from "../generated/prisma/index.js";
import { Queue } from "bullmq";
import { connection } from "../Config/redis.js";
import { prisma } from "../Config/database.js";
import { scheduledExportRepository } from "../repositories/scheduledExportRepository.js";
import { scheduledExportRunRepository } from "../repositories/scheduledExportRunRepository.js";
import { computeScheduledExportNextRunAt } from "./scheduledExportScheduleService.js";
import {
  getScheduledExportPlanContext,
  hasScheduledExportAccess,
} from "./scheduledExportPlanService.js";
import { addbulkExportJob } from "../Jobs/Queues/bulkExportJob.js";
import { Services } from "./productService/productFilterService.js";
import logger from "../utils/loggerUtils.js";
import { logWorkerError } from "../utils/errorLogUtils.js";

export const SCHEDULED_EXPORT_EXECUTION_QUEUE =
  process.env.SCHEDULED_EXPORT_EXECUTION_QUEUE || "scheduled-export-execution";

const scheduledExportExecutionQueue = new Queue(
  SCHEDULED_EXPORT_EXECUTION_QUEUE,
  { connection },
);

const productFilterService = new Services();

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

function buildExecutionKey(scheduledExportId, scheduledFor) {
  return `${scheduledExportId}:${new Date(scheduledFor).toISOString()}`;
}

function isTerminalRunStatus(status) {
  return ["SUCCESS", "FAILED", "SKIPPED"].includes(status);
}

async function markRunFailed(runId, scheduledExportId, shop, errorMessage) {
  const completedAt = new Date();

  await prisma.$transaction(async (tx) => {
    const run = await scheduledExportRunRepository.findById(runId, tx);
    if (!run || isTerminalRunStatus(run.status)) {
      return;
    }

    await scheduledExportRunRepository.updateById(
      runId,
      {
        status: "FAILED",
        errorMessage,
        completedAt,
      },
      tx,
    );

    await scheduledExportRepository.updateById(
      scheduledExportId,
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

  logger.error("Scheduled export run failed", {
    shop,
    runId,
    scheduledExportId,
    errorMessage,
  });
}

async function markRunSkipped(runId, scheduledExportId, shop, reason) {
  const completedAt = new Date();

  await prisma.$transaction(async (tx) => {
    const run = await scheduledExportRunRepository.findById(runId, tx);
    if (!run || isTerminalRunStatus(run.status)) {
      return;
    }

    await scheduledExportRunRepository.updateById(
      runId,
      {
        status: "SKIPPED",
        errorMessage: reason,
        completedAt,
      },
      tx,
    );

    await scheduledExportRepository.updateById(
      scheduledExportId,
      {
        runCount: {
          increment: 1,
        },
        lastRunAt: completedAt,
      },
      tx,
    );
  });

  logger.warn("Scheduled export run skipped", {
    shop,
    runId,
    scheduledExportId,
    reason,
  });
}

export async function enqueueScheduledExportExecutionJob({ runId }) {
  return scheduledExportExecutionQueue.add(
    "scheduled-export-execution",
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

export async function scheduleDueScheduledExportRuns({ limit = 100 } = {}) {
  const now = new Date();
  const dueIds = await scheduledExportRepository.findDueScheduledExportIds(now, limit);
  let scheduled = 0;
  let skipped = 0;

  for (const { id } of dueIds) {
    let reservation = null;

    try {
      reservation = await prisma.$transaction(async (tx) => {
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
        const run = await scheduledExportRunRepository.create(
          {
            scheduledExportId: scheduledExport.id,
            shop: scheduledExport.shop,
            scheduledFor,
            status: "PENDING",
            executionKey: buildExecutionKey(id, scheduledFor),
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

        return {
          runId: run.id,
          scheduledExportId: scheduledExport.id,
          shop: scheduledExport.shop,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        skipped += 1;
        continue;
      }

      await scheduledExportRepository
        .updateById(id, {
          status: "FAILED",
          lastFailureAt: new Date(),
          lastFailureReason:
            error.message || "Failed to reserve scheduled export run",
        })
        .catch(() => {});

      await logWorkerError({
        shop: "unknown",
        err: error,
        source: "ScheduledExportExecutionService.scheduleDueScheduledExportRuns",
      });

      skipped += 1;
      continue;
    }

    if (!reservation?.runId) {
      skipped += 1;
      continue;
    }

    try {
      await enqueueScheduledExportExecutionJob({ runId: reservation.runId });
      scheduled += 1;
    } catch (error) {
      await markRunFailed(
        reservation.runId,
        reservation.scheduledExportId,
        reservation.shop,
        error.message || "Failed to enqueue scheduled export execution job",
      );
    }
  }

  return {
    scheduled,
    skipped,
    scanned: dueIds.length,
  };
}

export async function executeScheduledExportRun(runId) {
  const existingRun = await scheduledExportRunRepository.findByIdWithScheduledExport(runId);
  if (!existingRun) {
    return { skipped: true, reason: "run_not_found" };
  }

  if (isTerminalRunStatus(existingRun.status)) {
    return { skipped: true, reason: "run_already_completed" };
  }

  const scheduledExport = existingRun.scheduledExport;
  if (!scheduledExport) {
    await markRunFailed(runId, existingRun.scheduledExportId, existingRun.shop, "Scheduled export not found");
    return { skipped: false, reason: "scheduled_export_not_found" };
  }

  if (
    scheduledExport.isDeleted ||
    ["PAUSED", "CANCELLED", "FAILED"].includes(scheduledExport.status)
  ) {
    await markRunSkipped(
      existingRun.id,
      scheduledExport.id,
      scheduledExport.shop,
      "Scheduled export is not active",
    );
    return { skipped: true, reason: "scheduled_export_inactive" };
  }

  const planContext = await getScheduledExportPlanContext(scheduledExport.shop);
  if (!hasScheduledExportAccess(planContext)) {
    await markRunSkipped(
      existingRun.id,
      scheduledExport.id,
      scheduledExport.shop,
      "Shop is not eligible for scheduled exports",
    );
    return { skipped: true, reason: "plan_ineligible" };
  }

  const run = await prisma.$transaction(async (tx) => {
    const locked = await tryAdvisoryLock(tx, `scheduled-export-run:${runId}`, true);
    if (!locked) {
      return null;
    }

    const currentRun = await scheduledExportRunRepository.findByIdWithScheduledExport(runId, tx);
    if (!currentRun || isTerminalRunStatus(currentRun.status)) {
      return null;
    }

    if (currentRun.status === "PENDING") {
      const claimed = await scheduledExportRunRepository.updateProcessingState(runId, tx);
      if (claimed.count !== 1) {
        return null;
      }

      return scheduledExportRunRepository.findByIdWithScheduledExport(runId, tx);
    }

    if (currentRun.status === "PROCESSING") {
      return currentRun;
    }

    return null;
  });

  if (!run?.scheduledExport) {
    return { skipped: true, reason: "run_not_claimed" };
  }

  if (run.exportJobId) {
    return {
      success: true,
      runId: run.id,
      exportJobId: run.exportJobId,
      reused: true,
    };
  }

  let exportJob = null;

  try {
    exportJob = await prisma.$transaction(async (tx) => {
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

      const where = productFilterService.getProductPrismaWhere(
        currentRun.scheduledExport.filterParams,
        currentRun.shop,
      );

      const createdExportJob = await tx.exportJob.create({
        data: {
          shop: currentRun.shop,
          filename: currentRun.scheduledExport.filename,
          fields: currentRun.scheduledExport.fields,
          filterQuery: JSON.stringify(where),
          status: "PENDING",
          type: "Scheduled export",
          isScheduled: true,
          scheduledExportId: currentRun.scheduledExport.id,
          scheduledExportRunId: currentRun.id,
          triggerType: "SCHEDULED",
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
        reason: "export_job_already_created",
      };
    }

    await addbulkExportJob({
      exportJobId: exportJob.id,
      shop: exportJob.shop,
      fields: exportJob.fields,
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
    if (exportJob?.id) {
      await prisma.exportJob
        .update({
          where: { id: exportJob.id },
          data: {
            status: "FAILED",
            error: error.message || "Failed to queue scheduled export job",
          },
        })
        .catch(() => {});
    }

    await markRunFailed(
      run.id,
      scheduledExport.id,
      scheduledExport.shop,
      error.message || "Scheduled export execution failed",
    );

    await logWorkerError({
      shop: scheduledExport.shop,
      err: error,
      source: "ScheduledExportExecutionService.executeScheduledExportRun",
    });

    throw error;
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
    status === "SUCCESS" || exportJob.status === "COMPLETED"
      ? "SUCCESS"
      : status === "SKIPPED"
        ? "SKIPPED"
        : "FAILED";

  await prisma.$transaction(async (tx) => {
    await scheduledExportRunRepository.updateById(
      exportJob.scheduledExportRunId,
      {
        status: normalizedStatus,
        completedAt,
        errorMessage:
          normalizedStatus === "FAILED"
            ? errorMessage || exportJob.error || "Scheduled export run failed"
            : null,
        fileUrl: normalizedStatus === "SUCCESS" ? exportJob.fileUrl : null,
        totalItems: exportJob.totalItems ?? null,
        durationMs: exportJob.durationMs ?? null,
      },
      tx,
    );

    await scheduledExportRepository.updateById(
      exportJob.scheduledExportId,
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
                lastFailureReason:
                  errorMessage || exportJob.error || "Scheduled export run failed",
              }
            : {}),
      },
      tx,
    );
  });

  return normalizedStatus;
}
