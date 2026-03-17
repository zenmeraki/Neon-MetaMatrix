import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";
import logger from "../../utils/loggerUtils.js"
export const appInstallationQueue = new Queue(process.env.APP_INSTALLATION_QUEUE, { connection });

// Add a job to the queue
export const addAppInstallationJob = async (data) => {
  try {
    const job = await appInstallationQueue.add("addinAppInstallationJob", data, {
      // attempts: 3,
      removeOnComplete: true,
      // removeOnFail: false,
      // timeout: 1000 * 60 * 10, // 10 min per job
    });

   
    // Optional: check job state after some delay (or use events)
    const currentJob = await appInstallationQueue.getJob(job.id);
    const state = await currentJob?.getState();
   
  } catch (error) {
   
    throw error;
  }
};
