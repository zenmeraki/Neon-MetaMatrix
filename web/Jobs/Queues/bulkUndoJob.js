import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";
import logger from "../../utils/loggerUtils.js";

export const bulkUndoQueue = new Queue(process.env.UNDO_QUEUE, {
  connection,
});

// Add a job to the queue
export const addbulkUndoJob = async (data) => {
  try {
    const job = await bulkUndoQueue.add("AddingBulkUnd", data, {
      // attempts: 3,
      removeOnComplete: true,
      // removeOnFail: false,
      // timeout: 1000 * 60 * 10, // 10 min per job
    });

   

    // Optional: check job state after some delay (or use events)
    const currentJob = await bulkUndoQueue.getJob(job.id);
    const state = await currentJob.getState();
     

    return job;
  } catch (error) {
    
    
    throw error;
  }
};
