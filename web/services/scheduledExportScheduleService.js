import {
  buildRecurringScheduleInput,
  computeRecurringEditNextRunAt,
} from "./recurringEditScheduleService.js";

export function buildScheduledExportScheduleInput(input = {}, existing = null) {
  return buildRecurringScheduleInput(
    {
      ...input,
      scheduleType:
        input.scheduleType ??
        existing?.scheduleType ??
        "ONE_TIME",
      timezone:
        input.timezone ??
        existing?.timezone ??
        "UTC",
    },
    existing,
  );
}

export function computeScheduledExportNextRunAt(exportRecord, fromDate = new Date()) {
  return computeRecurringEditNextRunAt(exportRecord, fromDate);
}
