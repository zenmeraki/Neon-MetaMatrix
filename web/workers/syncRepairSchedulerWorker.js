import { repairStuckSyncs } from "../services/syncRepairService.js";
import logger from "../utils/loggerUtils.js";

const SCHEDULE_INTERVAL_MS = 5 * 60 * 1000;

async function runSchedulerTick() {
  try {
    const result = await repairStuckSyncs();
    if (result?.scanned) {
      logger.info("Sync repair scheduler tick completed", result);
    }
  } catch (error) {
    logger.error("Sync repair scheduler tick failed", {
      error: error.message,
      stack: error.stack,
    });
  }
}

if (!globalThis.__syncRepairSchedulerStarted) {
  globalThis.__syncRepairSchedulerStarted = true;
  setTimeout(runSchedulerTick, 30_000);
  setInterval(runSchedulerTick, SCHEDULE_INTERVAL_MS);
}
