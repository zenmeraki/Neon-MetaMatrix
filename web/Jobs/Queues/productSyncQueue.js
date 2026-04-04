// Jobs/Queues/productSyncQueue.js
import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";

export const productSyncQueue = new Queue("product-sync-queue", {
  connection: connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600, // Keep jobs for 1 hour
      count: 100,
    },
    removeOnFail: {
      age: 7 * 24 * 3600, // Keep failed jobs for 7 days
    },
  },
});

// ============================================
// Setup Repeatable Jobs (BullMQ Cron)
// ============================================

export const setupProductSyncCron = async () => {
  try {
    // Remove any existing repeatable jobs to avoid duplicates
    const repeatableJobs = await productSyncQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await productSyncQueue.removeRepeatableByKey(job.key);
    }

    // ============================================
    // AUTO SYNC - Every 6 hours
    // ============================================
    await productSyncQueue.add(
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