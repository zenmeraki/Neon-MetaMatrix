import logger from "../../utils/loggerUtils.js";
import { scheduleDueAutomaticProductRuleRuns } from "../../services/automaticProductRuleExecutionService.js";

const POLL_INTERVAL_MS = 60_000;

async function runSchedulerTick() {
  try {
    const result = await scheduleDueAutomaticProductRuleRuns();
    if (result?.scheduled || result?.skipped) {
      logger.info("Automatic product rule scheduler tick completed", result);
    }
  } catch (error) {
    logger.error("Automatic product rule scheduler tick failed", {
      error: error.message,
      stack: error.stack,
    });
  }
}

if (!globalThis.__automaticProductRuleSchedulerStarted) {
  globalThis.__automaticProductRuleSchedulerStarted = true;
  setInterval(runSchedulerTick, POLL_INTERVAL_MS);
  setTimeout(runSchedulerTick, 5_000);
}

export default { pollIntervalMs: POLL_INTERVAL_MS };
