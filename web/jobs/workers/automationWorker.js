import { Worker } from "bullmq";
import { connection } from "../../config/redis.js";
import { triggerAutomations } from "../../services/automation/automationTriggerService.js";
import logger from "../../utils/loggerUtils.js";
import { requireJobData } from "../../utils/jobPayloadValidation.js";
import {
  getJobAttempt,
  isRetryExhausted,
  recordRetryExhausted,
} from "../../utils/workerTelemetry.js";

const QUEUE_NAME = "automation";

const AUTOMATION_WORKER_CONCURRENCY = Number(
  process.env.AUTOMATION_WORKER_CONCURRENCY || 2,
);

export const automationWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { shop, triggerType, mirrorBatchId } = requireJobData(
      job,
      ["shop", "triggerType", "mirrorBatchId"],
      "automation trigger",
    );

    const triggerReason = job.data?.triggerReason || null;
    const triggerReference = job.data?.triggerReference || job.id || null;

    logger.info("Automation worker started", {
      worker: "automationWorker",
      queue: QUEUE_NAME,
      jobId: job?.id,
      shop,
      triggerType,
      mirrorBatchId,
      triggerReason,
      triggerReference,
      attempt: getJobAttempt(job),
    });

    const result = await triggerAutomations({
      shop,
      triggerType,
      mirrorBatchId,
      triggerReason,
      triggerReference,
      workerJobId: job?.id || null,
      attempt: getJobAttempt(job),
    });

    logger.info("Automation worker completed", {
      worker: "automationWorker",
      queue: QUEUE_NAME,
      jobId: job?.id,
      shop,
      triggerType,
      mirrorBatchId,
      result,
    });

    return result;
  },
  {
    connection,
    concurrency: AUTOMATION_WORKER_CONCURRENCY,
  },
);

automationWorker.on("failed", async (job, error) => {
  logger.error("Automation worker failed", {
    worker: "automationWorker",
    queue: QUEUE_NAME,
    jobId: job?.id,
    shop: job?.data?.shop,
    triggerType: job?.data?.triggerType,
    mirrorBatchId: job?.data?.mirrorBatchId,
    attempt: getJobAttempt(job),
    message: error.message,
    stack: error.stack,
  });

  if (isRetryExhausted(job)) {
    await recordRetryExhausted({
      job,
      shop: job?.data?.shop,
      worker: "automationWorker",
      queue: QUEUE_NAME,
      entityType: "automationTrigger",
      entityId: job?.data?.triggerReference || job?.id,
      executionId: job?.data?.triggerReference || job?.id,
      message: "Automation worker exhausted retries",
      details: {
        triggerType: job?.data?.triggerType || null,
        mirrorBatchId: job?.data?.mirrorBatchId || null,
      },
    });
  }
});
