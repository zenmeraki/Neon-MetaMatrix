import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";
import {
  buildDefaultJobOptions,
  createLazyQueueProxy,
  mergeJobOptions,
} from "../../utils/jobQueueUtils.js";

const QUEUE_NAME = process.env.IMPORT_EDIT_QUEUE || "importEdit";

const defaultJobOptions = buildDefaultJobOptions({
  attempts: 4,
  priority: 6,
  backoffDelay: 10_000,
  removeOnComplete: { age: 24 * 3600, count: 500 },
  removeOnFail: { age: 14 * 24 * 3600, count: 2_000 },
});

let bulkImportEditQueueInstance = null;

function getBulkImportEditQueue() {
  if (!bulkImportEditQueueInstance) {
    bulkImportEditQueueInstance = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions,
    });
  }

  return bulkImportEditQueueInstance;
}

export const bulkImportEditQueue = createLazyQueueProxy(getBulkImportEditQueue);

export async function addbulkImportEditJob(data, options = {}) {
  if (!data?.historyId || !data?.shop || !data?.filePath) {
    throw new Error("bulk import edit job requires historyId, shop, and filePath");
  }

  const jobId = options.jobId || `import-edit:${data?.historyId}`;

  return getBulkImportEditQueue().add(
    "bulk-import-edit",
    data,
    mergeJobOptions(defaultJobOptions, {
      ...options,
      jobId,
    }),
  );
}

export { getBulkImportEditQueue };
