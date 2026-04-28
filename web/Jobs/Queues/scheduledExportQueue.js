import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";

const QUEUE_NAME =
  process.env.SCHEDULED_EXPORT_QUEUE || "scheduled-export-dispatch";

let scheduledExportQueueInstance = null;

function getScheduledExportQueue() {
  if (!scheduledExportQueueInstance) {
    scheduledExportQueueInstance = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: {
          age: 24 * 3600,
          count: 1000,
        },
        removeOnFail: {
          age: 7 * 24 * 3600,
          count: 5000,
        },
      },
    });
  }

  return scheduledExportQueueInstance;
}

export async function addScheduledExportDispatchJob(data = {}, options = {}) {
  return getScheduledExportQueue().add(
    "dispatch-due-scheduled-exports",
    data,
    options,
  );
}

export { getScheduledExportQueue };
