import { createQueue } from "./createQueue.js";
import { DEFAULT_JOB_OPTIONS } from "../jobOptions.js";

export const SYNC_CATALOG_START_JOB_OPTIONS = {
  ...DEFAULT_JOB_OPTIONS,
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 10_000,
  },
};

export const syncCatalogStartQueue = createQueue(
  "sync.catalog.start",
  SYNC_CATALOG_START_JOB_OPTIONS,
);

export function addSyncCatalogStartJob({ shop, syncRunId }) {
  return syncCatalogStartQueue.add(
    "sync.catalog.start",
    { shop, syncRunId },
    {
      jobId: `sync:start:${shop}:${syncRunId}`,
      priority: 5,
    },
  );
}
