import { createQueue } from "./createQueue.js";

const QUEUE_NAME =
  process.env.ROLLBACK_ARTIFACT_CLEANUP_QUEUE || "rollback.artifact.cleanup";

export const rollbackArtifactCleanupQueue = createQueue(QUEUE_NAME, {
  attempts: 2,
  removeOnComplete: { age: 24 * 3600, count: 200 },
  removeOnFail: { age: 7 * 24 * 3600, count: 500 },
});

export function addRollbackArtifactCleanupJob(data = {}, options = {}) {
  const minuteBucket = Math.floor(Date.now() / 60000);
  const jobId = options.jobId || `rollback-artifact-cleanup:${minuteBucket}`;
  return rollbackArtifactCleanupQueue.add(
    "rollback.artifact.cleanup",
    data,
    {
      ...options,
      jobId,
    },
  );
}

