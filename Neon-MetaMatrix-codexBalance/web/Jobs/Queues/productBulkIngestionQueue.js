import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";
import {
  buildDefaultJobOptions,
  createLazyQueueProxy,
  mergeJobOptions,
} from "../../utils/jobQueueUtils.js";

const QUEUE_NAME =
  process.env.PRODUCT_BULK_INGESTION_QUEUE || "product-bulk-ingestion";

const defaultJobOptions = buildDefaultJobOptions({
  attempts: 5,
  priority: 5,
  backoffDelay: 15_000,
  removeOnComplete: { age: 48 * 3600, count: 1000 },
  removeOnFail: { age: 14 * 24 * 3600, count: 5000 },
});

let queueInstance = null;

function getProductBulkIngestionQueue() {
  if (!queueInstance) {
    queueInstance = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions,
    });
  }

  return queueInstance;
}

export const productBulkIngestionQueue = createLazyQueueProxy(
  getProductBulkIngestionQueue,
);

export async function enqueueProductBulkIngestionJob(data, options = {}) {
  if (!data?.shop || !data?.syncHistoryId || !data?.bulkOperationId) {
    throw new Error(
      "product bulk ingestion job requires shop, syncHistoryId, and bulkOperationId",
    );
  }

  const jobId =
    options.jobId ||
    `product-bulk-ingestion:${data.shop}:${data.syncHistoryId}:${data.bulkOperationId}`;

  return getProductBulkIngestionQueue().add(
    "product-bulk-ingestion",
    data,
    mergeJobOptions(defaultJobOptions, {
      ...options,
      jobId,
    }),
  );
}

export { getProductBulkIngestionQueue };
