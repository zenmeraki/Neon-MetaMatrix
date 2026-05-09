import { assertValidTimezone } from "../utils/timezoneUtils.js";
import {
  computeNextAutomaticRuleRunAt,
  normalizeTimeString,
  normalizeWeekdays,
} from "../modules/automaticProductRules/automaticRuleScheduleUtils.js";

function parseNullableDate(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${fieldName}`);
  }

  return parsed;
}

export function parseAutomaticProductRuleDate(value, fieldName) {
  return parseNullableDate(value, fieldName);
}

function normalizeScheduleType(rawValue, fallback = null) {
  if ((rawValue === undefined || rawValue === null || rawValue === "") && fallback) {
    return fallback;
  }

  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return null;
  }

  const value = String(rawValue).trim().toUpperCase();
  if (!["CRON", "DAILY", "WEEKLY", "MONTHLY", "EVERY_X_MINUTES"].includes(value)) {
    throw new Error("Unsupported scheduleType");
  }

  return value;
}

function normalizeIntervalMinutes(rawValue, scheduleType, existingValue) {
  if (scheduleType !== "EVERY_X_MINUTES") {
    return null;
  }

  const parsed = Number.parseInt(rawValue ?? existingValue, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("intervalMinutes must be an integer greater than 0");
  }

  return parsed;
}

function buildScheduleConfig({ scheduleType, input, existing, intervalMinutes }) {
  const existingConfig = existing?.scheduleConfig && typeof existing.scheduleConfig === "object"
    ? existing.scheduleConfig
    : {};
  const providedConfig = input?.scheduleConfig && typeof input.scheduleConfig === "object"
    ? input.scheduleConfig
    : {};

  switch (scheduleType) {
    case "DAILY":
      return {
        time: normalizeTimeString(input.timeToRun ?? providedConfig.time ?? existingConfig.time),
      };
    case "WEEKLY": {
      const weekdays = normalizeWeekdays(
        input.daysOfWeekToRun ?? providedConfig.weekdays ?? existingConfig.weekdays ?? [],
      );
      if (!weekdays.length) {
        throw new Error("Weekly schedules require at least one weekday");
      }

      return {
        time: normalizeTimeString(input.timeToRun ?? providedConfig.time ?? existingConfig.time),
        weekdays,
      };
    }
    case "MONTHLY": {
      const dayOfMonth = Number.parseInt(
        input.dayOfMonthToRun ?? providedConfig.dayOfMonth ?? existingConfig.dayOfMonth,
        10,
      );

      if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
        throw new Error("Monthly schedules require dayOfMonth between 1 and 31");
      }

      return {
        time: normalizeTimeString(input.timeToRun ?? providedConfig.time ?? existingConfig.time),
        dayOfMonth,
      };
    }
    case "EVERY_X_MINUTES":
      return { intervalMinutes };
    case "CRON":
      return { timezoneAware: true };
    default:
      return null;
  }
}

export function buildAutomaticProductRuleScheduleInput(input = {}, existing = null) {
  const scheduleType = normalizeScheduleType(input.scheduleType, existing?.scheduleType ?? null);

  if (!scheduleType) {
    return {
      scheduleType: null,
      timezone: null,
      scheduleConfig: null,
      cronExpression: null,
      intervalMinutes: null,
      startAt: parseNullableDate(input.startAt ?? existing?.startAt, "startAt"),
      endAt: parseNullableDate(input.endAt ?? existing?.endAt, "endAt"),
    };
  }

  const timezone = assertValidTimezone(input.timezone ?? existing?.timezone);
  const startAt = parseNullableDate(input.startAt ?? existing?.startAt, "startAt");
  const endAt = parseNullableDate(input.endAt ?? existing?.endAt, "endAt");

  if (startAt && endAt && startAt >= endAt) {
    throw new Error("endAt must be greater than startAt");
  }

  const intervalMinutes = normalizeIntervalMinutes(
    input.intervalMinutes,
    scheduleType,
    existing?.intervalMinutes ?? null,
  );

  const cronExpression = scheduleType === "CRON"
    ? String(input.cronExpression ?? existing?.cronExpression ?? "").trim()
    : null;

  if (scheduleType === "CRON" && !cronExpression) {
    throw new Error("cronExpression is required for CRON schedules");
  }

  return {
    scheduleType,
    timezone,
    scheduleConfig: buildScheduleConfig({ scheduleType, input, existing, intervalMinutes }),
    cronExpression,
    intervalMinutes,
    startAt,
    endAt,
  };
}

export function computeAutomaticProductRuleNextRunAt(rule, fromDate = new Date()) {
  if (!rule.scheduleType || !rule.timezone) {
    return null;
  }

  return computeNextAutomaticRuleRunAt(rule, fromDate);
}
