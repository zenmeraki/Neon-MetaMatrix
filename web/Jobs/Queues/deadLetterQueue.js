import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";

const DLQ_OPTIONS = {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 30 * 24 * 3600, count: 20_000 },
    removeOnFail: { age: 30 * 24 * 3600, count: 20_000 },
  },
};
const DEFAULT_DLQ_NAME = "operation.dlq";

const queues = new Map();

function getDeadLetterQueue(name) {
  if (!queues.has(name)) {
    queues.set(name, new Queue(name, DLQ_OPTIONS));
  }

  return queues.get(name);
}

export async function addDeadLetterJob(queueName, { job, error, reason }) {
  const targetQueueName = queueName || DEFAULT_DLQ_NAME;
  const shop = job?.data?.shop || "unknown";
  const originalJobId = job?.id || "unknown";

  return getDeadLetterQueue(targetQueueName).add(
    "dead-letter",
    {
      reason,
      failedAt: new Date().toISOString(),
      originalJobId,
      originalName: job?.name || null,
      originalQueue: job?.queueName || null,
      data: job?.data || null,
      attemptsMade: job?.attemptsMade || 0,
      error: {
        message: error?.message || String(error || ""),
        code: error?.code || null,
        stack: error?.stack || null,
      },
    },
    {
      jobId: `${targetQueueName}:${shop}:${originalJobId}:${Date.now()}`,
    },
  );
}

export async function replayDeadLetterJob(queueName, deadLetterJobId, targetQueue) {
  const dlq = getDeadLetterQueue(queueName);
  const deadLetterJob = await dlq.getJob(deadLetterJobId);

  if (!deadLetterJob?.data?.data) {
    throw new Error("Dead-letter job not found or missing original payload");
  }

  return targetQueue.add(
    deadLetterJob.data.originalName || "replay",
    deadLetterJob.data.data,
    {
      jobId: `replay:${deadLetterJob.data.originalJobId}:${Date.now()}`,
    },
  );
}

export { getDeadLetterQueue };
