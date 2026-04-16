import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import logger from "../../utils/loggerUtils.js";
import { scheduleDueRecurringEditRuns } from "../../services/recurringEditExecutionService.js";

const QUEUE_NAME = process.env.RECURRING_QUEUE || "recurring-edit-grouped";

const worker = new Worker(
  QUEUE_NAME,
  async () => scheduleDueRecurringEditRuns(),
  {
    connection,
    concurrency: 1,
  },
);

worker.on("completed", (job, result) => {
  logger.info("Recurring grouped scheduler job completed", {
    queue: QUEUE_NAME,
    jobId: job?.id,
    result,
  });
});

worker.on("failed", (job, error) => {
  logger.error("Recurring grouped scheduler job failed", {
    queue: QUEUE_NAME,
    jobId: job?.id,
    message: error?.message,
  });
});

worker.on("error", (error) => {
  logger.error("Recurring grouped scheduler worker error", {
    queue: QUEUE_NAME,
    message: error?.message,
  });
});

export default worker;
