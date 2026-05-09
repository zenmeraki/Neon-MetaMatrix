import { Queue } from "bullmq";
import { connection } from "../../config/redis.js";
import {
  buildDefaultJobOptions,
  buildWebhookJobId,
  createLazyQueueProxy,
  mergeJobOptions,
} from "../../utils/jobQueueUtils.js";

const QUEUE_NAME =
  process.env.NODE_ENV === "production"
    ? "product-update"
    : "product-update-job-dev";

const defaultJobOptions = buildDefaultJobOptions({
  attempts: 5,
  priority: 10,
  backoffDelay: 2_000,
  removeOnComplete: { age: 24 * 3600, count: 2_000 },
  removeOnFail: { age: 14 * 24 * 3600, count: 5_000 },
});

let productUpdateQueueInstance = null;

function getProductUpdateQueue() {
  if (!productUpdateQueueInstance) {
    productUpdateQueueInstance = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions,
    });
  }

  return productUpdateQueueInstance;
}

export const productUpdateQueue = createLazyQueueProxy(getProductUpdateQueue);

export async function addProductUpdateJob(data, options = {}) {
  const jobId =
    options.jobId ||
    buildWebhookJobId({
      topic: "PRODUCTS_UPDATE",
      webhookId: data?.webhookId,
      shop: data?.shop,
      entityId: data?.id,
    });

  return getProductUpdateQueue().add(
    "product-update",
    data,
    mergeJobOptions(defaultJobOptions, {
      ...options,
      jobId,
    }),
  );
}

export { getProductUpdateQueue };
