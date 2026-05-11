import { Queue } from "bullmq";
import { connection } from "../config/redis.js";
import { prisma } from "../config/database.js";
import { scheduledExportRepository } from "../repositories/scheduledExportRepository.js";
import { scheduledExportRunRepository } from "../repositories/scheduledExportRunRepository.js";
import { computeScheduledExportNextRunAt } from "./scheduledExportScheduleService.js";
import {
  getScheduledExportPlanContext,
  hasScheduledExportAccess,
} from "./scheduledExportPlanService.js";
import { addbulkExportJob } from "../jobs/queues/bulkExportJob.js";
import logger from "../utils/loggerUtils.js";
import { logWorkerError } from "../utils/errorLogUtils.js";
import {
  freezeTargetSnapshot,
  getActiveMirrorBatchId,
  resolveCanonicalProductTarget,
} from "./productService/productTargetingService.js";
import { merchantOperationRepository } from "../repositories/merchantOperationRepository.js";
import { projectOperationToExportJob } from "./operationProjectionService.js";
import { transitionOperation } from "./operationTransitionService.js";
import crypto from "crypto";
import { assertShopMatch } from "../utils/assertShopMatch.js";

export const SCHEDULED_EXPORT_EXECUTION_QUEUE =
  process.env.SCHEDULED_EXPORT_EXECUTION_QUEUE || "scheduled-export-execution";

const scheduledExportExecutionQueue = new Queue(SCHEDULED_EXPORT_EXECUTION_QUEUE, {
  connection,
});

function assertExecutionClaimed(result, code = "EXECUTION_CLAIM_FAILED") {
  if (Number(result?.count || 0) !== 1) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
}

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

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

function buildExecutionKey(shop, scheduledExportId, scheduledFor) {
  return `${shop}:${scheduledExportId}:${new Date(scheduledFor).toISOString()}`;
}

function buildRunClaimToken({
  runId,
  executionKey,
  schedulerOwner,
  lockVersion,
}) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        runId,
        executionKey,
        schedulerOwner,
        lockVersion: Number(lockVersion || 0),
      }),
    )
    .digest("hex");
}

function isTerminalRunStatus(status) {
  return ["SUCCESS", "FAILED", "SKIPPED"].includes(status);
}

function buildCorrelationContext({
  shop = null,
  runId = null,
  scheduledExportId = null,
  exportJobId = null,
  bulkOperationId = null,
  jobId = null,
  mirrorBatchId = null,
  executionKey = null,
} = {}) {
  return {
    shop,
    runId,
    scheduledExportId,
    exportJobId,
    bulkOperationId,
    jobId,
    mirrorBatchId,
    executionKey,
  };
}

async function markRunFailed(run, scheduledExport, errorMessage) {
  const transition = await scheduledExportRunRepository.markProcessingFinished({
    id: run.id,
    shop: run.shop,
    status: "FAILED",
    exportJobId: run.exportJobId || null,
    data: {
      errorMessage,
    },
  });

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
  const transition = await scheduledExportRunRepository.markPendingSkipped(
    run.id,
    run.shop,
    {
      errorMessage: reason,
    },
  );

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
  executionKey = null,
  claimToken = null,
  schedulerOwner = null,
  expectedLockVersion = null,
  delay = 0,
  jobId = runId,
}) {
  return scheduledExportExecutionQueue.add(
    "scheduled-export-execution",
    {
      runId,
      shop,
      executionKey,
      claimToken,
      schedulerOwner,
      expectedLockVersion,
    },
    {
      jobId,
      delay,
      removeOnComplete: true,
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
    jobId: runId,
  });

  return {
    success: true,
    deferred: true,
    reason,
    runId,
  };
}
const SCHEDULER_LOCK_TTL_MS = 55_000;
const SCHEDULER_LOCK_KEY = "lock:scheduled-export-scheduler";

async function acquireSchedulerLock() {
  const owner = `scheduled-export-scheduler:${process.pid}:${crypto.randomUUID()}`;
  const result = await connection.set(
    SCHEDULER_LOCK_KEY,
    owner,
    "NX",
    "PX",
    SCHEDULER_LOCK_TTL_MS,
  );
  return {
    acquired: result === "OK",
    owner,
  };
}

