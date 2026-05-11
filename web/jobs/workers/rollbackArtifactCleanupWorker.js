import { createWorker } from "./createWorker.js";
import { WORKER_CONCURRENCY } from "../workerConcurrency.js";
import { cleanupExpiredRollbackArtifacts } from "../../services/execution/rollbackArtifactService.js";

const QUEUE_NAME =
  process.env.ROLLBACK_ARTIFACT_CLEANUP_QUEUE || "rollback.artifact.cleanup";

export const rollbackArtifactCleanupWorker = createWorker(
  QUEUE_NAME,
  async (job) => {
    return cleanupExpiredRollbackArtifacts({
      retentionHours: Number(
        job?.data?.retentionHours ||
          process.env.ROLLBACK_ARTIFACT_RETENTION_HOURS ||
          168,
      ),
    });
  },
  {
    concurrency: WORKER_CONCURRENCY.ROLLBACK_ARTIFACT_CLEANUP,
  },
);

