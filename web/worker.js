import dotenv from "dotenv";
dotenv.config();

import prisma from "./Config/database.js";
import { connection as redis } from "./Config/redis.js";
import logger from "./utils/loggerUtils.js";

import bulkEditWorker from "./Jobs/Workers/bulkEditWorker.js";
import bulkExportWorker from "./Jobs/Workers/bulkExportWorker.js";
import bulkUndoWorker from "./Jobs/Workers/bulkUndoWorker.js";
import bulkOperationMutationWorker from "./Jobs/Workers/bulkOperationMutationWorker.js";
import { bulkOperationQueryWorker } from "./Jobs/Workers/bulkOperationQueryWorker.js";
import appInstallationWorker from "./Jobs/Workers/appInstallationWorker.js";
import scheduledEditWorker from "./Jobs/Workers/scheduledEditWorker.js";
import appUninstallWorker from "./Jobs/Workers/appUninstallWorker.js";
import bulkImportEditWorker from "./Jobs/Workers/bulkImportEditWorker.js";
import shopSyncWorker from "./Jobs/Workers/shopSyncWorker.js";
import recurringEditExecutionWorker from "./workers/recurringEditExecutionWorker.js";
import recurringEditSchedulerWorker from "./workers/recurringEditSchedulerWorker.js";
import scheduledExportExecutionWorker from "./workers/scheduledExportExecutionWorker.js";
import scheduledExportSchedulerWorker from "./workers/scheduledExportSchedulerWorker.js";
import automaticProductRuleExecutionWorker from "./workers/automaticProductRuleExecutionWorker.js";
import automaticProductRuleSchedulerWorker from "./workers/automaticProductRuleSchedulerWorker.js";
import automaticProductRuleSignalWorker from "./workers/automaticProductRuleSignalWorker.js";
import bulkEditJobOutboxWorker from "./workers/bulkEditJobOutboxWorker.js";

const workers = [
  bulkEditWorker,
  bulkExportWorker,
  bulkUndoWorker,
  bulkOperationMutationWorker,
  bulkOperationQueryWorker,
  appInstallationWorker,
  scheduledEditWorker,
  appUninstallWorker,
  bulkImportEditWorker,
  shopSyncWorker,
  recurringEditExecutionWorker,
  recurringEditSchedulerWorker,
  scheduledExportExecutionWorker,
  scheduledExportSchedulerWorker,
  automaticProductRuleExecutionWorker,
  automaticProductRuleSchedulerWorker,
  automaticProductRuleSignalWorker,
].filter(Boolean);

logger.info("Worker process started", {
  pid: process.pid,
  workerCount: workers.length,
});

let shutdownStarted = false;
async function gracefulShutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;

  logger.info("Worker shutdown started", { signal });
  await Promise.allSettled([
    ...workers.map((worker) => worker.close?.()),
    bulkEditJobOutboxWorker.close?.(),
  ]);
  await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
  logger.info("Worker shutdown completed", { signal });
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