async function renewSchedulerLock(owner) {
  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("PEXPIRE", KEYS[1], ARGV[2])
    end
    return 0
  `;

  const result = await connection.eval(
    script,
    1,
    SCHEDULER_LOCK_KEY,
    owner,
    String(SCHEDULER_LOCK_TTL_MS),
  );

  return Number(result || 0) === 1;
}

async function releaseSchedulerLock(owner) {
  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    end
    return 0
  `;

  await connection.eval(script, 1, SCHEDULER_LOCK_KEY, owner);
}
const SHOP_LOCK_TTL_MS = 20 * 60_000;
const SHOP_LOCK_RENEW_INTERVAL_MS = 30_000;
async function acquireShopLock(shop) {
  const key = `lock:scheduled-export-shop:${shop}`;
  const result = await connection.set(key, process.pid, "NX", "PX", SHOP_LOCK_TTL_MS);
  return { acquired: result === "OK", key };
}

async function releaseShopLock(key) {
  if (key) await connection.del(key).catch(() => { });
}
export async function scheduleDueScheduledExportRuns({ limit = 100 } = {}) {
  const schedulerLock = await acquireSchedulerLock();
  if (!schedulerLock.acquired) {
    return { scheduled: 0, skipped: 0, reason: "scheduler_locked" };
  }
  let renewInterval;
  let lockLost = false;
  try {
    renewInterval = setInterval(async () => {
      const renewed = await renewSchedulerLock(schedulerLock.owner);
      if (!renewed) {
        lockLost = true;
        logger.warn("Scheduled export scheduler lease renewal lost ownership", {
          owner: schedulerLock.owner,
        });
      }
    }, 30_000);
    renewInterval.unref?.();

    const now = new Date();
    const lockOwner = schedulerLock.owner;
    const dueRows = await scheduledExportRepository.claimDueScheduledExports({
      now,
      limit,
      lockedBy: lockOwner,
    });

    let scheduled = 0;
    let skipped = 0;

    for (const row of dueRows) {
      if (lockLost) {
        logger.warn("Stopping scheduled export claim loop after scheduler lease loss", {
          owner: schedulerLock.owner,
        });
        break;
      }
      const id = row.id;
      const shop = row.shop;
      const expectedLockVersion = Number(row.lockVersion);
      if (!Number.isFinite(expectedLockVersion)) {
        skipped += 1;
        continue;
      }
      try {
        const reservation = await prisma.$transaction(async (tx) => {
          const advisoryLocked = await tryAdvisoryLock(
            tx,
            `scheduled-export-claim:${shop}:${id}`,
            true,
          );
          if (!advisoryLocked) {
            return null;
          }

          const scheduledExport = await scheduledExportRepository.findById(id, tx);
          if (
            !scheduledExport ||
            scheduledExport.shop !== shop ||
            scheduledExport.isDeleted ||
            scheduledExport.status !== "ACTIVE" ||
            !scheduledExport.nextRunAt ||
            scheduledExport.nextRunAt > now ||
            scheduledExport.lockedBy !== lockOwner
          ) {
            return null;
          }

          const scheduledFor = scheduledExport.nextRunAt;
          const nextRunAt = computeScheduledExportNextRunAt(
            scheduledExport,
            new Date(scheduledFor.getTime() + 1000),
          );
          const executionKey = buildExecutionKey(
            scheduledExport.shop,
            id,
            scheduledFor,
          );
          const existingRun = await scheduledExportRunRepository.findByExecutionKey(
            { executionKey, shop: scheduledExport.shop },
            tx,
          );

          const runRecord = existingRun
            ? existingRun
            : await scheduledExportRunRepository.create(
                {
                  scheduledExportId: scheduledExport.id,
                  shop: scheduledExport.shop,
                  scheduledFor,
                  status: "PENDING",
                  executionKey,
                },
                tx,
              );
          const runId = runRecord.id;

          const queued = await scheduledExportRepository.markRunQueued(
            {
              id: scheduledExport.id,
              shop: scheduledExport.shop,
              exportJobId: null,
              nextRunAt,
              lockedBy: lockOwner,
              expectedLockVersion,
              now,
            },
            tx,
          );

          if (queued.count !== 1) {
            return null;
          }

          if (!nextRunAt) {
            await scheduledExportRepository.updateById(
              scheduledExport.id,
              {
                status: "COMPLETED",
              },
              tx,
            );
          }

          return {
            runId,
            shop: scheduledExport.shop,
            executionKey,
            expectedLockVersion,
            schedulerOwner: lockOwner,
            claimToken: buildRunClaimToken({
              runId,
              executionKey,
              schedulerOwner: lockOwner,
              lockVersion: expectedLockVersion,
            }),
          };
        },
      {
        timeout: 15_000,
      }
      );

        if (!reservation?.runId) {
          await scheduledExportRepository.releaseLockIfOwned({
            id,
            shop,
            lockedBy: lockOwner,
            expectedLockVersion,
          }).catch(() => {});
          skipped += 1;
          continue;
        }

        await enqueueScheduledExportExecutionJob({
          runId: reservation.runId,
          shop: reservation.shop,
          executionKey: reservation.executionKey,
          claimToken: reservation.claimToken,
          schedulerOwner: reservation.schedulerOwner,
          expectedLockVersion: reservation.expectedLockVersion,
        });
        scheduled += 1;
      } catch (error) {
        if (error?.code === "P2002") {
          skipped += 1;
          continue;
        }

        await logWorkerError({
          shop: shop || "unknown",
          err: error,
          source: "ScheduledExportExecutionService.scheduleDueScheduledExportRuns",
        });
        await scheduledExportRepository.releaseLockIfOwned({
          id,
          shop,
          lockedBy: lockOwner,
          expectedLockVersion,
        }).catch(() => {});
        skipped += 1;
      }
    }

    return {
      scheduled,
      skipped,
      scanned: dueRows.length,
    };
  } finally {
    clearInterval(renewInterval);
    await releaseSchedulerLock(schedulerLock.owner);
  }
}

