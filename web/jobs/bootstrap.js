import { waitForRedisReady } from "../config/redis.js";

const SIDE_EFFECT_WORKER_MODULES = [
  "./workers/bulkEditWorker.js",
  "./workers/bulkExportWorker.js",
  "./workers/bulkUndoWorker.js",
  "./workers/bulkOperationMutationWorker.js",
  "./workers/bulkOperationQueryWorker.js",
  "./workers/appInstallationWorker.js",
  "./workers/scheduledEditWorker.js",
  "./workers/appUninstallWorker.js",
  "./workers/bulkImportEditWorker.js",
  "./workers/shopSyncWorker.js",
  "./workers/recurringEditExecutionWorker.js",
  "./workers/recurringEditSchedulerWorker.js",
  "./workers/scheduledExportExecutionWorker.js",
  "./workers/scheduledExportSchedulerWorker.js",
  "./workers/automaticProductRuleExecutionWorker.js",
  "./workers/automaticProductRuleSchedulerWorker.js",
  "./workers/automaticProductRuleSignalWorker.js",
  "./workers/staleStoreOperationRepairWorker.js",
  "./workers/operationLeaseScavengerWorker.js",
  "./workers/productTypeRefreshWorker.js",
];

let backgroundJobsStarted = false;

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
  backgroundJobsStarted = true;
}

export async function shutdownBackgroundJobs() {
  backgroundJobsStarted = false;
}
