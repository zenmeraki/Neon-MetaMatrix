import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";
import "../Workers/productUpdateWorker.js";
import logger from "../../utils/loggerUtils.js";

const QueueName =
  process.env.NODE_ENV == "production"
    ? "product-update"
    : "product-update-job-dev";

export const productUpdateQueue = new Queue(QueueName, {
  connection,
});

// Add a job to the queue
export const addProductUpdateJob = async (
  data,
  options = { removeOnComplete: true }
) => {
  try {
 const job = await productUpdateQueue.add("AddingProductUpdateJob", data, options);

    
 

    const currentJob = await productUpdateQueue.getJob(job.id);
    const state = await currentJob?.getState();


    
    return job;
    } catch (error) {
      
      
    throw error;
  }
};
