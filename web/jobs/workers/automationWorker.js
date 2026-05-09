import { Worker } from "bullmq";
import { connection } from "../../config/redis.js";
import { triggerAutomations } from "../../services/automation/automationTriggerService.js";
import logger from "../../utils/loggerUtils.js";

export const automationWorker = new Worker(
  "automation",
  async (job) => {
    const { shop, triggerType, mirrorBatchId, triggerReason } = job.data || {};

    if (!shop) throw new Error("SHOP_REQUIRED");
    if (!triggerType) throw new Error("TRIGGER_TYPE_REQUIRED");
    if (!mirrorBatchId) throw new Error("MIRROR_BATCH_ID_REQUIRED");

    return triggerAutomations({
      shop,
      triggerType,
      mirrorBatchId,
      triggerReason,
    });
  },
  {
    connection,
    concurrency: Number(process.env.AUTOMATION_WORKER_CONCURRENCY || 2),
  },
);

automationWorker.on("failed", (job, error) => {
  logger.error("Automation worker failed", {
    jobId: job?.id,
    error: error.message,
    stack: error.stack,
  });
});
