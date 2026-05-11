import { Worker } from "bullmq";
import { connection } from "../../config/redis.js";
import logger from "../../utils/loggerUtils.js";

export function createWorker(queueName, processor, options = {}) {
  const worker = new Worker(queueName, processor, {
    connection,
    concurrency: options.concurrency || 1,
    limiter: options.limiter,
    autorun: options.autorun ?? true,
    lockDuration: options.lockDuration ?? 30_000,
    stalledInterval: options.stalledInterval ?? 30_000,
    maxStalledCount: options.maxStalledCount ?? 1,
  });

  worker.on("completed", (job) => {
    logger.info(`[${queueName}] completed`, {
      jobId: job.id,
      name: job.name,
    });
  });

  worker.on("failed", (job, error) => {
    logger.error(`[${queueName}] failed`, {
      jobId: job?.id,
      name: job?.name,
      error: error?.message,
      stack: error?.stack,
    });
  });

  worker.on("error", (error) => {
    logger.error(`[${queueName}] worker error`, {
      message: error?.message,
      stack: error?.stack,
    });
  });

  return worker;
}
