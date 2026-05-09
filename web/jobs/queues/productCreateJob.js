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
    ? "product-create"
    : "product-create-job-dev";

const defaultJobOptions = buildDefaultJobOptions({
  attempts: 5,
  priority: 10,
  backoffDelay: 2_000,
  removeOnComplete: { age: 24 * 3600, count: 2_000 },
  removeOnFail: { age: 14 * 24 * 3600, count: 5_000 },
});

let productCreateQueueInstance = null;

function getProductCreateQueue() {
  if (!productCreateQueueInstance) {
    productCreateQueueInstance = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions,
    });
  }

  return productCreateQueueInstance;
}

export const productCreateQueue = createLazyQueueProxy(getProductCreateQueue);

export async function addProductCreateJob(data, options = {}) {
  const jobId =
    options.jobId ||
    buildWebhookJobId({
      topic: "PRODUCTS_CREATE",
      webhookId: data?.webhookId,
      shop: data?.shop,
      entityId: data?.id,
    });

  return getProductCreateQueue().add(
    "product-create",
    data,
    mergeJobOptions(defaultJobOptions, {
      ...options,
      jobId,
    }),
  );
}

export { getProductCreateQueue };
