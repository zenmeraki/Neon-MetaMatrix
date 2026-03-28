import { Worker } from "bullmq";
import { connection } from "../Config/redis.js";
import {
  executeScheduledExportRun,
  SCHEDULED_EXPORT_EXECUTION_QUEUE,
} from "../services/scheduledExportExecutionService.js";
import logger from "../utils/loggerUtils.js";

const scheduledExportExecutionWorker = new Worker(
  SCHEDULED_EXPORT_EXECUTION_QUEUE,
  async (job) => executeScheduledExportRun(job.data.runId),
  {
    connection,
    concurrency: 2,
  },
);

scheduledExportExecutionWorker.on("failed", async (job, error) => {
  logger.error("Scheduled export execution worker failed", {
    jobId: job?.id,
    runId: job?.data?.runId,
    message: error.message,
  });
});

export default scheduledExportExecutionWorker;
