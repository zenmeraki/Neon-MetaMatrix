import { createWorker } from "./createWorker.js";
import { WORKER_CONCURRENCY } from "../workerConcurrency.js";
import { catalogSyncService } from "../../services/catalogSyncService.js";
import { storeExecutionLockService } from "../../services/execution/storeExecutionLockService.js";
import { requireJobData } from "../../utils/jobPayloadValidation.js";
import { assertShopMatch } from "../../utils/assertShopMatch.js";
import { getSession } from "../../utils/sessionHandler.js";

export const syncCatalogStartWorker = createWorker(
  "sync.catalog.start",
  async (job) => {
    const { shop, syncRunId } = requireJobData(
      job,
      ["shop", "syncRunId"],
      "sync catalog start",
    );
    const session = await getSession(shop);
    assertShopMatch({
      jobShop: shop,
      dbShop: session?.shop,
      context: "sync_catalog_start_session",
      jobId: job?.id || null,
      entityType: "syncRun",
      entityId: syncRunId,
    });

    await storeExecutionLockService.withSyncLock(
      { shop, syncRunId },
      async () => {
        await catalogSyncService.startShopifyBulkOperation({
          shop,
          syncRunId,
        });
      },
    );
  },
  {
    concurrency: WORKER_CONCURRENCY.SYNC_START,
  },
);
