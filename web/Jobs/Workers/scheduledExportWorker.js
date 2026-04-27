import os from "os";
import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import { scheduledExportRepository } from "../../repositories/scheduledExportRepository.js";
import { ScheduledExportService } from "../../services/productService/scheduledExportService.js";

const QUEUE_NAME =
  process.env.SCHEDULED_EXPORT_QUEUE || "scheduled-export-dispatch";

const WORKER_ID = `${os.hostname()}:${process.pid}`;

let scheduledExportWorkerInstance = null;

async function processDueScheduledExports() {
  const dueExports = await scheduledExportRepository.findDueExports({
    take: Number(process.env.SCHEDULED_EXPORT_DISPATCH_BATCH_SIZE || 25),
  });
  const dueIds = dueExports.map((scheduledExport) => scheduledExport.id).filter(Boolean);

  if (!dueIds.length) {
    return { queued: 0 };
  }

  const { lockedAt } = await scheduledExportRepository.acquireLocks({
    ids: dueIds,
    lockedBy: WORKER_ID,
  });

  const lockedExports = await scheduledExportRepository.findLockedByIds({
    ids: dueIds,
    lockedBy: WORKER_ID,
    lockedAt,
  });

  let queued = 0;

  for (const scheduledExport of lockedExports) {
    try {
      await ScheduledExportService.dispatchDueExport({
        scheduledExport,
        lockedBy: WORKER_ID,
      });

      queued += 1;
    } catch (error) {
      await scheduledExportRepository.markFailed({
        id: scheduledExport.id,
        lockedBy: WORKER_ID,
        nextRunAt: ScheduledExportService.computeRetryRunAt(new Date()),
        error,
      });
    }
  }

  return { queued };
}

export function createScheduledExportWorker() {
  if (scheduledExportWorkerInstance) return scheduledExportWorkerInstance;

  const worker = new Worker(
    QUEUE_NAME,
    async () => processDueScheduledExports(),
    {
      connection,
      concurrency: 1,
    },
  );

  worker.on("failed", (job, error) => {
    console.error("Scheduled export dispatch failed", {
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      attemptsAllowed: job?.opts?.attempts,
      error: error?.message,
    });
  });

  worker.on("error", (error) => {
    console.error("Scheduled export worker internal error", {
      error: error?.message,
      stack: error?.stack,
    });
  });

  scheduledExportWorkerInstance = worker;
  return worker;
}

export async function closeScheduledExportWorker() {
  if (!scheduledExportWorkerInstance) return;

  await scheduledExportWorkerInstance.close();
  scheduledExportWorkerInstance = null;
}
