import {
  RECURRING_SCHEDULE_TYPES,
  computeNextRecurringRunAt,
  normalizeTimeString,
  normalizeWeekdays,
} from "../modules/recurringEdits/recurringScheduleUtils.js";
import crypto from "crypto";
import parser from "cron-parser";
import { assertValidTimezone } from "../utils/timezoneUtils.js";
import { stableCanonicalStringify } from "../utils/stableCanonicalStringify.js";

const SCHEDULE_ENGINE_VERSION = "recurring_schedule_engine.v2";
const MIN_SCHEDULE_LEAD_SECONDS = Number(
  process.env.MIN_RECURRING_SCHEDULE_LEAD_SECONDS || 60,
);
const MIN_SCHEDULE_LEAD_MS = MIN_SCHEDULE_LEAD_SECONDS * 1000;
const MIN_INTERVAL_MINUTES = Number(
  process.env.MIN_RECURRING_INTERVAL_MINUTES || 5,
);
const MIN_CRON_INTERVAL_MINUTES = Number(
  process.env.MIN_RECURRING_EDIT_CRON_INTERVAL_MINUTES ||
    process.env.MIN_RECURRING_CRON_INTERVAL_MINUTES ||
    5,
);
const MIN_CRON_INTERVAL_MS = MIN_CRON_INTERVAL_MINUTES * 60 * 1000;
const MAX_SCHEDULE_FUTURE_DAYS = Math.max(
  Number(process.env.MAX_RECURRING_SCHEDULE_FUTURE_DAYS || 730),
  1,
);
const MAX_SCHEDULE_FUTURE_MS = MAX_SCHEDULE_FUTURE_DAYS * 24 * 60 * 60 * 1000;
const MAX_INTERVAL_MINUTES = Number(
  process.env.MAX_RECURRING_INTERVAL_MINUTES || 60 * 24 * 30,
);
const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_WITH_TZ_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function createDomainError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function fingerprintSchedule(value) {
  return crypto
    .createHash("sha256")
    .update(stableCanonicalStringify(value))
    .digest("hex");
}

function assertValidDate(value, fieldName) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createDomainError("INVALID_SCHEDULE_DATE", `Invalid ${fieldName}`);
  }
  return date;
}

function parseNullableDate(value, fieldName) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  if (value instanceof Date) {
    return assertValidDate(value, fieldName);
  }

  if (typeof value !== "string") {
    throw createDomainError("INVALID_SCHEDULE_DATE", `Invalid ${fieldName}`);
  }

  const normalized = value.trim();
  if (ISO_DATE_ONLY_RE.test(normalized)) {
    return assertValidDate(`${normalized}T00:00:00.000Z`, fieldName);
  }

  if (!ISO_DATE_TIME_WITH_TZ_RE.test(normalized)) {
    throw createDomainError(
      "INVALID_SCHEDULE_DATE_FORMAT",
      `Invalid ${fieldName}. Use ISO-8601 with timezone.`,
    );
  }

  return assertValidDate(normalized, fieldName);
}

function assertWithinFutureHorizon(value, fieldName, now = new Date()) {
  if (!value) return;
  const maxAllowed = now.getTime() + MAX_SCHEDULE_FUTURE_MS;
  if (value.getTime() > maxAllowed) {
    throw createDomainError(
      "SCHEDULE_DATE_TOO_FAR_IN_FUTURE",
      `${fieldName} must be within ${MAX_SCHEDULE_FUTURE_DAYS} days from now`,
    );
  }
}

function normalizeScheduleType(rawValue, fallback = null) {
  if (!rawValue && fallback) {
    return fallback;
  }

  const value = String(rawValue || "").trim();
  if (!value) {
    throw createDomainError("SCHEDULE_TYPE_REQUIRED");
  }

  const upper = value.toUpperCase();
  if (Object.values(RECURRING_SCHEDULE_TYPES).includes(upper)) {
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
    case "every hour":
    case "every_hour":
    case "1 hour":
      return RECURRING_SCHEDULE_TYPES.EVERY_X_MINUTES;
    case "2 hours":
    case "every_2_hours":
    case "every 2 hours":
      return RECURRING_SCHEDULE_TYPES.EVERY_X_MINUTES;
    case "cron":
      return RECURRING_SCHEDULE_TYPES.CRON;
    default:
      throw createDomainError("UNSUPPORTED_SCHEDULE_TYPE");
  }
}

function normalizeIntervalMinutes(rawValue, scheduleType, existingValue) {
  if (scheduleType !== RECURRING_SCHEDULE_TYPES.EVERY_X_MINUTES) {
    return null;
  }

  const value = rawValue ?? existingValue;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < MIN_INTERVAL_MINUTES) {
    throw createDomainError(
      "INVALID_INTERVAL_MINUTES",
      `intervalMinutes must be an integer greater than or equal to ${MIN_INTERVAL_MINUTES}`,
    );
  }
  if (parsed > MAX_INTERVAL_MINUTES) {
    throw createDomainError(
      "INVALID_INTERVAL_MINUTES_MAX",
      `intervalMinutes must be less than or equal to ${MAX_INTERVAL_MINUTES}`,
    );
  }

  return parsed;
}

