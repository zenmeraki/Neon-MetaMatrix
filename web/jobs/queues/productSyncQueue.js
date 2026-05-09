// jobs/queues/productSyncQueue.js
import { Queue } from "bullmq";
import { connection } from "../../config/redis.js";
import { createLazyQueueProxy } from "../../utils/jobQueueUtils.js";
import { OPERATION_QUEUE_NAMES } from "./operationQueueRegistry.js";
import { applyQueueBackpressure } from "./queueBackpressure.js";

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 2000,
  },
  removeOnComplete: {
    age: 3600,
    count: 100,
  },
  removeOnFail: {
    age: 7 * 24 * 3600,
  },
};

let productSyncQueueInstance = null;

function getProductSyncQueue() {
  if (!productSyncQueueInstance) {
    productSyncQueueInstance = applyQueueBackpressure(
      new Queue(
        process.env.PRODUCT_SYNC_QUEUE || OPERATION_QUEUE_NAMES.SYNC_CATALOG_START,
        {
          connection,
          defaultJobOptions,
        },
      ),
    );
  }

  return productSyncQueueInstance;
}

export const productSyncQueue = createLazyQueueProxy(getProductSyncQueue);

// ============================================
// Setup Repeatable Jobs (BullMQ Cron)
// ============================================

export const setupProductSyncCron = async () => {
  try {
    // Remove any existing repeatable jobs to avoid duplicates
    const queue = getProductSyncQueue();
    const repeatableJobs = await queue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await queue.removeRepeatableByKey(job.key);
    }

    // ============================================
    // AUTO SYNC - Every 6 hours
    // ============================================
    await queue.add(
      "auto-sync-scheduler",
      { type: "auto-sync" },
      {
        repeat: {
          pattern: "0 */6 * * *", // Every 6 hours
        },
        jobId: "auto-sync-scheduler",
      }
    );
    // ============================================
    // PRIORITY SYNC - Every 2 hours
    // ============================================
    // await productSyncQueue.add(
    //   "priority-sync-scheduler",
    //   { type: "priority-sync" },
    //   {
    //     repeat: {
    //       pattern: "0 */2 * * *", // Every 2 hours
    //     },
    //     jobId: "priority-sync-scheduler",
    //   }
    // );

  } catch (error) {
    console.error("❌ Error setting up cron jobs:", error.message);
    throw error;
  }
};

export { getProductSyncQueue };
