// Jobs/Queues/appUninstallQueue.js
import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";

export const appUninstallQueue = new Queue("appUninstall", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      count: 100,
      age: 24 * 3600, // 24 hours
    },
    removeOnFail: {
      count: 1000,
      age: 7 * 24 * 3600, // 7 days
    },
  },
});

export const addAppUninstallJob = async (data, options = {}) => {
  try {
    const job = await appUninstallQueue.add("processUninstall", data, {
      priority: 5,
      ...options,
    });
    return job;
  } catch (error) {
    console.error("❌ Failed to add app uninstall job:", error);
    throw error;
  }
};