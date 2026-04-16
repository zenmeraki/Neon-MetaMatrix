import { Worker } from "bullmq";
import { connection } from "../Config/redis.js";
import {
  RECURRING_EDIT_EXECUTION_QUEUE,
  executeRecurringEditRun,
} from "../services/recurringEditExecutionService.js";
import logger from "../utils/loggerUtils.js";
import {
  getJobAttempt,
  isRetryExhausted,
  recordRetryExhausted,
} from "../utils/workerTelemetry.js";

const recurringEditExecutionWorker = new Worker(
  RECURRING_EDIT_EXECUTION_QUEUE,
  async (job) => {
    const { runId, shop } = job.data || {};
    if (!runId || !shop) {
      throw new Error("recurring edit execution job requires runId and shop");
    }

    return executeRecurringEditRun(runId, shop);
  },
  {
    connection,
    concurrency: 3,
  },
);

recurringEditExecutionWorker.on("completed", (job, result) => {
  logger.info("Recurring edit execution worker completed job", {
    worker: "recurringEditExecutionWorker",
    queue: RECURRING_EDIT_EXECUTION_QUEUE,
    jobId: job.id,
    shop: job.data?.shop,
    runId: job.data?.runId,
    attempt: getJobAttempt(job),
    result,
  });
});

recurringEditExecutionWorker.on("failed", async (job, error) => {
  logger.error("Recurring edit execution worker failed job", {
    worker: "recurringEditExecutionWorker",
    queue: RECURRING_EDIT_EXECUTION_QUEUE,
    jobId: job?.id,
    shop: job?.data?.shop,
    runId: job?.data?.runId,
    attempt: getJobAttempt(job),
    error: error.message,
  });

  if (isRetryExhausted(job)) {
    await recordRetryExhausted({
      job,
      shop: job?.data?.shop,
      worker: "recurringEditExecutionWorker",
      queue: RECURRING_EDIT_EXECUTION_QUEUE,
      entityType: "recurringEditRun",
      entityId: job?.data?.runId,
      executionId: job?.data?.runId,
      message: "Recurring edit execution worker exhausted retries",
    });
  }
});

export default recurringEditExecutionWorker;
