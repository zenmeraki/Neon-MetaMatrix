import { Worker } from "bullmq";
import { connection } from "../../config/redis.js";
import {
  executeScheduledExportRun,
  SCHEDULED_EXPORT_EXECUTION_QUEUE,
} from "../../services/scheduledExportExecutionService.js";
import logger from "../../utils/loggerUtils.js";
import {
  getJobAttempt,
  isRetryExhausted,
  recordRetryExhausted,
} from "../../utils/workerTelemetry.js";
import { requireJobData } from "../../utils/jobPayloadValidation.js";

const SCHEDULED_EXPORT_WORKER_CONCURRENCY = Number(
  process.env.SCHEDULED_EXPORT_WORKER_CONCURRENCY || 2,
);

const scheduledExportExecutionWorker = new Worker(
  SCHEDULED_EXPORT_EXECUTION_QUEUE,
  async (job) => {
    const { runId, shop } = requireJobData(
      job,
      ["runId", "shop"],
      "scheduled export execution",
    );

    logger.info("Scheduled export execution started", {
      worker: "scheduledExportExecutionWorker",
      queue: SCHEDULED_EXPORT_EXECUTION_QUEUE,
      jobId: job?.id,
      shop,
      runId,
      attempt: getJobAttempt(job),
    });

    const result = await executeScheduledExportRun({
      runId,
      shop,
      jobId: job?.id || null,
      attempt: getJobAttempt(job),
    });

    logger.info("Scheduled export execution finished", {
      worker: "scheduledExportExecutionWorker",
      queue: SCHEDULED_EXPORT_EXECUTION_QUEUE,
      jobId: job?.id,
      shop,
      runId,
      attempt: getJobAttempt(job),
      status: result?.status || null,
      exportJobId: result?.exportJobId || null,
      operationId: result?.operationId || null,
    });

    return result;
  },
  {
    connection,
    concurrency: SCHEDULED_EXPORT_WORKER_CONCURRENCY,
  },
);

scheduledExportExecutionWorker.on("completed", (job) => {
  logger.info("Scheduled export execution worker completed", {
    worker: "scheduledExportExecutionWorker",
    queue: SCHEDULED_EXPORT_EXECUTION_QUEUE,
    jobId: job?.id,
    shop: job?.data?.shop,
    runId: job?.data?.runId,
    attempt: getJobAttempt(job),
  });
});

scheduledExportExecutionWorker.on("failed", async (job, error) => {
  logger.error("Scheduled export execution worker failed", {
    worker: "scheduledExportExecutionWorker",
    queue: SCHEDULED_EXPORT_EXECUTION_QUEUE,
    jobId: job?.id,
    shop: job?.data?.shop,
    runId: job?.data?.runId,
    attempt: getJobAttempt(job),
    message: error.message,
    stack: error.stack,
  });

  if (isRetryExhausted(job)) {
    await recordRetryExhausted({
      job,
      shop: job?.data?.shop,
      worker: "scheduledExportExecutionWorker",
      queue: SCHEDULED_EXPORT_EXECUTION_QUEUE,
      entityType: "scheduledExportRun",
      entityId: job?.data?.runId,
      executionId: job?.data?.runId,
      message: "Scheduled export execution worker exhausted retries",
    });
  }
});

export default scheduledExportExecutionWorker;
