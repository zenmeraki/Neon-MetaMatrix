import { createQueue } from "./createQueue.js";
import { DEFAULT_JOB_OPTIONS } from "../jobOptions.js";

export const SYNC_CATALOG_INGEST_JOB_OPTIONS = {
  ...DEFAULT_JOB_OPTIONS,
  attempts: 5,
  backoff: {
    type: "exponential",
    delay: 30_000,
  },
};

export const syncCatalogIngestQueue = createQueue(
  "sync.catalog.ingest",
  SYNC_CATALOG_INGEST_JOB_OPTIONS,
);

export function addSyncCatalogIngestJob({ shop, syncRunId, bulkOperationId, url }) {
  return syncCatalogIngestQueue.add(
    "sync.catalog.ingest",
    { shop, syncRunId, bulkOperationId, url },
    {
      jobId: `sync:ingest:${shop}:${syncRunId}`,
      priority: 5,
    },
  );
}
