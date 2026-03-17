import logger from "../../utils/loggerUtils.js";
import dayjs from "dayjs";
import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import { handleSyncOperation } from "../../helpers/webhookHelpers/bulkOperations/productTypeSync.js";
import { logWebhookError } from "../../utils/errorLogUtils.js";

export const bulkOperationQueryWorker = new Worker(
  process.env.BULK_OPERATION_QUERY_QUEUE || "bulk-operation-query",
  async (job) => {
    try {
      const bulkOperationId = job.data?.admin_graphql_api_id;
      if (!bulkOperationId) {
        throw new Error(
          "Missing bulk operation ID in mutation webhook payload",
        );
      }

      // 👉 This is where your Prisma-backed sync logic runs
      await handleSyncOperation(bulkOperationId);

      return { message: "webhook mutation processing completed" };
    } catch (err) {
      // 👉 This is where your Prisma-backed error logging runs
      await logWebhookError({
        shop: job.data?.shop || "unknown",
        req: job.data, // job data provides context
        source: "bulkOperationQueryWorker",
        err,
      });
      throw err; // let Bull mark the job as failed and trigger retries
    }
  },
  { connection, concurrency: 1 },
);

const logTime = () => `[${dayjs().format("YYYY-MM-DD HH:mm:ss")}]`;

bulkOperationQueryWorker
  .on("error", (err) => {
    logger.error("Queue Error in bulk operation process", {
      time: logTime(),
      error: err.message,
      stack: err.stack,
    });
  })
  .on("waiting", (jobId) => {
    logger.debug("Job waiting to be processed", {
      time: logTime(),
      jobId,
    });
  })
  .on("active", (job) => {
    logger.info("Job started", {
      time: logTime(),
      jobId: job.id,
    });
  })
  .on("completed", (job, result) => {
    logger.info("Job completed successfully", {
      time: logTime(),
      jobId: job.id,
      result,
    });
  })
  .on("failed", (job, err) => {
    logger.error("Job failed in bulk operation process", {
      time: logTime(),
      jobId: job?.id,
      error: err.message,
      stack: err.stack,
    });
  });