import { createWorker } from "./createWorker.js";
import { WORKER_CONCURRENCY } from "../workerConcurrency.js";
import { requireJobData } from "../../utils/jobPayloadValidation.js";
import { replayRollbackArtifact } from "../../services/execution/rollbackRecoveryService.js";

const QUEUE_NAME = process.env.ROLLBACK_RECOVERY_QUEUE || "rollback.recovery";

export const rollbackRecoveryWorker = createWorker(
  QUEUE_NAME,
  async (job) => {
    const { shop, operationId } = requireJobData(
      job,
      ["shop", "operationId"],
      "rollback recovery",
    );
    return replayRollbackArtifact({
      shop,
      operationId,
      reason: job?.data?.reason || "PARTIAL_FAILURE",
      requestedBy: job?.data?.requestedBy || "system",
    });
  },
  {
    concurrency: WORKER_CONCURRENCY.ROLLBACK_RECOVERY,
  },
);

