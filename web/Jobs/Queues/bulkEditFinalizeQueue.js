import { createQueue } from "./createQueue.js";
import { WRITE_JOB_OPTIONS } from "../jobOptions.js";

export const BULK_EDIT_FINALIZE_JOB_OPTIONS = {
  ...WRITE_JOB_OPTIONS,
  attempts: 5,
  backoff: {
    type: "exponential",
    delay: 10_000,
  },
};

export const bulkEditFinalizeQueue = createQueue(
  "bulk.edit.finalize",
  BULK_EDIT_FINALIZE_JOB_OPTIONS,
);

export function addBulkEditFinalizeJob({ shop, operationId }) {
  return bulkEditFinalizeQueue.add(
    "bulk.edit.finalize",
    { shop, operationId },
    {
      jobId: `bulk:finalize:${shop}:${operationId}`,
      priority: 2,
    },
  );
}
