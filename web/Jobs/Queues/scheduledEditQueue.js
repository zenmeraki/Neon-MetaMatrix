import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";
import {
  OPERATION_QUEUE_NAMES,
  buildOperationJobId,
} from "./operationQueueRegistry.js";
import {
  buildDefaultJobOptions,
  createLazyQueueProxy,
  mergeJobOptions,
} from "../../utils/jobQueueUtils.js";

const defaultJobOptions = buildDefaultJobOptions({
  attempts: 6,
  priority: 6,
  backoffDelay: 10_000,
  removeOnComplete: { age: 7 * 24 * 3600, count: 2_000 },
  removeOnFail: { age: 30 * 24 * 3600, count: 5_000 },
});

let scheduledEditQueueInstance = null;

function getScheduledEditQueue() {
  if (!scheduledEditQueueInstance) {
    scheduledEditQueueInstance = new Queue(
      process.env.SCHEDULED_EDIT_QUEUE || OPERATION_QUEUE_NAMES.SCHEDULED_DISPATCH,
      {
      connection,
      defaultJobOptions,
      },
    );
  }

  return scheduledEditQueueInstance;
}

export const scheduledEditQueue = createLazyQueueProxy(getScheduledEditQueue);

export async function addScheduledEditJob(name, data = {}, options = {}) {
  if (!data?.historyId || !data?.shop) {
    throw new Error("scheduled edit job requires historyId and shop");
  }

  return getScheduledEditQueue().add(
    name,
    data,
    mergeJobOptions(defaultJobOptions, {
      ...options,
      jobId:
        options.jobId ||
        buildOperationJobId(
          name === "undo-task"
            ? OPERATION_QUEUE_NAMES.UNDO_EXECUTE
            : OPERATION_QUEUE_NAMES.SCHEDULED_DISPATCH,
          {
            ...data,
            undoOperationId: data.undoOperationId || data.executionId || data.historyId,
          },
        ),
    }),
  );
}

export { getScheduledEditQueue };
