import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";
import {
  buildDefaultJobOptions,
  buildWebhookJobId,
  createLazyQueueProxy,
  mergeJobOptions,
} from "../../utils/jobQueueUtils.js";

const QUEUE_NAME =
  process.env.NODE_ENV === "production"
    ? "product-delete"
    : "product-delete-job-dev";

const defaultJobOptions = buildDefaultJobOptions({
  attempts: 5,
  priority: 10,
  backoffDelay: 2_000,
  removeOnComplete: { age: 24 * 3600, count: 2_000 },
  removeOnFail: { age: 14 * 24 * 3600, count: 5_000 },
});

let productDeleteQueueInstance = null;

function getProductDeleteQueue() {
  if (!productDeleteQueueInstance) {
    productDeleteQueueInstance = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions,
    });
  }

  return productDeleteQueueInstance;
}

export const productDeleteQueue = createLazyQueueProxy(getProductDeleteQueue);

export async function addProductDeleteJob(data, options = {}) {
  const jobId =
    options.jobId ||
    buildWebhookJobId({
      topic: "PRODUCTS_DELETE",
      webhookId: data?.webhookId,
      shop: data?.shop,
      entityId: data?.id,
    });

  return getProductDeleteQueue().add(
    "product-delete",
    data,
    mergeJobOptions(defaultJobOptions, {
      ...options,
      jobId,
    }),
  );
}

export { getProductDeleteQueue };
