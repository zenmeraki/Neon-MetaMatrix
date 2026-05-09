import { Queue } from "bullmq";
import { connection } from "../../config/redis.js";
import {
  buildDefaultJobOptions,
  buildWebhookJobId,
  createLazyQueueProxy,
  mergeJobOptions,
} from "../../utils/jobQueueUtils.js";

const QUEUE_NAME =
  process.env.BULK_OPERATION_MUTATION_QUEUE || "bulk-operation-mutation";

const defaultJobOptions = buildDefaultJobOptions({
  attempts: 8,
  priority: 8,
  backoffDelay: 5_000,
  removeOnComplete: { age: 48 * 3600, count: 2_000 },
  removeOnFail: { age: 14 * 24 * 3600, count: 10_000 },
});

let bulkOperationMutationQueueInstance = null;

function getBulkOperationMutationQueue() {
  if (!bulkOperationMutationQueueInstance) {
    bulkOperationMutationQueueInstance = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions,
    });
  }

  return bulkOperationMutationQueueInstance;
}

export const bulkOperationMutationQueue = createLazyQueueProxy(
  getBulkOperationMutationQueue,
);

export async function addbulkOperatonMutationJob(data, options = {}) {
  const entityId =
    data?.admin_graphql_api_id || data?.id || data?.bulkOperationId || "unknown";
  const jobId =
    options.jobId ||
    buildWebhookJobId({
      topic: "BULK_OPERATIONS_FINISH_MUTATION",
      webhookId: data?.webhookId,
      shop: data?.shop,
      entityId,
    });

  return getBulkOperationMutationQueue().add(
    "bulk-operation-mutation",
    data,
    mergeJobOptions(defaultJobOptions, {
      ...options,
      jobId,
    }),
  );
}

export { getBulkOperationMutationQueue };
