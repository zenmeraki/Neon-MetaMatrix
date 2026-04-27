import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";
import {
  buildDefaultJobOptions,
  createLazyQueueProxy,
  mergeJobOptions,
} from "../../utils/jobQueueUtils.js";

const QUEUE_NAME = "appUninstall";

const defaultJobOptions = buildDefaultJobOptions({
  attempts: 5,
  priority: 5,
  backoffDelay: 10_000,
  removeOnComplete: { age: 48 * 3600, count: 500 },
  removeOnFail: { age: 30 * 24 * 3600, count: 5_000 },
});

let appUninstallQueueInstance = null;

function getAppUninstallQueue() {
  if (!appUninstallQueueInstance) {
    appUninstallQueueInstance = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions,
    });
  }

  return appUninstallQueueInstance;
}

export const appUninstallQueue = createLazyQueueProxy(getAppUninstallQueue);

export async function addAppUninstallJob(data, options = {}) {
  const jobId = options.jobId || `app-uninstall:${data?.shop}`;

  return getAppUninstallQueue().add(
    "app-uninstall",
    data,
    mergeJobOptions(defaultJobOptions, {
      ...options,
      jobId,
    }),
  );
}

export { getAppUninstallQueue };
