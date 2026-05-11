import { scheduleDueScheduledExportRuns } from "../../services/scheduledExportExecutionService.js";
import logger from "../../utils/loggerUtils.js";

const SCHEDULE_INTERVAL_MS = Number(
  process.env.SCHEDULED_EXPORT_SCHEDULER_INTERVAL_MS || 10_000,
);

const START_DELAY_MS = Number(
  process.env.SCHEDULED_EXPORT_SCHEDULER_START_DELAY_MS || 5_000,
);

let started = false;
let stopped = false;
let timer = null;
let running = false;

async function runSchedulerTick() {
  if (running) {
    logger.warn("Scheduled export scheduler tick skipped because previous tick is still running");
    return;
  }

  running = true;

  try {
    const result = await scheduleDueScheduledExportRuns();

    logger.info("Scheduled export scheduler tick completed", {
      scheduled: result?.scheduled ?? 0,
      skipped: result?.skipped ?? 0,
      scanned: result?.scanned ?? 0,
      reason: result?.reason ?? null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Scheduled export scheduler tick failed", {
      error: error.message,
      stack: error.stack,
    });
  } finally {
    running = false;
  }
}

function scheduleNextTick(delay = SCHEDULE_INTERVAL_MS) {
  if (stopped) return;

  timer = setTimeout(async () => {
    await runSchedulerTick();
    scheduleNextTick();
  }, delay);

  timer.unref?.();
}

export function startScheduledExportScheduler() {
  if (started) return;

  started = true;
  stopped = false;

  logger.info("Scheduled export scheduler started", {
    intervalMs: SCHEDULE_INTERVAL_MS,
    startDelayMs: START_DELAY_MS,
  });

  scheduleNextTick(START_DELAY_MS);
}

export function stopScheduledExportScheduler() {
  stopped = true;

  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  logger.info("Scheduled export scheduler stopped");
}

if (String(process.env.DISABLE_SCHEDULED_EXPORT_SCHEDULER || "") !== "true") {
  startScheduledExportScheduler();
}
