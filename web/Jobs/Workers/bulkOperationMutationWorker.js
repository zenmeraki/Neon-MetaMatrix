// web/Jobs/Workers/bulkOperationMutationWorker.js
import dayjs from "dayjs";
import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import { handleProductEditOperation } from "../../helpers/webhookHelpers/bulkOperations/bulkEdit.js";
import { logWebhookError } from "../../utils/errorLogUtils.js";
import logger from "../../utils/loggerUtils.js";

const bulkOperationMutationWorker = new Worker(
  process.env.BULK_OPERATION_MUTATION_QUEUE || "bulk-operation-mutation",
  async (job) => {
    try {
      const bulkOperationId = job.data?.admin_graphql_api_id;

      if (!bulkOperationId) {
        throw new Error("Missing bulk operation ID in mutation webhook payload");
      }

      await handleProductEditOperation(bulkOperationId);

      return { message: "Webhook mutation processing completed" };
    } catch (err) {
      await logWebhookError({
        shop: job.data?.shop || "unknown",
        req: job.data,
        source: "bulkOperationMutationWorker",
        err,
      });

      throw err;
    }
  },
  { connection, concurrency: 1 }
);

const logTime = () => `[${dayjs().format("YYYY-MM-DD HH:mm:ss")}]`;

bulkOperationMutationWorker
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

export default bulkOperationMutationWorker;