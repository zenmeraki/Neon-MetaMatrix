import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";
import {
  buildDefaultJobOptions,
  mergeJobOptions,
} from "../../utils/jobQueueUtils.js";

const QUEUE_NAME =
  process.env.NODE_ENV === "production"
    ? "product-reconcile"
    : "product-reconcile-job-dev";

const defaultJobOptions = buildDefaultJobOptions({
  attempts: 6,
  priority: 8,
  backoffDelay: 3_000,
  removeOnComplete: { age: 24 * 3600, count: 2_000 },
  removeOnFail: { age: 14 * 24 * 3600, count: 5_000 },
});

export const productReconcileQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions,
});

export async function addProductReconcileJob(data, options = {}) {
  const mode = data?.mode || "product";
  const jobId =
    options.jobId ||
    (mode === "shop_incremental"
      ? `product-reconcile:shop:${data?.shop}`
      : `product-reconcile:product:${data?.shop}:${data?.productId}`);

  return productReconcileQueue.add(
    "product-reconcile",
    data,
    mergeJobOptions(defaultJobOptions, {
      ...options,
      jobId,
    }),
  );
}
