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
import { applyQueueBackpressure } from "./queueBackpressure.js";

const QUEUE_NAME = process.env.EDIT_QUEUE || OPERATION_QUEUE_NAMES.BULK_EDIT_EXECUTE;

const defaultJobOptions = buildDefaultJobOptions({
  attempts: 6,
  priority: 7,
  backoffDelay: 30_000,
  removeOnComplete: { age: 7 * 24 * 3600, count: 2_000 },
  removeOnFail: { age: 30 * 24 * 3600, count: 10_000 },
});

let bulkEditQueueInstance = null;

function getBulkEditQueue() {
  if (!bulkEditQueueInstance) {
    bulkEditQueueInstance = applyQueueBackpressure(
      new Queue(QUEUE_NAME, {
        connection,
        defaultJobOptions,
      }),
    );
  }

  return bulkEditQueueInstance;
}

export const bulkEditQueue = createLazyQueueProxy(getBulkEditQueue);

export async function addbulkEditJob(data, options = {}) {
  if (!data?.historyId || !data?.shop || !data?.executionId) {
    throw new Error("bulk edit job requires historyId, shop, and executionId");
  }

  const shopPriority = Number(options.priority ?? data.shopWeight ?? data.priority);

  return getBulkEditQueue().add(
    "bulk-edit",
    data,
    mergeJobOptions(defaultJobOptions, {
      ...options,
      ...(Number.isFinite(shopPriority) && shopPriority > 0
        ? { priority: Math.floor(shopPriority) }
        : {}),
      jobId:
        options.jobId ||
        buildOperationJobId(OPERATION_QUEUE_NAMES.BULK_EDIT_EXECUTE, {
          ...data,
          operationId: data.operationId || data.executionId || data.historyId,
        }),
    }),
  );
}

export { getBulkEditQueue };
