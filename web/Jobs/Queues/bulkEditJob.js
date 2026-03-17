//web/Jobs/Queues/bulkEditJob.js
import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";
import logger from "../../utils/loggerUtils.js";

// import connectToDatabase from "../../Server/Config/database.js";

// await connectToDatabase(); // Connect to the database when the server starts

export const bulkEditQueue = new Queue(process.env.EDIT_QUEUE, { connection });

// Add a job to the queue
export const addbulkEditJob = async (data) => {
  try {
    const job = await bulkEditQueue.add("AddingBulkEdit", data, {
      // attempts: 3,
      removeOnComplete: true,
      // removeOnFail: false,
      // timeout: 1000 * 60 * 10, // 10 min per job
    });

   

    // Optional: check job state after some delay (or use events)
    const currentJob = await bulkEditQueue.getJob(job.id);
    const state = await currentJob?.getState();
    return job;
  } catch (error) {
   
    throw error;
  }
};
