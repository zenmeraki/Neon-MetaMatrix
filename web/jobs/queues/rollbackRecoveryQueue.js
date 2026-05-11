import { createQueue } from "./createQueue.js";

const QUEUE_NAME = process.env.ROLLBACK_RECOVERY_QUEUE || "rollback.recovery";

export const rollbackRecoveryQueue = createQueue(QUEUE_NAME, {
  attempts: 3,
  removeOnComplete: { age: 3 * 24 * 3600, count: 2000 },
  removeOnFail: { age: 7 * 24 * 3600, count: 4000 },
});

export function addRollbackRecoveryJob(data, options = {}) {
  const jobId =
    options.jobId ||
    `rollback-recovery:${data?.shop || "unknown"}:${data?.operationId || "unknown"}`;
  return rollbackRecoveryQueue.add("rollback.recovery", data, {
    ...options,
    jobId,
  });
}

