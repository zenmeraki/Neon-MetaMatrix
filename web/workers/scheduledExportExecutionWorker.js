import { Worker } from "bullmq";
import { connection } from "../Config/redis.js";
import {
  executeScheduledExportRun,
  SCHEDULED_EXPORT_EXECUTION_QUEUE,
} from "../services/scheduledExportExecutionService.js";
import logger from "../utils/loggerUtils.js";
import {
  getJobAttempt,
  isRetryExhausted,
  recordRetryExhausted,
} from "../utils/workerTelemetry.js";

const scheduledExportExecutionWorker = new Worker(
  SCHEDULED_EXPORT_EXECUTION_QUEUE,
  async (job) => {
    const { runId, shop } = job.data || {};
    if (!runId || !shop) {
      throw new Error("scheduled export execution job requires runId and shop");
    }

    return executeScheduledExportRun(runId, shop);
  },
  {
    connection,
    concurrency: 2,
  },
);

scheduledExportExecutionWorker.on("failed", async (job, error) => {
  logger.error("Scheduled export execution worker failed", {
    worker: "scheduledExportExecutionWorker",
    queue: SCHEDULED_EXPORT_EXECUTION_QUEUE,
    jobId: job?.id,
    shop: job?.data?.shop,
    runId: job?.data?.runId,
    attempt: getJobAttempt(job),
    message: error.message,
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
