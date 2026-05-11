import { Queue } from "bullmq";
import { connection } from "../../config/redis.js";
import {
  buildDefaultJobOptions,
  createLazyQueueProxy,
  mergeJobOptions,
} from "../../utils/jobQueueUtils.js";

const QUEUE_NAME = process.env.PRODUCT_TYPE_REFRESH_QUEUE || "productTypeRefresh";

const defaultJobOptions = buildDefaultJobOptions({
  attempts: 3,
  priority: 5,
  backoffDelay: 5_000,
  removeOnComplete: { age: 24 * 3600, count: 2000 },
  removeOnFail: { age: 14 * 24 * 3600, count: 2000 },
});

let queueInstance = null;

function getQueue() {
  if (!queueInstance) {
    queueInstance = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions,
    });
  }
  return queueInstance;
}

export const productTypeRefreshQueue = createLazyQueueProxy(getQueue);

export function addProductTypeRefreshJob(data = {}, options = {}) {
  if (!data?.shop) {
    throw new Error("product type refresh job requires shop");
  }
  return getQueue().add(
    "product-type-refresh",
    data,
    mergeJobOptions(defaultJobOptions, {
      ...options,
      jobId: options.jobId || `product-type-refresh:${data.shop}`,
    }),
  );
}

