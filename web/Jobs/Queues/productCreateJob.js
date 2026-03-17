import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";
import "../Workers/productCreateWorker.js";
import { tr } from "zod/v4/locales";
import logger from "../../utils/loggerUtils.js";

const QueueName =

  process.env.NODE_ENV == "production"
    ? "product-create"
    : "product-create-job-dev";

export const productCreateQueue = new Queue(QueueName, {
  connection,
});

// Add a job to the queue
export const addProductCreateJob = async (
  data,
  options = { removeOnComplete: true }
) => {
  try {
 const job = await productCreateQueue.add("addingProductCreateJob", data, options);

    
 

    const currentJob = await productCreateQueue.getJob(job.id);
    const state = await currentJob?.getState();


    
    return job;
    } catch (error) {
    
      
    throw error;
  }
};
