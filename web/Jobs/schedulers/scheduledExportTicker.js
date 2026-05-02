import { addScheduledExportDispatchJob } from "../Queues/scheduledExportQueue.js";

let scheduledExportTickerHandle = null;
let scheduledExportTickerTimeout = null;
let scheduledExportTickInFlight = null;

function clearScheduledExportTickerTimers() {
  if (scheduledExportTickerTimeout) {
    clearTimeout(scheduledExportTickerTimeout);
    scheduledExportTickerTimeout = null;
  }

  if (scheduledExportTickerHandle) {
    clearInterval(scheduledExportTickerHandle);
    scheduledExportTickerHandle = null;
  }
}

export function startScheduledExportTicker() {
  if (scheduledExportTickerHandle || scheduledExportTickerTimeout) {
    return {
      stop: clearScheduledExportTickerTimers,
    };
  }

  const intervalMs = Number(
    process.env.SCHEDULED_EXPORT_TICK_INTERVAL_MS || 60_000,
  );
  const initialDelayMs = Math.min(
    Number(process.env.SCHEDULED_EXPORT_TICK_INITIAL_DELAY_MS || 5_000),
    intervalMs,
  );
  const jitterMs = Math.min(
    Number(process.env.SCHEDULED_EXPORT_TICK_JITTER_MS || 5_000),
    intervalMs,
  );

  const tick = async () => {
    if (scheduledExportTickInFlight) {
      return scheduledExportTickInFlight;
    }

    scheduledExportTickInFlight = (async () => {
      try {
        await addScheduledExportDispatchJob({}, {
          jobId: `scheduled-export-dispatch:${Date.now()}`,
        });
      } catch (error) {
        console.error("Failed to enqueue scheduled export dispatch tick", {
          error: error?.message,
        });
      } finally {
        scheduledExportTickInFlight = null;
      }
    })();

    try {
      await scheduledExportTickInFlight;
    } finally {
      return scheduledExportTickInFlight;
    }
  };

  scheduledExportTickerTimeout = setTimeout(() => {
    scheduledExportTickerTimeout = null;
    void tick();
    scheduledExportTickerHandle = setInterval(() => {
      void tick();
    }, intervalMs);
  }, initialDelayMs + Math.floor(Math.random() * Math.max(jitterMs, 1)));

  return {
    stop: clearScheduledExportTickerTimers,
  };
}

export function stopScheduledExportTicker() {
  clearScheduledExportTickerTimers();
}
