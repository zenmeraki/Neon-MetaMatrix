import { UnrecoverableError } from "bullmq";
import { createWorker } from "./createWorker.js";
import { WORKER_CONCURRENCY } from "../workerConcurrency.js";
import { catalogSyncService } from "../../services/catalogSyncService.js";
import { storeExecutionLockService } from "../../services/execution/storeExecutionLockService.js";

export const syncCatalogStartWorker = createWorker(
  "sync.catalog.start",
  async (job) => {
    const { shop, syncRunId } = job.data;

    try {
      await storeExecutionLockService.withSyncLock({ shop, syncRunId }, async () => {
        await catalogSyncService.startShopifyBulkOperation({
          shop,
          syncRunId,
        });
      });
    } catch (error) {
      if (error.code === "SHOPIFY_BULK_ALREADY_RUNNING") {
        throw new UnrecoverableError(error.message);
      }

      throw error;
    }
  },
  {
    concurrency: WORKER_CONCURRENCY.SYNC_START,
  },
);
