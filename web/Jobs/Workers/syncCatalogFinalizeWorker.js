import { createWorker } from "./createWorker.js";
import { catalogSyncService } from "../../services/catalogSyncService.js";
import { storeExecutionLockService } from "../../services/execution/storeExecutionLockService.js";

export const syncCatalogFinalizeWorker = createWorker(
  "sync.catalog.finalize",
  async (job) => {
    const { shop, syncRunId } = job.data;

    await storeExecutionLockService.withSnapshotActivationLock(
      { shop, syncRunId },
      async () => {
        await catalogSyncService.validateAndActivateSnapshot({
          shop,
          syncRunId,
        });
      },
    );
  },
  {
    concurrency: 1,
  },
);
