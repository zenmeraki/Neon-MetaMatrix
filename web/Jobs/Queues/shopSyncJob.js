import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";
import {
  buildDefaultJobOptions,
  buildWebhookJobId,
  mergeJobOptions,
} from "../../utils/jobQueueUtils.js";

const QUEUE_NAME = process.env.SHOP_SYNC_QUEUE || "shop-sync-trigger";

const defaultJobOptions = buildDefaultJobOptions({
  attempts: 6,
  priority: 9,
  backoffDelay: 30_000,
  removeOnComplete: { age: 24 * 3600, count: 500 },
  removeOnFail: { age: 14 * 24 * 3600, count: 2_000 },
});

export const shopSyncQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions,
});

export async function addShopSyncJob(data, options = {}) {
  const jobId =
    options.jobId ||
    buildWebhookJobId({
      topic: data?.reason || data?.syncType || "SHOP_SYNC",
      webhookId: data?.webhookId,
      shop: data?.shop,
      entityId: data?.entityId || data?.syncType,
    });

  return shopSyncQueue.add(
    "shop-sync-trigger",
    data,
    mergeJobOptions(defaultJobOptions, {
      ...options,
      jobId,
    }),
  );
}
