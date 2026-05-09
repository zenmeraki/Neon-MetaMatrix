import { createQueue } from "./createQueue.js";
import { DEFAULT_JOB_OPTIONS } from "../jobOptions.js";

export const SYNC_CATALOG_FINALIZE_JOB_OPTIONS = {
  ...DEFAULT_JOB_OPTIONS,
  attempts: 2,
  backoff: {
    type: "exponential",
    delay: 15_000,
  },
};

export const syncCatalogFinalizeQueue = createQueue(
  "sync.catalog.finalize",
  SYNC_CATALOG_FINALIZE_JOB_OPTIONS,
);

export function addSyncCatalogFinalizeJob({ shop, syncRunId }) {
  return syncCatalogFinalizeQueue.add(
    "sync.catalog.finalize",
    { shop, syncRunId },
    {
      jobId: `sync:finalize:${shop}:${syncRunId}`,
      priority: 5,
    },
  );
}
