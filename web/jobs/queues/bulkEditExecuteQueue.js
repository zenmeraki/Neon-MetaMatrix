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

function safeJobPart(value) {
  return String(value).replace(/[^a-zA-Z0-9:_-]/g, "_");
}

export function addBulkEditExecuteJob({ shop, operationId, executionId }) {
  if (!shop || !operationId || !executionId) {
    throw new Error(
      "bulk edit execute job requires shop, operationId, and executionId",
    );
  }

  return bulkEditExecuteQueue.add(
    "bulk.edit.execute",
    { shop, operationId, executionId },
    {
      jobId: `bulk:execute:${safeJobPart(shop)}:${safeJobPart(operationId)}`,
      priority: 3,
    },
  );
}
