import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";
import "../Workers/productDeleteWorker.js"
import logger from "../../utils/loggerUtils.js";

const QueueName =
  process.env.NODE_ENV == "production"
    ? "product-delete"
    : "product-delete-job-dev";

export const productDeleteQueue = new Queue(QueueName, {
  connection,
});

// Add a job to the queue
export const addProductDeleteJob = async (
  data,
  options = { removeOnComplete: true }
) => {
  try {
    productDeleteQueue.add("AddingproductDeleteQueue", data, options);
  } catch (error) {
    
    
    throw error;
  }
};
