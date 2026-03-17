import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";
import logger from "../../utils/loggerUtils.js";
export const bulkOperationMutationQueue = new Queue(
  process.env.BULK_OPERATION_MUTATION_QUEUE || "bulk-operation-mutation",
  {
    connection,
  }
);


// Add a job to the queue
export const addbulkOperatonMutationJob  = async (data) => {
  try {
    const job = await bulkOperationMutationQueue.add(
      "AddingBulkOperationsMutation",
      data,
      {
        // attempts: 3,
        removeOnComplete: true,
        // removeOnFail: false,
        // timeout: 1000 * 60 * 10, // 10 min per job
      }
    );

    const currentJob = await bulkOperationMutationQueue.getJob(job.id);
    const state = await currentJob?.getState();
    return job;
  } catch (error) {
    throw error;
  }
};
