import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";
import logger from "../../utils/loggerUtils.js";

// import connectToDatabase from "../../Server/Config/database.js";

// await connectToDatabase(); // Connect to the database when the server starts

export const bulkExportQueue = new Queue(process.env.EXPORT_QUEUE, {
  connection,
});

// Add a job to the queue
export const addbulkExportJob = async (data) => {
  try {
    const job = await bulkExportQueue.add("AddingBulkExport", data, {
      jobId: data.exportJobId || undefined,
      removeOnComplete: 100,
      removeOnFail: 100,
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 30_000,
      },
    });
    return job;
  } catch (error) {
    throw error;
  }
};
