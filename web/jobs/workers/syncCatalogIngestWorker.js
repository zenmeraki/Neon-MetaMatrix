import { syncCatalogFinalizeQueue } from "../queues/syncCatalogFinalizeQueue.js";
import { createWorker } from "./createWorker.js";
import { WORKER_CONCURRENCY } from "../workerConcurrency.js";
import { catalogIngestionService } from "../../services/catalogIngestionService.js";
import { storeExecutionLockService } from "../../services/execution/storeExecutionLockService.js";
import { requireJobData } from "../../utils/jobPayloadValidation.js";
import { assertShopMatch } from "../../utils/assertShopMatch.js";
import { getSession } from "../../utils/sessionHandler.js";

export const syncCatalogIngestWorker = createWorker(
  "sync.catalog.ingest",
  async (job) => {
    const { shop, syncRunId, bulkOperationId, url } = requireJobData(
      job,
      ["shop", "syncRunId", "bulkOperationId", "url"],
      "sync catalog ingest",
    );
    const session = await getSession(shop);
    assertShopMatch({
      jobShop: shop,
      dbShop: session?.shop,
      context: "sync_catalog_ingest_session",
      jobId: job?.id || null,
      entityType: "syncRun",
      entityId: syncRunId,
    });

    const result = await storeExecutionLockService.withSyncLock(
      { shop, syncRunId },
      async () =>
        catalogIngestionService.streamJsonlIntoMirror({
          shop,
          syncRunId,
          bulkOperationId,
          url,
          chunkSize: 2_000,
        }),
    );

    if (result?.skipped) return result;

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
