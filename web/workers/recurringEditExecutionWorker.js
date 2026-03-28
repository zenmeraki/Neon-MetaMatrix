import { Worker } from "bullmq";
import { connection } from "../Config/redis.js";
import {
  RECURRING_EDIT_EXECUTION_QUEUE,
  executeRecurringEditRun,
} from "../services/recurringEditExecutionService.js";
import logger from "../utils/loggerUtils.js";

const recurringEditExecutionWorker = new Worker(
  RECURRING_EDIT_EXECUTION_QUEUE,
  async (job) => executeRecurringEditRun(job.data.runId),
  {
    connection,
    concurrency: 3,
  },
);

recurringEditExecutionWorker.on("completed", (job, result) => {
  logger.info("Recurring edit execution worker completed job", {
    jobId: job.id,
    result,
  });
});

recurringEditExecutionWorker.on("failed", (job, error) => {
  logger.error("Recurring edit execution worker failed job", {
    jobId: job?.id,
    error: error.message,
  });
});

export default recurringEditExecutionWorker;