export async function executeScheduledExportRun(input, legacyShopFromJob = null) {
  const {
    runId,
    shop: shopFromJob = legacyShopFromJob,
    executionKey: executionKeyFromJob = null,
    claimToken: claimTokenFromJob = null,
    schedulerOwner: schedulerOwnerFromJob = null,
    expectedLockVersion: expectedLockVersionFromJob = null,
    jobId = null,
    attempt = null,
  } = typeof input === "object" && input !== null
    ? input
    : { runId: input, shop: legacyShopFromJob };

  let run = await scheduledExportRunRepository.findByIdWithScheduledExport(runId);
  if (!run) {
    return { skipped: true, reason: "run_not_found" };
  }

  assertShopMatch({
    jobShop: shopFromJob,
    dbShop: run.shop,
    context: "scheduled_export_run_job_shop",
    jobId,
    entityType: "scheduledExportRun",
    entityId: runId,
  });

  if (isTerminalRunStatus(run.status)) {
    return { skipped: true, reason: "run_already_completed" };
  }

  if (executionKeyFromJob && run.executionKey !== executionKeyFromJob) {
    return { skipped: true, reason: "stale_claim_execution_key_mismatch" };
  }
  if (claimTokenFromJob && schedulerOwnerFromJob) {
    const recomputedClaimToken = buildRunClaimToken({
      runId: run.id,
      executionKey: run.executionKey,
      schedulerOwner: schedulerOwnerFromJob,
      lockVersion: Number(expectedLockVersionFromJob || 0),
    });
    if (recomputedClaimToken !== claimTokenFromJob) {
      return { skipped: true, reason: "stale_claim_token_mismatch" };
    }
  }

  const scheduledExport = run.scheduledExport;
  if (scheduledExport?.shop) {
    assertShopMatch({
      jobShop: run.shop,
      dbShop: scheduledExport.shop,
      context: "scheduled_export_run_parent_shop",
      jobId,
      entityType: "scheduledExport",
      entityId: scheduledExport.id,
    });
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

  const shopLock = await acquireShopLock(scheduledExport.shop);
  if (!shopLock.acquired) {
    return deferScheduledExportRun(
      run.id,
      scheduledExport.shop,
      "shop_execution_locked",
    );
  }
  let shopRenewInterval = null;
shopRenewInterval = setInterval(async () => {
  try {
    await connection.pexpire(
      shopLock.key,
      SHOP_LOCK_TTL_MS
    );
  } catch (err) {
    logger.error("Failed to renew shop lock", {
      shop: scheduledExport.shop,
      runId: run.id,
      error: err.message,
    });
  }
}, SHOP_LOCK_RENEW_INTERVAL_MS);
  try {
    run = await scheduledExportRunRepository.findByIdWithScheduledExport(runId);
    if (!run || isTerminalRunStatus(run.status)) {
      return { skipped: true, reason: "run_not_actionable" };
    }

    if (run.exportJobId) {
      return {
        success: true,
        runId: run.id,
        exportJobId: run.exportJobId,
        operationId: run.operationId || null,
        status: run.status,
        reused: true,
      };
    }

    if (!["PENDING", "PROCESSING"].includes(run.status)) {
      return { skipped: true, reason: "run_not_actionable" };
    }

    if (!run.operationId) {
      throw codedError(
        "SCHEDULED_EXPORT_RUN_OPERATION_ID_REQUIRED",
        "Scheduled export run is missing operationId",
      );
    }

    const expectedExecutionKey = buildExecutionKey(
      run.shop,
      run.scheduledExportId,
      run.scheduledFor,
    );
    if (run.executionKey !== expectedExecutionKey) {
      throw codedError(
        "SCHEDULED_EXPORT_EXECUTION_KEY_MISMATCH",
        "Scheduled export run executionKey is not deterministic",
      );
    }

    const operation = await prisma.merchantOperation.findFirst({
      where: {
        id: run.operationId,
        shop: run.shop,
      },
      select: {
        id: true,
        status: true,
      },
    });
    if (!operation) {
      throw codedError(
        "SCHEDULED_EXPORT_OPERATION_NOT_FOUND",
        "Scheduled export run operation was not found",
      );
    }
    if (!["PLANNED", "SNAPSHOTTING"].includes(operation.status)) {
      throw codedError(
        "SCHEDULED_EXPORT_OPERATION_NOT_EXECUTABLE",
        `Scheduled export operation is not executable from ${operation.status}`,
      );
    }

    const claimed = await scheduledExportRunRepository.updateProcessingState(
      run.id,
      run.shop,
    );
    if (Number(claimed?.count || 0) !== 1) {
      return {
        skipped: true,
        reason: "run_claim_conflict",
        runId: run.id,
        operationId: operation.id,
        status: run.status,
      };
    }

    if (operation.status === "PLANNED") {
      await transitionOperation({
        shop: run.shop,
        operationId: operation.id,
        from: "PLANNED",
        to: "SNAPSHOTTING",
        data: {
          startedAt: new Date(),
        },
      });
    }

    const exportJob = await prisma.$transaction(async (tx) => {
      const currentRun = await scheduledExportRunRepository.findByIdWithScheduledExport(run.id, tx);
      if (
        !currentRun ||
        currentRun.shop !== run.shop ||
        currentRun.status !== "PROCESSING" ||
        currentRun.operationId !== operation.id
      ) {
        return null;
      }

      if (currentRun.exportJobId) {
        return tx.exportJob.findFirst({
          where: {
            id: currentRun.exportJobId,
            shop: currentRun.shop,
          },
        });
      }

     

      const target = await resolveCanonicalProductTarget({
        shop: currentRun.shop,
        filterParams: currentRun.scheduledExport.filterParams,
        queryParams: { page: 1, limit: 20 },
        sampleLimit: 20,
        mirrorBatchId: await getActiveMirrorBatchId(currentRun.shop, tx),
        freeze: false,
        db: tx,
      });

      const createdExportJob = await tx.exportJob.create({
        data: {
          operationId: operation.id,
          shop: currentRun.shop,
          filename: currentRun.scheduledExport.filename,
          fields: Array.isArray(currentRun.scheduledExport.requestedColumns)
            ? currentRun.scheduledExport.requestedColumns
            : Array.isArray(currentRun.scheduledExport.fields)
              ? currentRun.scheduledExport.fields
              : [],
          filterQuery: JSON.stringify(target.where),
          type: "Scheduled export",
          isScheduled: true,
          scheduledExportId: currentRun.scheduledExport.id,
          scheduledExportRunId: currentRun.id,
          triggerType: "SCHEDULED",
          targetMirrorBatchId: target.mirrorBatchId,
        },
      });

      const frozenCount = await freezeTargetSnapshot(
        {
          ownerType: "EXPORT_JOB",
          ownerId: createdExportJob.id,
          shop: createdExportJob.shop,
          where: target.where,
          mirrorBatchId: target.mirrorBatchId,
        },
        tx,
      );

      await tx.exportJob.update({
        where: {
          id: createdExportJob.id,
        },
        data: {
          targetSnapshotCount: frozenCount,
        },
      });

      await transitionOperation(
        {
          shop: currentRun.shop,
          operationId: operation.id,
          from: "SNAPSHOTTING",
          to: "SNAPSHOTTED",
          data: {
            totalItems: Number(frozenCount || 0),
            processedItems: 0,
            failedItems: 0,
          },
        },
        tx,
      );
      await projectOperationToExportJob(
        {
          shop: currentRun.shop,
          exportJobId: createdExportJob.id,
          operationId: operation.id,
        },
        tx,
      );

      await scheduledExportRunRepository.updateById(
        currentRun.id,
        currentRun.shop,
        {
          exportJobId: createdExportJob.id,
        },
        tx,
      );
      return createdExportJob;
    },
  {
    timeout: 15_000,
  }
  );

    if (!exportJob?.id) {
      return {
        skipped: true,
        reason: "export_job_not_created",
      };
    }

    await addbulkExportJob({
      exportJobId: exportJob.id,
      shop: exportJob.shop,
      fields: exportJob.fields,
      source: "scheduled_export",
      executionId: exportJob.id,
      correlation: buildCorrelationContext({
        shop: exportJob.shop,
        runId: run.id,
        scheduledExportId: scheduledExport.id,
        exportJobId: exportJob.id,
        mirrorBatchId: exportJob.targetMirrorBatchId || null,
        executionKey: run.executionKey || null,
      }),
    });

    logger.info("Scheduled export execution queued", {
      ...buildCorrelationContext({
        shop: exportJob.shop,
        runId: run.id,
        scheduledExportId: scheduledExport.id,
        exportJobId: exportJob.id,
        mirrorBatchId: exportJob.targetMirrorBatchId || null,
        executionKey: run.executionKey || null,
      }),
    });

    return {
      success: true,
      runId: run.id,
      exportJobId: exportJob.id,
      operationId: operation.id,
      status: "PROCESSING",
    };
  } catch (error) {
    logger.error("Scheduled export execution failed", {
      ...buildCorrelationContext({
        shop: scheduledExport?.shop || run?.shop || null,
        runId: run?.id || null,
        scheduledExportId: scheduledExport?.id || null,
        exportJobId: run?.exportJobId || null,
        executionKey: run?.executionKey || null,
      }),
      message: error.message,
      code: error.code || null,
      jobId,
      attempt,
    });
    await markRunFailed(run, scheduledExport, error.message || "Scheduled export execution failed").catch(() => { });
    await logWorkerError({
      shop: scheduledExport?.shop || run?.shop || shopFromJob || "unknown",
      err: error,
      source: "ScheduledExportExecutionService.executeScheduledExportRun",
    });
    throw error;
  } finally {
  if (shopRenewInterval) {
    clearInterval(shopRenewInterval);
  }

  await releaseShopLock(shopLock.key);
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
      shop: true,
      filename: true,
    },
  });

  if (!exportJob?.scheduledExportId || !exportJob?.scheduledExportRunId) {
    return null;
  }

  const run = await scheduledExportRunRepository.findById(exportJob.scheduledExportRunId);
  if (!run || run.shop !== exportJob.shop || isTerminalRunStatus(run.status)) {
    return run;
  }

  const completedAt = exportJob.completedAt || new Date();
  const normalizedStatus =
    status === "SUCCESS" || exportJob.status === "COMPLETED" ? "SUCCESS" : "FAILED";

  const transition = await prisma.$transaction(async (tx) => {
    const operationId = `op_scheduled_export_run_${exportJob.scheduledExportRunId}`;
    const transitionResult = await scheduledExportRunRepository.markProcessingFinished({
      id: exportJob.scheduledExportRunId,
      shop: exportJob.shop,
      status: normalizedStatus,
      exportJobId: exportJobId,
      data: {
        completedAt,
        errorMessage:
          normalizedStatus === "FAILED"
            ? errorMessage || exportJob.error || "Scheduled export run failed"
            : null,
        fileUrl: normalizedStatus === "SUCCESS" ? exportJob.fileUrl : null,
        totalItems: exportJob.totalItems ?? null,
        durationMs: exportJob.durationMs ?? null,
      },
    }, tx);

    const existingHistory = await tx.exportHistory.findFirst({
      where: {
        scheduledTask: exportJob.scheduledExportRunId,
        shop: exportJob.shop,
      },
      select: { id: true, operationId: true },
    });

    if (!existingHistory) {
      await merchantOperationRepository.createPlannedOperation(
        {
          id: operationId,
          shop: exportJob.shop,
          type: "SCHEDULED_EXPORT",
          title: exportJob.filename || "Scheduled export",
          source: "scheduled_export_worker",
          idempotencyKey: `scheduled-export-run:${exportJob.scheduledExportRunId}`,
          totalItems: Number(exportJob.totalItems ?? 0),
          startedAt: completedAt,
        },
        tx,
      );
      await transitionOperation(
        {
          shop: exportJob.shop,
          operationId,
          from: "PLANNED",
          to: normalizedStatus === "SUCCESS" ? "COMPLETED" : "FAILED",
          data: {
            completedAt,
            failedAt: normalizedStatus === "FAILED" ? completedAt : null,
            errorMessage:
              normalizedStatus === "FAILED"
                ? (errorMessage || exportJob.error || null)
                : null,
            totalItems: Number(exportJob.totalItems ?? 0),
            processedItems:
              normalizedStatus === "SUCCESS" ? Number(exportJob.totalItems ?? 0) : 0,
            failedItems:
              normalizedStatus === "FAILED" ? Number(exportJob.totalItems ?? 0) : 0,
          },
        },
        tx,
      );

      await tx.exportHistory.create({
        data: {
          operationId,
          shop: exportJob.shop,
          filename: exportJob.filename || "export.csv",
          filters: {},
          status: normalizedStatus === "SUCCESS" ? "completed" : "failed",
          duration: String(exportJob.durationMs ?? 0),
          totalItems: exportJob.totalItems ?? 0,
          exportTime: completedAt,
          type: "Scheduled export",
          scheduledTask: exportJob.scheduledExportRunId ?? null,
          exportedData: normalizedStatus === "SUCCESS" ? (exportJob.fileUrl ?? null) : null,
          errorMessage: normalizedStatus === "FAILED"
            ? (errorMessage || exportJob.error || null)
            : null,
        },
      });
    } else if (!existingHistory.operationId) {
      await tx.exportHistory.update({
        where: { id: existingHistory.id },
        data: { operationId },
      });
    }

    if (!transitionResult.count) {
      return transitionResult;
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
    }, tx);

    return transitionResult;
  });

  if (!transition.count) {
    return run.status;
  }

  const operationId = `op_scheduled_export_run_${exportJob.scheduledExportRunId}`;
  const currentOperation = await prisma.merchantOperation.findFirst({
    where: { id: operationId, shop: exportJob.shop },
    select: { status: true },
  });
  if (currentOperation?.status && !["COMPLETED", "FAILED", "CANCELLED"].includes(currentOperation.status)) {
    await transitionOperation({
      shop: exportJob.shop,
      operationId,
      from: currentOperation.status,
      to: normalizedStatus === "SUCCESS" ? "COMPLETED" : "FAILED",
      data: {
        completedAt: normalizedStatus === "SUCCESS" ? completedAt : null,
        failedAt: normalizedStatus === "FAILED" ? completedAt : null,
        errorMessage:
          normalizedStatus === "FAILED" ? (errorMessage || exportJob.error || null) : null,
      },
    });
  }

  return normalizedStatus;
}
