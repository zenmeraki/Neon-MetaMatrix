import { scheduleDueScheduledExportRuns } from "../services/scheduledExportExecutionService.js";
import logger from "../utils/loggerUtils.js";

const SCHEDULE_INTERVAL_MS = 60_000;

async function runSchedulerTick() {
  try {
    const result = await scheduleDueScheduledExportRuns();
    if (result?.scheduled) {
      logger.info("Scheduled export scheduler tick completed", result);
    }
  } catch (error) {
    logger.error("Scheduled export scheduler tick failed", {
      error: error.message,
      stack: error.stack,
    });
  }
}

setTimeout(runSchedulerTick, 5_000);
setInterval(runSchedulerTick, SCHEDULE_INTERVAL_MS);
