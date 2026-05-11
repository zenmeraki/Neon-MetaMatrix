import { Queue } from "bullmq";
import { connection } from "../../config/redis.js";
import {
  buildDefaultJobOptions,
  createLazyQueueProxy,
  mergeJobOptions,
} from "../../utils/jobQueueUtils.js";

const QUEUE_NAME = process.env.APP_INSTALLATION_QUEUE;

const defaultJobOptions = buildDefaultJobOptions({
  attempts: 5,
  priority: 5,
  backoffDelay: 10_000,
  removeOnComplete: { age: 48 * 3600, count: 500 },
  removeOnFail: { age: 14 * 24 * 3600, count: 2_000 },
});

let appInstallationQueueInstance = null;

function getAppInstallationQueue() {
  if (!appInstallationQueueInstance) {
    appInstallationQueueInstance = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions,
    });
  }

  return appInstallationQueueInstance;
}

export const appInstallationQueue = createLazyQueueProxy(getAppInstallationQueue);

export async function addAppInstallationJob(data, options = {}) {
  const jobId = options.jobId || `app-install:${data?.shop}`;

  return getAppInstallationQueue().add(
    "app-installation",
    data,
    mergeJobOptions(defaultJobOptions, {
      ...options,
      jobId,
    }),
  );
}

export { getAppInstallationQueue };
