import { syncCatalogFinalizeQueue } from "../Queues/syncCatalogFinalizeQueue.js";
import { createWorker } from "./createWorker.js";
import { WORKER_CONCURRENCY } from "../workerConcurrency.js";
import { catalogIngestionService } from "../../services/catalogIngestionService.js";

export const syncCatalogIngestWorker = createWorker(
  "sync.catalog.ingest",
  async (job) => {
    const { shop, syncRunId, bulkOperationId, url } = job.data;

    const result = await catalogIngestionService.streamJsonlIntoMirror({
      shop,
      syncRunId,
      bulkOperationId,
      url,
      chunkSize: 2_000,
    });

    if (result?.skipped) {
      return result;
    }

    await syncCatalogFinalizeQueue.add(
      "sync.catalog.finalize",
      { shop, syncRunId },
      {
        jobId: `sync:finalize:${shop}:${syncRunId}`,
        priority: 5,
      },
    );
  },
  {
    concurrency: WORKER_CONCURRENCY.SYNC_INGEST,
  },
);
