import { createQueue } from "./createQueue.js";
import { DEFAULT_JOB_OPTIONS } from "../jobOptions.js";

export const BULK_TARGET_FREEZE_JOB_OPTIONS = {
  ...DEFAULT_JOB_OPTIONS,
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 10_000,
  },
};

export const bulkTargetFreezeQueue = createQueue(
  "bulk.target.freeze",
  BULK_TARGET_FREEZE_JOB_OPTIONS,
);

export function addBulkTargetFreezeJob({ shop, operationId }) {
  return bulkTargetFreezeQueue.add(
    "bulk.target.freeze",
    { shop, operationId },
    {
      jobId: `bulk:freeze:${shop}:${operationId}`,
      priority: 4,
    },
  );
}
