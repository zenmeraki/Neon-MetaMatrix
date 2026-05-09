import { Queue } from "bullmq";
import { connection } from "../../config/redis.js";

export const automationQueue = new Queue("automation", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 15000,
    },
    removeOnComplete: {
      age: 7 * 24 * 3600,
      count: 5000,
    },
    removeOnFail: {
      age: 30 * 24 * 3600,
      count: 10000,
    },
  },
});

export function buildAutomationJobId({ shop, triggerType, mirrorBatchId }) {
  return `automation:${shop}:${triggerType}:${mirrorBatchId}`;
}
