import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import logger from "../../utils/loggerUtils.js";
import { logWorkerError } from "../../utils/errorLogUtils.js";
import { getJobAttempt } from "../../utils/workerTelemetry.js";
import { mirrorSnapshotCleanupService } from "../../services/sync/mirrorSnapshotCleanupService.js";

const QUEUE_NAME =
  process.env.MIRROR_SNAPSHOT_CLEANUP_QUEUE || "mirror-snapshot-cleanup";
const WORKER_NAME = "mirrorSnapshotCleanupWorker";

export const mirrorSnapshotCleanupWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { shop, mirrorBatchId, replacedByBatchId = null } = job.data || {};

    if (!shop || !mirrorBatchId) {
      throw new Error("mirror snapshot cleanup job requires shop and mirrorBatchId");
    }

    return mirrorSnapshotCleanupService.cleanupMirrorBatch({
      shop,
      mirrorBatchId,
      replacedByBatchId,
    });
  },
  {
    connection,
    concurrency: Number(process.env.MIRROR_SNAPSHOT_CLEANUP_CONCURRENCY || 1),
    lockDuration: 300_000,
    stalledInterval: 60_000,
    maxStalledCount: 1,
  },
);

mirrorSnapshotCleanupWorker.on("completed", (job, result) => {
  logger.info("Mirror snapshot cleanup completed", {
    worker: WORKER_NAME,
    queue: QUEUE_NAME,
    jobId: job?.id,
    shop: job?.data?.shop,
    mirrorBatchId: job?.data?.mirrorBatchId,
    result,
  });
});

mirrorSnapshotCleanupWorker.on("failed", async (job, error) => {
  logger.error("Mirror snapshot cleanup failed", {
    worker: WORKER_NAME,
    queue: QUEUE_NAME,
    jobId: job?.id,
    shop: job?.data?.shop,
    mirrorBatchId: job?.data?.mirrorBatchId,
    attempt: getJobAttempt(job),
    message: error.message,
  });

  await logWorkerError({
    shop: job?.data?.shop,
    err: error,
    source: WORKER_NAME,
    metadata: {
      queue: QUEUE_NAME,
      worker: WORKER_NAME,
      jobId: job?.id,
      mirrorBatchId: job?.data?.mirrorBatchId,
    },
  }).catch(() => {});
});

mirrorSnapshotCleanupWorker.on("error", (error) => {
  logger.error("Mirror snapshot cleanup worker error", {
    worker: WORKER_NAME,
    queue: QUEUE_NAME,
    message: error.message,
  });
});
