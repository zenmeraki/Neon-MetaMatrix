import { Worker } from "bullmq";
import { connection } from "../../config/redis.js";

export function createWorker(queueName, processor, options = {}) {
  const worker = new Worker(queueName, processor, {
    connection,
    concurrency: options.concurrency || 1,
    limiter: options.limiter,
    autorun: false,
  });

  worker.on("completed", (job) => {
    console.log(`[${queueName}] completed`, {
      jobId: job.id,
      name: job.name,
    });
  });

  worker.on("failed", (job, error) => {
    console.error(`[${queueName}] failed`, {
      jobId: job?.id,
      name: job?.name,
      error: error?.message,
      stack: error?.stack,
    });
  });

  worker.on("error", (error) => {
    console.error(`[${queueName}] worker error`, error);
  });

  return worker;
}
