import { Worker } from "bullmq";
import { connection } from "../../config/redis.js";
import { handleProductEditOperation } from "../../helpers/webhookHelpers/bulkOperations/bulkEdit.js";
import { logWebhookError } from "../../utils/errorLogUtils.js";
import logger from "../../utils/loggerUtils.js";
import { getJobAttempt, isRetryExhausted, recordRetryExhausted } from "../../utils/workerTelemetry.js";
import { prisma } from "../../config/database.js";
import { addDeadLetterJob } from "../queues/deadLetterQueue.js";

const QUEUE_NAME =
  process.env.BULK_OPERATION_MUTATION_QUEUE || "bulk-operation-mutation";

const bulkOperationMutationWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const shop = job.data?.shop;
    const bulkOperationId = job.data?.admin_graphql_api_id;

    if (!shop || !bulkOperationId) {
      throw new Error("bulk-operation-mutation job requires shop and admin_graphql_api_id");
    }

    try {
      await handleProductEditOperation({
        bulkOperationId,
        shop,
      });
      return {
        success: true,
        shop,
        bulkOperationId,
      };
    } catch (error) {
      await logWebhookError({
        shop,
        req: job.data,
        source: "bulkOperationMutationWorker",
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

function resolveWebhookDeliveryId(job) {
  const webhookId = job?.data?.webhookId;
  if (webhookId) return webhookId;

  const shop = job?.data?.shop || "unknown";
  const entityId =
    job?.data?.admin_graphql_api_id ||
    job?.data?.id ||
    job?.data?.bulkOperationId ||
    "unknown";
  return `BULK_OPERATIONS_FINISH:${shop}:${entityId}`;
}

bulkOperationMutationWorker.on("failed", (job, error) => {
  logger.error("Bulk operation mutation worker failed", {
    worker: "bulkOperationMutationWorker",
    queue: QUEUE_NAME,
    jobId: job?.id,
    shop: job?.data?.shop,
    bulkOperationId: job?.data?.admin_graphql_api_id,
    attempt: getJobAttempt(job),
    message: error.message,
  });
});

bulkOperationMutationWorker.on("completed", (job, result) => {
  logger.info("Bulk operation mutation worker completed", {
    worker: "bulkOperationMutationWorker",
    queue: QUEUE_NAME,
    jobId: job?.id,
    shop: job?.data?.shop,
    bulkOperationId: job?.data?.admin_graphql_api_id,
    attempt: getJobAttempt(job),
    result,
  });

  const deliveryId = resolveWebhookDeliveryId(job);
  prisma.webhookDelivery
    .updateMany({
      where: { id: deliveryId, status: { in: ["RECEIVED", "QUEUED"] } },
      data: {
        status: "PROCESSED",
        processedAt: new Date(),
      },
    })
    .catch(() => {});
});

bulkOperationMutationWorker.on("failed", async (job) => {
  const deliveryId = resolveWebhookDeliveryId(job);
  if (isRetryExhausted(job)) {
    await addDeadLetterJob("bulk_operation_mutation_failed", {
      job,
      error: job?.failedReason ? new Error(job.failedReason) : new Error("unknown"),
      reason: "bulk_operation_mutation_retries_exhausted",
    }).catch(() => {});

    await recordRetryExhausted({
      job,
      shop: job?.data?.shop,
      worker: "bulkOperationMutationWorker",
      queue: QUEUE_NAME,
      entityType: "bulkOperation",
      entityId: job?.data?.admin_graphql_api_id,
      executionId: job?.data?.admin_graphql_api_id,
      message: "Bulk operation mutation worker exhausted retries",
    });

    await prisma.webhookDelivery
      .updateMany({
        where: { id: deliveryId },
        data: {
          status: "FAILED",
          lastError: "bulk_operation_mutation_retries_exhausted",
        },
      })
      .catch(() => {});
  }
});

export default bulkOperationMutationWorker;
