import { Queue } from "bullmq";
import { connection } from "../../config/redis.js";
import { applyQueueBackpressure } from "./queueBackpressure.js";

export function createQueue(name, defaultJobOptions) {
  return applyQueueBackpressure(new Queue(name, {
    connection,
    defaultJobOptions,
  }));
}
