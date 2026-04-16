import { Worker } from "bullmq";
import { connection } from "../Config/redis.js";
import {
  AUTOMATIC_PRODUCT_RULE_EXECUTION_QUEUE,
  executeAutomaticProductRuleRun,
} from "../services/automaticProductRuleExecutionService.js";
import logger from "../utils/loggerUtils.js";
import {
  getJobAttempt,
  isRetryExhausted,
  recordRetryExhausted,
} from "../utils/workerTelemetry.js";

const automaticProductRuleExecutionWorker = new Worker(
  AUTOMATIC_PRODUCT_RULE_EXECUTION_QUEUE,
  async (job) => {
    const { runId, shop } = job.data || {};
    if (!runId || !shop) {
      throw new Error("automatic product rule execution job requires runId and shop");
    }

    return executeAutomaticProductRuleRun(runId, shop);
  },
  {
    connection,
    concurrency: 3,
  },
);

automaticProductRuleExecutionWorker.on("completed", (job, result) => {
  logger.info("Automatic product rule execution worker completed job", {
    worker: "automaticProductRuleExecutionWorker",
    queue: AUTOMATIC_PRODUCT_RULE_EXECUTION_QUEUE,
    jobId: job.id,
    shop: job.data?.shop,
    runId: job.data?.runId,
    attempt: getJobAttempt(job),
    result,
  });
});

automaticProductRuleExecutionWorker.on("failed", async (job, error) => {
  logger.error("Automatic product rule execution worker failed job", {
    worker: "automaticProductRuleExecutionWorker",
    queue: AUTOMATIC_PRODUCT_RULE_EXECUTION_QUEUE,
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
      worker: "automaticProductRuleExecutionWorker",
      queue: AUTOMATIC_PRODUCT_RULE_EXECUTION_QUEUE,
      entityType: "automaticProductRuleRun",
      entityId: job?.data?.runId,
      executionId: job?.data?.runId,
      message: "Automatic product rule execution worker exhausted retries",
    });
  }
});

export default automaticProductRuleExecutionWorker;
