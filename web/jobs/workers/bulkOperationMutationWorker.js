import { Worker } from "bullmq";
import { connection } from "../../config/redis.js";
import { handleProductEditOperation } from "../../helpers/webhookHelpers/bulkOperations/bulkEdit.js";
import { logWebhookError } from "../../utils/errorLogUtils.js";
import logger from "../../utils/loggerUtils.js";
import {
  getJobAttempt,
  isRetryExhausted,
  recordRetryExhausted,
} from "../../utils/workerTelemetry.js";
import { prisma } from "../../config/database.js";
import { addDeadLetterJob } from "../queues/deadLetterQueue.js";
import { requireJobData } from "../../utils/jobPayloadValidation.js";

const QUEUE_NAME =
  process.env.BULK_OPERATION_MUTATION_QUEUE || "bulk-operation-mutation";

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

async function claimWebhookDelivery({ deliveryId }) {
  const claimed = await prisma.webhookDelivery.updateMany({
    where: {
      id: deliveryId,
      status: { in: ["RECEIVED", "QUEUED"] },
    },
    data: {
      status: "PROCESSING",
    },
  });

  return claimed.count === 1;
}

const bulkOperationMutationWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { shop, admin_graphql_api_id: bulkOperationId } = requireJobData(
      job,
      ["shop", "admin_graphql_api_id"],
      "bulk operation mutation",
    );

    const deliveryId = resolveWebhookDeliveryId(job);
    const claimed = await claimWebhookDelivery({ deliveryId });

    if (!claimed) {
      return {
        skipped: true,
        reason: "webhook_delivery_already_claimed_or_processed",
        shop,
        bulkOperationId,
        deliveryId,
      };
    }

    logger.info("Bulk operation mutation finalization started", {
      worker: "bulkOperationMutationWorker",
      queue: QUEUE_NAME,
      jobId: job?.id,
      shop,
      bulkOperationId,
      deliveryId,
      attempt: getJobAttempt(job),
    });

    try {
      const result = await handleProductEditOperation({
        bulkOperationId,
        shop,
        webhookDeliveryId: deliveryId,
        webhookJobId: job?.id || null,
        attempt: getJobAttempt(job),
      });

      await prisma.webhookDelivery.updateMany({
        where: {
          id: deliveryId,
          status: "PROCESSING",
        },
        data: {
          status: "PROCESSED",
          processedAt: new Date(),
        },
      });

      logger.info("Bulk operation mutation finalization completed", {
        worker: "bulkOperationMutationWorker",
        queue: QUEUE_NAME,
        jobId: job?.id,
        shop,
        bulkOperationId,
        deliveryId,
        operationId: result?.operationId || null,
        submissionId: result?.submissionId || null,
      });

      return {
        success: true,
        shop,
        bulkOperationId,
        deliveryId,
        result,
      };
    } catch (error) {
      await prisma.webhookDelivery
        .updateMany({
          where: {
            id: deliveryId,
            status: "PROCESSING",
          },
          data: {
            status: "QUEUED",
            lastError: error.message,
          },
        })
        .catch(() => {});

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
});

bulkOperationMutationWorker.on("failed", async (job, error) => {
  const deliveryId = resolveWebhookDeliveryId(job);

  logger.error("Bulk operation mutation worker failed", {
    worker: "bulkOperationMutationWorker",
    queue: QUEUE_NAME,
    jobId: job?.id,
    shop: job?.data?.shop,
    bulkOperationId: job?.data?.admin_graphql_api_id,
    deliveryId,
    attempt: getJobAttempt(job),
    message: error.message,
    stack: error.stack,
  });

  if (isRetryExhausted(job)) {
    await addDeadLetterJob("bulk_operation_mutation_failed", {
      job,
      error,
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
