import { drainBulkEditJobOutbox } from "../services/bulkEditJobOutboxService.js";
import logger from "../utils/loggerUtils.js";

const POLL_INTERVAL_MS = Number(process.env.BULK_EDIT_OUTBOX_POLL_MS || 15_000);

async function runOutboxTick() {
  try {
    const result = await drainBulkEditJobOutbox();
    if (result.dispatched > 0) {
      logger.info("Bulk edit outbox dispatched jobs", result);
    }
  } catch (error) {
    logger.error("Bulk edit outbox tick failed", {
      message: error.message,
    });
  }
}

const interval = setInterval(runOutboxTick, POLL_INTERVAL_MS);
void runOutboxTick();

export default {
  pollIntervalMs: POLL_INTERVAL_MS,
  close() {
    clearInterval(interval);
  },
};
