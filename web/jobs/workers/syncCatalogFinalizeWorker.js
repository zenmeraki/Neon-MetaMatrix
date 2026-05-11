import { createWorker } from "./createWorker.js";
import { catalogSyncService } from "../../services/catalogSyncService.js";
import { storeExecutionLockService } from "../../services/execution/storeExecutionLockService.js";
import { requireJobData } from "../../utils/jobPayloadValidation.js";
import { assertShopMatch } from "../../utils/assertShopMatch.js";
import { getSession } from "../../utils/sessionHandler.js";
import { enqueueAutomationAfterSync } from "../../services/automation/automationEnqueueService.js";

export const syncCatalogFinalizeWorker = createWorker(
  "sync.catalog.finalize",
  async (job) => {
    const { shop, syncRunId } = requireJobData(
      job,
      ["shop", "syncRunId"],
      "sync catalog finalize",
    );

    const session = await getSession(shop);

    assertShopMatch({
      jobShop: shop,
      dbShop: session?.shop,
      context: "sync_catalog_finalize_session",
      jobId: job?.id || null,
      entityType: "syncRun",
      entityId: syncRunId,
    });

    const activationResult =
      await storeExecutionLockService.withSnapshotActivationLock(
        { shop, syncRunId },
        async () => {
          return catalogSyncService.validateAndActivateSnapshot({
            shop,
            syncRunId,
          });
        },
      );

    if (!activationResult?.activated) {
      return;
    }

    await enqueueAutomationAfterSync({
      shop,
      mirrorBatchId: syncRunId,
    });
  },
  {
    concurrency: 1,
  },
);