function validateCronExpression(cronExpression, timezone) {
  let interval;
  try {
    interval = parser.parseExpression(cronExpression, {
      tz: timezone,
      currentDate: new Date("2026-01-01T00:00:00.000Z"),
    });
  } catch {
    throw createDomainError("INVALID_CRON_EXPRESSION");
  }

  const first = interval.next().toDate();
  const second = interval.next().toDate();
  if (second.getTime() - first.getTime() < MIN_CRON_INTERVAL_MS) {
    throw createDomainError(
      "CRON_INTERVAL_TOO_FREQUENT",
      `cronExpression frequency is too high. Minimum interval is ${MIN_CRON_INTERVAL_MINUTES} minutes`,
    );
  }

  return {
    normalizedCronExpression: cronExpression.trim(),
    timezone,
    minIntervalMinutes: MIN_CRON_INTERVAL_MINUTES,
  };
}

function buildScheduleConfig({
  scheduleType,
  input,
  existing = {},
  intervalMinutes,
  timezone,
  cronExpression,
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
        input.scheduledAt ??
        providedConfig.runAt ??
        existingConfig.runAt;

      const parsedRunAt = parseNullableDate(runAt, "scheduledAt");
      if (!parsedRunAt) {
        throw createDomainError("SCHEDULED_AT_REQUIRED");
      }

      return {
        runAt: parsedRunAt.toISOString(),
      };
    }

    case RECURRING_SCHEDULE_TYPES.DAILY: {
      const time =
        input.timeToRun ??
        providedConfig.time ??
        existingConfig.time;

      return {
        time: normalizeTimeString(time),
      };
    }

    case RECURRING_SCHEDULE_TYPES.WEEKLY: {
      const time =
        input.timeToRun ??
        providedConfig.time ??
        existingConfig.time;
      const weekdays =
        input.daysOfWeekToRun ??
        providedConfig.weekdays ??
        existingConfig.weekdays;

      const normalizedWeekdays = normalizeWeekdays(weekdays);
      if (!normalizedWeekdays.length) {
        throw createDomainError(
          "WEEKLY_WEEKDAYS_REQUIRED",
          "Weekly schedules require at least one weekday",
        );
      }

      return {
        time: normalizeTimeString(time),
        weekdays: Array.from(new Set(normalizedWeekdays)).sort((a, b) => a - b),
      };
    }

    case RECURRING_SCHEDULE_TYPES.MONTHLY: {
      const time =
        input.timeToRun ??
        providedConfig.time ??
        existingConfig.time;
      const dayOfMonthRaw =
        input.dayOfMonthToRun ??
        providedConfig.dayOfMonth ??
        existingConfig.dayOfMonth;
      const dayOfMonth = Number.parseInt(dayOfMonthRaw, 10);

      if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
        throw createDomainError(
          "INVALID_MONTHLY_DAY_OF_MONTH",
          "Monthly schedules require dayOfMonth between 1 and 31",
        );
      }

      return {
        time: normalizeTimeString(time),
        dayOfMonth,
      };
    }

    case RECURRING_SCHEDULE_TYPES.EVERY_X_MINUTES:
      return {
        intervalMinutes,
      };

    case RECURRING_SCHEDULE_TYPES.CRON:
      return validateCronExpression(cronExpression, timezone);

    default:
      throw createDomainError("UNSUPPORTED_SCHEDULE_TYPE");
  }
}

function canonicalizeTimezone(timezone) {
  const normalized = assertValidTimezone(timezone);
  try {
    const canonical = new Intl.DateTimeFormat("en-US", {
      timeZone: normalized,
    }).resolvedOptions().timeZone;
    return canonical || normalized;
  } catch {
    return normalized;
  }
}

function canonicalizeScheduleConfig(scheduleConfig) {
  return JSON.parse(stableCanonicalStringify(scheduleConfig || {}));
}

function assertScheduleHasFutureOccurrence({
  scheduleType,
  timezone,
  scheduleConfig,
  cronExpression,
  intervalMinutes,
  startAt,
  endAt,
  now,
}) {
  const anchor = startAt && startAt > now
    ? new Date(startAt.getTime() - 1000)
    : now;
  const nextRun = computeNextRecurringRunAt(
    {
      scheduleType,
      timezone,
      scheduleConfig,
      cronExpression,
      intervalMinutes,
      startAt,
      endAt,
    },
    anchor,
  );

  if (!nextRun) {
    throw createDomainError(
      "SCHEDULE_HAS_NO_VALID_OCCURRENCE",
      "schedule has no valid occurrence in the configured window",
    );
  }

  return nextRun;
}

