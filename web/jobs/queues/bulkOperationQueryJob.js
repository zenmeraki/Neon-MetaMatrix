import { Queue } from "bullmq";
import { connection } from "../../config/redis.js";
import {
  buildDefaultJobOptions,
  createLazyQueueProxy,
  mergeJobOptions,
} from "../../utils/jobQueueUtils.js";

const QUEUE_NAME =
  process.env.BULK_OPERATION_QUERY_QUEUE || "bulk-operation-query";

const defaultJobOptions = buildDefaultJobOptions({
  attempts: 8,
  priority: 8,
  backoffDelay: 5_000,
  removeOnComplete: { age: 48 * 3600, count: 2_000 },
  removeOnFail: { age: 14 * 24 * 3600, count: 10_000 },
});

let bulkOperationQueryQueueInstance = null;

function getBulkOperationQueryQueue() {
  if (!bulkOperationQueryQueueInstance) {
    bulkOperationQueryQueueInstance = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions,
    });
  }

  return bulkOperationQueryQueueInstance;
}

export const bulkOperationQueryQueue = createLazyQueueProxy(
  getBulkOperationQueryQueue,
);

export async function addbulkOperatonQueryJob(data, options = {}) {
  const entityId =
    data?.admin_graphql_api_id || data?.id || data?.bulkOperationId || "unknown";

  const jobId =
    options.jobId ||
    `bulk-op-query-finish:${data?.shop}:${entityId}`;

  return getBulkOperationQueryQueue().add(
    "bulk-operation-query",
    data,
    mergeJobOptions(defaultJobOptions, {
      ...options,
      jobId,
    }),
  );
}

export { getBulkOperationQueryQueue };
