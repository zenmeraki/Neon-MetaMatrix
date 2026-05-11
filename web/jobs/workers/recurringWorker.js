import { Worker } from "bullmq";
import { connection } from "../../config/redis.js";
import logger from "../../utils/loggerUtils.js";
import {
  scheduleDueRecurringEditRuns,
} from "../../services/recurringEditExecutionService.js";
import {
  getJobAttempt,
  isRetryExhausted,
  recordRetryExhausted,
} from "../../utils/workerTelemetry.js";

const QUEUE_NAME = process.env.RECURRING_QUEUE || "recurring-edit-scheduler";
const RECURRING_WORKER_CONCURRENCY = Number(
  process.env.RECURRING_WORKER_CONCURRENCY || 1,
);

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const result = await scheduleDueRecurringEditRuns({
      limit: Number(job?.data?.limit || 100),
    });

    logger.info("Legacy recurring worker delegated to deterministic scheduler", {
      worker: "recurringWorker",
      queue: QUEUE_NAME,
      jobId: job?.id,
      attempt: getJobAttempt(job),
      scheduled: result?.scheduled ?? 0,
      skipped: result?.skipped ?? 0,
      scanned: result?.scanned ?? 0,
      reason: result?.reason ?? null,
    });

    return result;
  },
  {
    connection,
    concurrency: RECURRING_WORKER_CONCURRENCY,
    removeOnComplete: 10,
    removeOnFail: 5,
  },
);

worker.on("completed", (job, result) => {
  logger.info("Recurring scheduler worker completed", {
    worker: "recurringWorker",
    queue: QUEUE_NAME,
    jobId: job?.id,
    attempt: getJobAttempt(job),
    result,
  });
});

worker.on("failed", async (job, error) => {
  logger.error("Recurring scheduler worker failed", {
    worker: "recurringWorker",
    queue: QUEUE_NAME,
    jobId: job?.id,
    attempt: getJobAttempt(job),
    message: error.message,
    stack: error.stack,
  });

  if (isRetryExhausted(job)) {
    await recordRetryExhausted({
      job,
      shop: job?.data?.shop || "system",
      worker: "recurringWorker",
      queue: QUEUE_NAME,
      entityType: "recurringScheduler",
      entityId: job?.id || "recurringWorker",
      executionId: job?.id || "recurringWorker",
      message: "Recurring scheduler worker exhausted retries",
    });
  }
});

worker.on("error", (error) => {
  logger.error("Recurring scheduler worker error", {
    worker: "recurringWorker",
    queue: QUEUE_NAME,
    message: error.message,
    stack: error.stack,
  });
});

export default worker;
