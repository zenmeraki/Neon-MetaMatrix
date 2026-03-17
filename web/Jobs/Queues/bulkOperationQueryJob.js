import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";
import { bulkOperationQueryWorker } from "../Workers/bulkOperationQueryWorker.js";
export const bulkOperationQueryQueue = new Queue(
  process.env.BULK_OPERATION_QUERY_QUEUE || "bulk-operation-query",
  {
    connection,
  }
);

// Add a job to the queue
export const addbulkOperatonQueryJob = async (data) => {
  try {
    const job = await bulkOperationQueryQueue.add(
      "AddingBulkOperationsQeueue",
      data,
      {
        // attempts: 3,
        removeOnComplete: true,
        // removeOnFail: false,
        // timeout: 1000 * 60 * 10, // 10 min per job
      }
    );

    const currentJob = await bulkOperationQueryQueue.getJob(job.id);
    const state = await currentJob?.getState();
    return job;
  } catch (error) {
    throw error;
  }
};
