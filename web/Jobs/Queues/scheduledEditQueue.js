import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";
import { buildDefaultJobOptions } from "../../utils/jobQueueUtils.js";

export const scheduledEditQueue = new Queue("scheduled-edit-queue", {
  connection,
  defaultJobOptions: buildDefaultJobOptions({
    attempts: 6,
    priority: 6,
    backoffDelay: 10_000,
    removeOnComplete: { age: 7 * 24 * 3600, count: 2_000 },
    removeOnFail: { age: 30 * 24 * 3600, count: 5_000 },
  }),
});
