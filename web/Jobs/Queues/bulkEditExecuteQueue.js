import { createQueue } from "./createQueue.js";
import { WRITE_JOB_OPTIONS } from "../jobOptions.js";

export const BULK_EDIT_EXECUTE_JOB_OPTIONS = {
  ...WRITE_JOB_OPTIONS,
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 15_000,
  },
};

export const bulkEditExecuteQueue = createQueue(
  "bulk.edit.execute",
  BULK_EDIT_EXECUTE_JOB_OPTIONS,
);

export function addBulkEditExecuteJob({ shop, operationId }) {
  return bulkEditExecuteQueue.add(
    "bulk.edit.execute",
    { shop, operationId },
    {
      jobId: `bulk:execute:${shop}:${operationId}`,
      priority: 3,
    },
  );
}
