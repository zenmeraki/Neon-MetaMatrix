import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";
import logger from "../../utils/loggerUtils.js";

// import connectToDatabase from "../../Server/Config/database.js";

// await connectToDatabase(); // Connect to the database when the server starts

export const bulkImportEditQueue = new Queue(
  process.env.IMPORT_EDIT_QUEUE || "importEdit",
  { connection }
);

// Add a job to the queue
export const addbulkImportEditJob = async (data) => {
  try {
    const job = await bulkImportEditQueue.add("AddingBulkImportEdit", data, {
      // attempts: 3,
      removeOnComplete: true,
      // removeOnFail: false,
      // timeout: 1000 * 60 * 10, // 10 min per job
    });

    

    // Optional: check job state after some delay (or use events)
    const currentJob = await bulkImportEditQueue.getJob(job.id);
    const state = await currentJob?.getState();

     
  } catch (error) {
   
    throw error;
  }
};
