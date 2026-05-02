import { waitForRedisReady } from "../Config/redis.js";
import {
  createScheduledExportWorker,
  closeScheduledExportWorker,
} from "./Workers/scheduledExportWorker.js";
import { startScheduledExportTicker } from "./schedulers/scheduledExportTicker.js";

const SIDE_EFFECT_WORKER_MODULES = [
  "./Workers/bulkEditWorker.js",
  "./Workers/bulkExportWorker.js",
  "./Workers/bulkUndoWorker.js",
  "./Workers/productBulkIngestionWorker.js",
  "./Workers/mirrorSnapshotCleanupWorker.js",
  "./Workers/bulkOperationMutationWorker.js",
  "./Workers/bulkOperationQueryWorker.js",
  "./Workers/appInstallationWorker.js",
  "./Workers/scheduledEditWorker.js",
  "./Workers/appUninstallWorker.js",
  "./Workers/bulkImportEditWorker.js",
  "./Workers/shopSyncWorker.js",
  "../workers/recurringEditExecutionWorker.js",
  "../workers/recurringEditSchedulerWorker.js",
  "../workers/scheduledExportExecutionWorker.js",
  "../workers/scheduledExportSchedulerWorker.js",
  "../workers/automaticProductRuleExecutionWorker.js",
  "../workers/automaticProductRuleSchedulerWorker.js",
  "../workers/automaticProductRuleSignalWorker.js",
];

let backgroundJobsStarted = false;
let scheduledExportTicker = null;

async function importSideEffectWorkers() {
  for (const modulePath of SIDE_EFFECT_WORKER_MODULES) {
    await import(modulePath);
  }
}

export async function bootstrapBackgroundJobs() {
  if (backgroundJobsStarted) {
    return;
  }

  await waitForRedisReady();
  await importSideEffectWorkers();
  createScheduledExportWorker();
  scheduledExportTicker = startScheduledExportTicker();
  backgroundJobsStarted = true;
}

export async function shutdownBackgroundJobs() {
  scheduledExportTicker?.stop?.();
  scheduledExportTicker = null;

  await Promise.allSettled([
    closeScheduledExportWorker(),
  ]);

  backgroundJobsStarted = false;
}
