import logger from "../utils/loggerUtils.js";
import { scheduleDueRecurringEditRuns } from "../services/recurringEditExecutionService.js";

const POLL_INTERVAL_MS = 60_000;

async function runSchedulerTick() {
  try {
    const result = await scheduleDueRecurringEditRuns();
    if (result?.scheduled || result?.skipped) {
      logger.info("Recurring edit scheduler tick completed", result);
    }
  } catch (error) {
    logger.error("Recurring edit scheduler tick failed", {
      error: error.message,
      stack: error.stack,
    });
  }
}

if (!globalThis.__recurringEditSchedulerStarted) {
  globalThis.__recurringEditSchedulerStarted = true;
  setInterval(runSchedulerTick, POLL_INTERVAL_MS);
  setTimeout(runSchedulerTick, 5_000);
}

export default {
  pollIntervalMs: POLL_INTERVAL_MS,
};
