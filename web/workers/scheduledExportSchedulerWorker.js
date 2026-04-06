import { scheduleDueScheduledExportRuns } from "../services/scheduledExportExecutionService.js";
import logger from "../utils/loggerUtils.js";

const SCHEDULE_INTERVAL_MS = 10_000;

async function runSchedulerTick() {
  try {
    // console.log("🔥 Scheduled export tick fired");

    const result = await scheduleDueScheduledExportRuns();
    // console.log("📊 Scheduler result:", result);

    logger.info("Scheduled export scheduler tick", {
      scheduled: result?.scheduled ?? 0,
      skipped: result?.skipped ?? 0,
      scanned: result?.scanned ?? 0,
      reason: result?.reason ?? null, // ← this will show "scheduler_locked" if stuck
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error("Scheduled export scheduler tick failed", {
      error: error.message,
      stack: error.stack,
    });
  }
}

if (!globalThis.__scheduledExportSchedulerStarted) {
  globalThis.__scheduledExportSchedulerStarted = true;
  setTimeout(runSchedulerTick, 5_000);
  setInterval(runSchedulerTick, SCHEDULE_INTERVAL_MS);
}
