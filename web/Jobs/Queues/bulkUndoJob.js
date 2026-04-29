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

const QUEUE_NAME = process.env.UNDO_QUEUE || OPERATION_QUEUE_NAMES.UNDO_EXECUTE;

const defaultJobOptions = buildDefaultJobOptions({
  attempts: 2,
  priority: 7,
  backoffDelay: 30_000,
  removeOnComplete: { age: 48 * 3600, count: 1_000 },
  removeOnFail: { age: 14 * 24 * 3600, count: 5_000 },
});

let bulkUndoQueueInstance = null;

function getBulkUndoQueue() {
  if (!bulkUndoQueueInstance) {
    bulkUndoQueueInstance = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions,
    });
  }

  return bulkUndoQueueInstance;
}

export const bulkUndoQueue = createLazyQueueProxy(getBulkUndoQueue);

export async function addBulkUndoJob(data, options = {}) {
  if (!data?.historyId || !data?.shop || !data?.executionId) {
    throw new Error("bulk undo job requires historyId, shop, and executionId");
  }

  const jobId =
    options.jobId ||
    buildOperationJobId(OPERATION_QUEUE_NAMES.UNDO_EXECUTE, {
      ...data,
      undoOperationId: data.undoOperationId || data.operationId || data.executionId,
    });

  return getBulkUndoQueue().add(
    "bulk-undo",
    data,
    mergeJobOptions(defaultJobOptions, {
      ...options,
      jobId,
    }),
  );
}

export { getBulkUndoQueue };
