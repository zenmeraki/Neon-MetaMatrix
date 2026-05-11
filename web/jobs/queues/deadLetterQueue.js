import { Queue } from "bullmq";
import { connection } from "../../config/redis.js";

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

export async function addDeadLetterJob(
  queueName,
  { job, error, reason, originalJobId: providedOriginalJobId = null },
) {
  const targetQueueName = queueName || DEFAULT_DLQ_NAME;
  const shop = job?.data?.shop || "unknown";
  const originalJobId = providedOriginalJobId || job?.id || "unknown";

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

  const payload = deadLetterJob.data.data;
  if (payload?.historyId) {
    if (!payload?.executionId || !payload?.operationId) {
      throw new Error("IMMUTABLE_LINEAGE_REQUIRED_FOR_BULK_EDIT_REPLAY");
    }
  }
  if (payload?.exportJobId) {
    if (!payload?.executionId) {
      throw new Error("IMMUTABLE_LINEAGE_REQUIRED_FOR_EXPORT_REPLAY");
    }
  }

  return targetQueue.add(
    deadLetterJob.data.originalName || "replay",
    payload,
    {
      jobId: deadLetterJob.data.originalJobId,
    },
  );
}

export { getDeadLetterQueue };
