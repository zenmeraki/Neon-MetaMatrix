import { Worker } from "bullmq";
import { connection } from "../../config/redis.js";
import { handleSyncOperation } from "../../helpers/webhookHelpers/bulkOperations/productTypeSync.js";
import { logWebhookError } from "../../utils/errorLogUtils.js";
import logger from "../../utils/loggerUtils.js";
import {
  getJobAttempt,
  isRetryExhausted,
  recordRetryExhausted,
} from "../../utils/workerTelemetry.js";
import { requireJobData } from "../../utils/jobPayloadValidation.js";

const QUEUE_NAME =
  process.env.BULK_OPERATION_QUERY_QUEUE || "bulk-operation-query";

export const bulkOperationQueryWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { shop, admin_graphql_api_id: bulkOperationId } = requireJobData(
      job,
      ["shop", "admin_graphql_api_id"],
      "bulk operation query",
    );

    logger.info("Bulk operation query finalization started", {
      worker: "bulkOperationQueryWorker",
      queue: QUEUE_NAME,
      jobId: job?.id,
      shop,
      bulkOperationId,
      attempt: getJobAttempt(job),
    });

    try {
      const result = await handleSyncOperation({
        bulkOperationId,
        shop,
        webhookJobId: job?.id || null,
        attempt: getJobAttempt(job),
      });

      logger.info("Bulk operation query finalization completed", {
        worker: "bulkOperationQueryWorker",
        queue: QUEUE_NAME,
        jobId: job?.id,
        shop,
        bulkOperationId,
        syncRunId: result?.syncRunId || null,
        operationId: result?.operationId || null,
      });

      return {
        success: true,
        shop,
        bulkOperationId,
        result,
      };
    } catch (error) {
      await logWebhookError({
        shop,
        req: job.data,
        source: "bulkOperationQueryWorker",
        err: error,
      });
      throw error;
    }
  },
  {
    connection,
    concurrency: 1,
  },
);

bulkOperationQueryWorker.on("completed", (job, result) => {
  logger.info("Bulk operation query worker completed", {
    worker: "bulkOperationQueryWorker",
    queue: QUEUE_NAME,
    jobId: job?.id,
    shop: job?.data?.shop,
    bulkOperationId: job?.data?.admin_graphql_api_id,
    attempt: getJobAttempt(job),
    result,
  });
});

bulkOperationQueryWorker.on("failed", async (job, error) => {
  logger.error("Bulk operation query worker failed", {
    worker: "bulkOperationQueryWorker",
    queue: QUEUE_NAME,
    jobId: job?.id,
    shop: job?.data?.shop,
    bulkOperationId: job?.data?.admin_graphql_api_id,
    attempt: getJobAttempt(job),
    message: error.message,
    stack: error.stack,
  });

  if (isRetryExhausted(job)) {
    await recordRetryExhausted({
      job,
      shop: job?.data?.shop,
      worker: "bulkOperationQueryWorker",
      queue: QUEUE_NAME,
      entityType: "bulkOperation",
      entityId: job?.data?.admin_graphql_api_id,
      executionId: job?.data?.admin_graphql_api_id,
      message: "Bulk operation query worker exhausted retries",
    });
  }
});
