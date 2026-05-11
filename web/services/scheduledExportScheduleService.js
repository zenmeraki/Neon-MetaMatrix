import {
  RECURRING_SCHEDULE_TYPES,
  computeNextRecurringRunAt,
  normalizeTimeString,
  normalizeWeekdays,
} from "../modules/recurringEdits/recurringScheduleUtils.js";
import { assertValidTimezone } from "../utils/timezoneUtils.js";

const ALLOWED_EXPORT_SCHEDULE_TYPES = new Set([
  RECURRING_SCHEDULE_TYPES.ONE_TIME,
  RECURRING_SCHEDULE_TYPES.DAILY,
  RECURRING_SCHEDULE_TYPES.WEEKLY,
  RECURRING_SCHEDULE_TYPES.MONTHLY,
  RECURRING_SCHEDULE_TYPES.EVERY_X_MINUTES,
]);

function parseNullableDate(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return parsed;
}

function normalizeScheduleType(rawValue, fallback = null) {
  if (!rawValue && fallback) {
    return String(fallback).toUpperCase();
  }

  const value = String(rawValue || "").trim();
  if (!value) {
    throw new Error("scheduleType is required");
  }

  const upper = value.toUpperCase();
  if (ALLOWED_EXPORT_SCHEDULE_TYPES.has(upper)) {
    return upper;
  }

  switch (value.toLowerCase()) {
    case "one_time":
    case "one-time":
    case "once":
      return RECURRING_SCHEDULE_TYPES.ONE_TIME;
    case "daily":
      return RECURRING_SCHEDULE_TYPES.DAILY;
    case "weekly":
      return RECURRING_SCHEDULE_TYPES.WEEKLY;
    case "monthly":
      return RECURRING_SCHEDULE_TYPES.MONTHLY;
    case "hourly":
    case "every 2 hours":
      return RECURRING_SCHEDULE_TYPES.EVERY_X_MINUTES;
    default:
      throw new Error("UNSUPPORTED_SCHEDULED_EXPORT_SCHEDULE_TYPE");
  }
}

function normalizeIntervalMinutes(rawValue, scheduleType, existingValue) {
  if (scheduleType !== RECURRING_SCHEDULE_TYPES.EVERY_X_MINUTES) {
    return null;
  }

  const value = rawValue ?? existingValue;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("intervalMinutes must be an integer greater than 0");
  }

  return parsed;
}

function buildScheduleConfig({
  scheduleType,
  input,
  existing = {},
  intervalMinutes,
}) {
  const existingConfig =
    existing && typeof existing.scheduleConfig === "object"
      ? existing.scheduleConfig
      : {};
  const providedConfig =
    input && typeof input.scheduleConfig === "object" ? input.scheduleConfig : {};

  switch (scheduleType) {
    case RECURRING_SCHEDULE_TYPES.ONE_TIME: {
      const runAt =
        input.scheduledAt ?? providedConfig.runAt ?? existingConfig.runAt;
      const parsedRunAt = parseNullableDate(runAt, "scheduledAt");
      if (!parsedRunAt) throw new Error("scheduledAt is required");
      return { runAt: parsedRunAt.toISOString() };
    }
    case RECURRING_SCHEDULE_TYPES.DAILY: {
      const time = input.timeToRun ?? providedConfig.time ?? existingConfig.time;
      return { time: normalizeTimeString(time) };
    }
    case RECURRING_SCHEDULE_TYPES.WEEKLY: {
      const time = input.timeToRun ?? providedConfig.time ?? existingConfig.time;
      const weekdays =
        input.daysOfWeekToRun ?? providedConfig.weekdays ?? existingConfig.weekdays;
      const normalizedWeekdays = normalizeWeekdays(weekdays);
      if (!normalizedWeekdays.length) {
        throw new Error("Weekly schedules require at least one weekday");
      }
      return { time: normalizeTimeString(time), weekdays: normalizedWeekdays };
    }
    case RECURRING_SCHEDULE_TYPES.MONTHLY: {
      const time = input.timeToRun ?? providedConfig.time ?? existingConfig.time;
      const dayOfMonthRaw =
        input.dayOfMonthToRun ?? providedConfig.dayOfMonth ?? existingConfig.dayOfMonth;
      const dayOfMonth = Number.parseInt(dayOfMonthRaw, 10);
      if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
        throw new Error("Monthly schedules require dayOfMonth between 1 and 31");
      }
      return { time: normalizeTimeString(time), dayOfMonth };
    }
    case RECURRING_SCHEDULE_TYPES.EVERY_X_MINUTES:
      return { intervalMinutes };
    default:
      throw new Error("UNSUPPORTED_SCHEDULED_EXPORT_SCHEDULE_TYPE");
  }
}

export function buildScheduledExportScheduleInput(input = {}, existing = null) {
  const isCreate = !existing;
  const fallbackScheduleType = isCreate
    ? RECURRING_SCHEDULE_TYPES.ONE_TIME
    : existing?.scheduleType ?? null;
  const scheduleType = normalizeScheduleType(
    input.scheduleType ?? input.frequency,
    fallbackScheduleType,
  );

  if (!ALLOWED_EXPORT_SCHEDULE_TYPES.has(scheduleType)) {
    throw new Error("UNSUPPORTED_SCHEDULED_EXPORT_SCHEDULE_TYPE");
  }

  const rawTimezone = input.timezone ?? existing?.timezone ?? null;
  if (!rawTimezone && isCreate) {
    throw new Error("TIMEZONE_REQUIRED");
  }
  const timezone = assertValidTimezone(rawTimezone || "UTC");

  const startAt = parseNullableDate(input.startAt ?? existing?.startAt, "startAt");
  const endAt = parseNullableDate(input.endAt ?? existing?.endAt, "endAt");
  if (startAt && endAt && startAt >= endAt) {
    throw new Error("endAt must be greater than startAt");
  }

  const legacyFrequency = String(input.frequency || "").trim().toLowerCase();
  const intervalMinutes = normalizeIntervalMinutes(
    input.intervalMinutes ??
      (legacyFrequency === "hourly" ? 60 : legacyFrequency === "every 2 hours" ? 120 : undefined),
    scheduleType,
    existing?.intervalMinutes ?? null,
  );

  const scheduleConfig = buildScheduleConfig({
    scheduleType,
    input,
    existing,
    intervalMinutes,
  });

  return {
    scheduleType,
    timezone,
    scheduleConfig,
    cronExpression: null,
    intervalMinutes,
    startAt,
    endAt,
  };
}

export function computeScheduledExportNextRunAt(exportRecord, fromDate) {
  if (!fromDate) {
    throw new Error("fromDate is required");
  }
  return computeNextRecurringRunAt(exportRecord, fromDate);
}

