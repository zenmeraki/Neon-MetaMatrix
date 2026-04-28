import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";
import {
  buildDefaultJobOptions,
  createLazyQueueProxy,
  mergeJobOptions,
} from "../../utils/jobQueueUtils.js";

const QUEUE_NAME = process.env.EDIT_QUEUE || "bulk-edit";

const defaultJobOptions = buildDefaultJobOptions({
  attempts: 6,
  priority: 7,
  backoffDelay: 30_000,
  removeOnComplete: { age: 7 * 24 * 3600, count: 2_000 },
  removeOnFail: { age: 30 * 24 * 3600, count: 10_000 },
});

let bulkEditQueueInstance = null;

function getBulkEditQueue() {
  if (!bulkEditQueueInstance) {
    bulkEditQueueInstance = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions,
    });
  }

  return bulkEditQueueInstance;
}

export const bulkEditQueue = createLazyQueueProxy(getBulkEditQueue);

export async function addbulkEditJob(data, options = {}) {
  if (!data?.historyId || !data?.shop || !data?.executionId) {
    throw new Error("bulk edit job requires historyId, shop, and executionId");
  }

  return getBulkEditQueue().add(
    "bulk-edit",
    data,
    mergeJobOptions(defaultJobOptions, {
      ...options,
      jobId: options.jobId || `bulk-edit:${data.historyId}`,
    }),
  );
}

export { getBulkEditQueue };
