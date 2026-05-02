import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";
import {
  buildDefaultJobOptions,
  createLazyQueueProxy,
  mergeJobOptions,
} from "../../utils/jobQueueUtils.js";

const QUEUE_NAME =
  process.env.MIRROR_SNAPSHOT_CLEANUP_QUEUE || "mirror-snapshot-cleanup";

const defaultJobOptions = buildDefaultJobOptions({
  attempts: 5,
  priority: 10,
  backoffDelay: 30_000,
  removeOnComplete: { age: 48 * 3600, count: 1000 },
  removeOnFail: { age: 14 * 24 * 3600, count: 5000 },
});

let queueInstance = null;

function getMirrorSnapshotCleanupQueue() {
  if (!queueInstance) {
    queueInstance = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions,
    });
  }

  return queueInstance;
}

export const mirrorSnapshotCleanupQueue = createLazyQueueProxy(
  getMirrorSnapshotCleanupQueue,
);

export async function enqueueMirrorSnapshotCleanupJob(data, options = {}) {
  if (!data?.shop || !data?.mirrorBatchId) {
    throw new Error("mirror snapshot cleanup job requires shop and mirrorBatchId");
  }

  const jobId =
    options.jobId ||
    `mirror-snapshot-cleanup:${data.shop}:${data.mirrorBatchId}`;

  return getMirrorSnapshotCleanupQueue().add(
    "mirror-snapshot-cleanup",
    data,
    mergeJobOptions(defaultJobOptions, {
      ...options,
      jobId,
    }),
  );
}

export { getMirrorSnapshotCleanupQueue };
