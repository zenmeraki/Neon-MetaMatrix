import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";
import {
  buildDefaultJobOptions,
  createLazyQueueProxy,
  mergeJobOptions,
} from "../../utils/jobQueueUtils.js";

const QUEUE_NAME = process.env.EXPORT_QUEUE || "bulk-export";

const defaultJobOptions = buildDefaultJobOptions({
  attempts: 5,
  priority: 6,
  backoffDelay: 30_000,
  removeOnComplete: { age: 7 * 24 * 3600, count: 2_000 },
  removeOnFail: { age: 30 * 24 * 3600, count: 10_000 },
});

let bulkExportQueueInstance = null;

function getBulkExportQueue() {
  if (!bulkExportQueueInstance) {
    bulkExportQueueInstance = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions,
    });
  }

  return bulkExportQueueInstance;
}

export const bulkExportQueue = createLazyQueueProxy(getBulkExportQueue);

export async function addbulkExportJob(data, options = {}) {
  if (!data?.exportJobId || !data?.shop || !data?.executionId) {
    throw new Error("bulk export job requires exportJobId, shop, and executionId");
  }

  return getBulkExportQueue().add(
    "bulk-export",
    data,
    mergeJobOptions(defaultJobOptions, {
      ...options,
      jobId: options.jobId || data.exportJobId,
    }),
  );
}

export { getBulkExportQueue };