export function buildRecurringScheduleInput(input = {}, existing = null) {
  const now = new Date();
  const scheduleType = normalizeScheduleType(
    input.scheduleType ?? input.frequency,
    existing?.scheduleType ?? null,
  );

  const rawTimezone = input.timezone ?? existing?.timezone;
  if (!rawTimezone) {
    throw createDomainError("TIMEZONE_REQUIRED", "timezone is required");
  }
  const timezone = canonicalizeTimezone(rawTimezone);
  const startAt = parseNullableDate(
    input.startAt ?? existing?.startAt,
    "startAt",
  );
  const endAt = parseNullableDate(
    input.endAt ?? existing?.endAt,
    "endAt",
  );
  assertWithinFutureHorizon(startAt, "startAt", now);
  assertWithinFutureHorizon(endAt, "endAt", now);

  if (startAt && endAt && startAt >= endAt) {
    throw createDomainError("INVALID_DATE_WINDOW", "endAt must be greater than startAt");
  }

  const legacyFrequency = String(input.frequency || "").trim().toLowerCase();
  const intervalMinutes = normalizeIntervalMinutes(
    input.intervalMinutes ??
      (legacyFrequency === "hourly"
        ? 60
        : legacyFrequency === "every 2 hours"
          ? 120
          : undefined),
    scheduleType,
    existing?.intervalMinutes ?? null,
  );

  const cronExpression =
    scheduleType === RECURRING_SCHEDULE_TYPES.CRON
      ? String(input.cronExpression ?? existing?.cronExpression ?? "").trim()
      : null;

  if (
    scheduleType === RECURRING_SCHEDULE_TYPES.CRON &&
    !cronExpression
  ) {
    throw createDomainError("CRON_EXPRESSION_REQUIRED", "cronExpression is required for CRON schedules");
  }

  const builtScheduleConfig = buildScheduleConfig({
    scheduleType,
    input,
    existing,
    intervalMinutes,
    timezone,
    cronExpression,
  });
  const scheduleConfig = canonicalizeScheduleConfig(builtScheduleConfig);

  if (scheduleType === RECURRING_SCHEDULE_TYPES.ONE_TIME) {
    const runAt = new Date(scheduleConfig.runAt);
    assertWithinFutureHorizon(runAt, "scheduledAt", now);
    if (startAt && runAt < startAt) {
      throw createDomainError(
        "SCHEDULED_AT_BEFORE_START_AT",
        "scheduledAt must be greater than or equal to startAt",
      );
    }
    if (endAt && runAt > endAt) {
      throw createDomainError(
        "SCHEDULED_AT_AFTER_END_AT",
        "scheduledAt must be less than or equal to endAt",
      );
    }

    const minAllowedAt = new Date(now.getTime() + MIN_SCHEDULE_LEAD_MS);
    if (runAt < minAllowedAt) {
      throw createDomainError(
        "SCHEDULE_LEAD_TIME_TOO_SHORT",
        `scheduledAt must be at least ${MIN_SCHEDULE_LEAD_SECONDS} seconds in the future`,
      );
    }
  }

  const nextOccurrence = assertScheduleHasFutureOccurrence({
    scheduleType,
    timezone,
    scheduleConfig,
    cronExpression,
    intervalMinutes,
    startAt,
    endAt,
    now,
  });
  const minLeadAt = new Date(now.getTime() + MIN_SCHEDULE_LEAD_MS);
  if (nextOccurrence < minLeadAt) {
    throw createDomainError(
      "SCHEDULE_LEAD_TIME_TOO_SHORT",
      `next schedule occurrence must be at least ${MIN_SCHEDULE_LEAD_SECONDS} seconds in the future`,
    );
  }

  const scheduleFingerprint = fingerprintSchedule({
    scheduleEngineVersion: SCHEDULE_ENGINE_VERSION,
    scheduleType,
    timezone,
    scheduleConfig,
    cronExpression,
    intervalMinutes,
    startAt: startAt?.toISOString() ?? null,
    endAt: endAt?.toISOString() ?? null,
  });

  return {
    scheduleEngineVersion: SCHEDULE_ENGINE_VERSION,
    scheduleDefinitionTimezone: timezone,
    scheduleExecutionTimezone: timezone,
    scheduleType,
    timezone,
    scheduleConfig,
    cronExpression,
    intervalMinutes,
    startAt,
    endAt,
    scheduleFingerprint,
  };
}

export function computeRecurringEditNextRunAt(edit, fromDate) {
  if (!(fromDate instanceof Date) || Number.isNaN(fromDate.getTime())) {
    throw new Error("fromDate is required");
  }
  return computeNextRecurringRunAt(edit, fromDate);
}
