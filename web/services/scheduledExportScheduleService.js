import moment from "moment-timezone";
import {
  normalizeTimeString,
  normalizeWeekdays,
} from "../utils/recurringScheduleUtils.js";
import { assertValidTimezone, toTimezoneMoment } from "../utils/timezoneUtils.js";

export const SCHEDULED_EXPORT_SCHEDULE_TYPES = {
  ONE_TIME: "ONE_TIME",
  DAILY: "DAILY",
  WEEKLY: "WEEKLY",
  MONTHLY: "MONTHLY",
};

function parseNullableDate(value, fieldName) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${fieldName}`);
  }

  return parsed;
}

function normalizeScheduleType(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    throw new Error("scheduleType is required");
  }

  const upper = value.toUpperCase();
  if (Object.values(SCHEDULED_EXPORT_SCHEDULE_TYPES).includes(upper)) {
    return upper;
  }

  switch (value.toLowerCase()) {
    case "one_time":
    case "one-time":
    case "once":
      return SCHEDULED_EXPORT_SCHEDULE_TYPES.ONE_TIME;
    case "daily":
      return SCHEDULED_EXPORT_SCHEDULE_TYPES.DAILY;
    case "weekly":
      return SCHEDULED_EXPORT_SCHEDULE_TYPES.WEEKLY;
    case "monthly":
      return SCHEDULED_EXPORT_SCHEDULE_TYPES.MONTHLY;
    default:
      throw new Error("Unsupported scheduled export scheduleType");
  }
}

function normalizeInteger(value, fieldName, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${fieldName} must be an integer between ${min} and ${max}`);
  }

  return parsed;
}

function extractExistingSchedule(existing, scheduleType) {
  if (!existing || existing.scheduleType !== scheduleType) {
    return {};
  }

  return existing.scheduleConfig && typeof existing.scheduleConfig === "object"
    ? existing.scheduleConfig
    : {};
}

function getProvidedScheduleConfig(input = {}) {
  return input.scheduleConfig && typeof input.scheduleConfig === "object"
    ? input.scheduleConfig
    : {};
}

function normalizeRunAt(input, providedConfig, existingConfig) {
  const runAt =
    input.runAt ??
    input.scheduledAt ??
    providedConfig.runAt ??
    existingConfig.runAt;
  const parsed = parseNullableDate(runAt, "runAt");
  if (!parsed) {
    throw new Error("runAt is required for one-time scheduled exports");
  }

  return parsed.toISOString();
}

function normalizeScheduleTime(input, providedConfig, existingConfig) {
  return normalizeTimeString(
    input.runAt ??
      input.timeToRun ??
      providedConfig.time ??
      existingConfig.time,
  );
}

function buildScheduleConfig(scheduleInput) {
  switch (scheduleInput.scheduleType) {
    case SCHEDULED_EXPORT_SCHEDULE_TYPES.ONE_TIME:
      return {
        runAt: scheduleInput.runAt,
      };
    case SCHEDULED_EXPORT_SCHEDULE_TYPES.DAILY:
      return {
        time: scheduleInput.runAt,
      };
    case SCHEDULED_EXPORT_SCHEDULE_TYPES.WEEKLY:
      return {
        time: scheduleInput.runAt,
        weekdays: scheduleInput.daysOfWeek,
      };
    case SCHEDULED_EXPORT_SCHEDULE_TYPES.MONTHLY:
      return {
        time: scheduleInput.runAt,
        dayOfMonth: scheduleInput.dayOfMonth,
      };
    default:
      throw new Error("Unsupported scheduled export scheduleType");
  }
}

export function buildScheduledExportScheduleInputCore(input = {}) {
  const scheduleType = normalizeScheduleType(input.scheduleType);
  const timezone = assertValidTimezone(input.timezone);
  const startAt = parseNullableDate(input.startAt, "startAt");
  const endAt = parseNullableDate(input.endAt, "endAt");

  if (startAt && endAt && startAt >= endAt) {
    throw new Error("endAt must be greater than startAt");
  }

  const scheduleInput = {
    scheduleType,
    timezone,
    nextRunAt: parseNullableDate(input.nextRunAt, "nextRunAt"),
    interval: null,
    daysOfWeek: null,
    dayOfMonth: null,
    runAt: null,
    startAt,
    endAt,
  };

  switch (scheduleType) {
    case SCHEDULED_EXPORT_SCHEDULE_TYPES.ONE_TIME:
      scheduleInput.runAt = parseNullableDate(input.runAt, "runAt");
      if (!scheduleInput.runAt) {
        throw new Error("runAt is required for one-time scheduled exports");
      }
      scheduleInput.runAt = scheduleInput.runAt.toISOString();
      break;
    case SCHEDULED_EXPORT_SCHEDULE_TYPES.DAILY:
      scheduleInput.interval = 1;
      scheduleInput.runAt = normalizeTimeString(input.runAt);
      break;
    case SCHEDULED_EXPORT_SCHEDULE_TYPES.WEEKLY:
      scheduleInput.interval = 1;
      scheduleInput.runAt = normalizeTimeString(input.runAt);
      scheduleInput.daysOfWeek = normalizeWeekdays(input.daysOfWeek);
      if (!scheduleInput.daysOfWeek.length) {
        throw new Error("Weekly scheduled exports require at least one weekday");
      }
      break;
    case SCHEDULED_EXPORT_SCHEDULE_TYPES.MONTHLY:
      scheduleInput.interval = 1;
      scheduleInput.runAt = normalizeTimeString(input.runAt);
      scheduleInput.dayOfMonth = normalizeInteger(input.dayOfMonth, "dayOfMonth", {
        min: 1,
        max: 31,
      });
      break;
    default:
      throw new Error("Unsupported scheduled export scheduleType");
  }

  return {
    ...scheduleInput,
    scheduleConfig: buildScheduleConfig(scheduleInput),
    cronExpression: null,
    intervalMinutes: null,
  };
}

export function buildScheduledExportScheduleInput(input = {}, existing = null) {
  const scheduleType = normalizeScheduleType(
    input.scheduleType ?? input.frequency ?? existing?.scheduleType,
  );
  const timezone = input.timezone ?? existing?.timezone;
  const providedConfig = getProvidedScheduleConfig(input);
  const existingConfig = extractExistingSchedule(existing, scheduleType);
  const existingStillMatchesSchedule = existing?.scheduleType === scheduleType;

  const coreInput = {
    scheduleType,
    timezone,
    nextRunAt: input.nextRunAt ?? (existingStillMatchesSchedule ? existing?.nextRunAt : undefined),
    startAt: input.startAt ?? (existingStillMatchesSchedule ? existing?.startAt : undefined),
    endAt: input.endAt ?? (existingStillMatchesSchedule ? existing?.endAt : undefined),
  };

  switch (scheduleType) {
    case SCHEDULED_EXPORT_SCHEDULE_TYPES.ONE_TIME:
      coreInput.runAt = normalizeRunAt(input, providedConfig, existingConfig);
      break;
    case SCHEDULED_EXPORT_SCHEDULE_TYPES.DAILY:
      coreInput.runAt = normalizeScheduleTime(input, providedConfig, existingConfig);
      break;
    case SCHEDULED_EXPORT_SCHEDULE_TYPES.WEEKLY:
      coreInput.runAt = normalizeScheduleTime(input, providedConfig, existingConfig);
      coreInput.daysOfWeek =
        input.daysOfWeek ??
        input.daysOfWeekToRun ??
        providedConfig.weekdays ??
        existingConfig.weekdays;
      break;
    case SCHEDULED_EXPORT_SCHEDULE_TYPES.MONTHLY:
      coreInput.runAt = normalizeScheduleTime(input, providedConfig, existingConfig);
      coreInput.dayOfMonth =
        input.dayOfMonth ??
        input.dayOfMonthToRun ??
        providedConfig.dayOfMonth ??
        existingConfig.dayOfMonth;
      break;
    default:
      throw new Error("Unsupported scheduled export scheduleType");
  }

  return buildScheduledExportScheduleInputCore(coreInput);
}

function normalizeExportRecordForCompute(exportRecord = {}) {
  const scheduleConfig =
    exportRecord.scheduleConfig && typeof exportRecord.scheduleConfig === "object"
      ? exportRecord.scheduleConfig
      : {};
  const scheduleType = normalizeScheduleType(exportRecord.scheduleType);

  return buildScheduledExportScheduleInputCore({
    scheduleType,
    timezone: exportRecord.timezone,
    nextRunAt: exportRecord.nextRunAt,
    startAt: exportRecord.startAt,
    endAt: exportRecord.endAt,
    runAt:
      scheduleType === SCHEDULED_EXPORT_SCHEDULE_TYPES.ONE_TIME
        ? scheduleConfig.runAt
        : scheduleConfig.time,
    daysOfWeek: scheduleConfig.weekdays,
    dayOfMonth: scheduleConfig.dayOfMonth,
  });
}

function clampMonthlyDay(candidateMoment, desiredDay) {
  return Math.min(desiredDay, candidateMoment.daysInMonth());
}

function applyTimeParts(baseMoment, time) {
  const [hour, minute] = normalizeTimeString(time).split(":").map(Number);

  return baseMoment
    .clone()
    .hour(hour)
    .minute(minute)
    .second(0)
    .millisecond(0);
}

function getOneTimeNextRunAt(scheduleInput, fromDate) {
  const candidate = toTimezoneMoment(scheduleInput.runAt, scheduleInput.timezone);
  const base = toTimezoneMoment(fromDate, scheduleInput.timezone);

  return candidate.isAfter(base) ? candidate : null;
}

function getDailyNextRunAt(scheduleInput, fromDate) {
  const start = scheduleInput.startAt
    ? toTimezoneMoment(scheduleInput.startAt, scheduleInput.timezone)
    : null;
  const fallbackBase = toTimezoneMoment(fromDate, scheduleInput.timezone);
  const base = moment.max(fallbackBase, start ?? fallbackBase);

  let candidate = applyTimeParts(base, scheduleInput.runAt);
  if (!candidate.isAfter(base)) {
    candidate = candidate.add(1, "day");
  }

  return candidate;
}

function getWeeklyNextRunAt(scheduleInput, fromDate) {
  const start = scheduleInput.startAt
    ? toTimezoneMoment(scheduleInput.startAt, scheduleInput.timezone)
    : null;
  const fallbackBase = toTimezoneMoment(fromDate, scheduleInput.timezone);
  const base = moment.max(fallbackBase, start ?? fallbackBase);

  for (let index = 0; index < 14; index += 1) {
    const dayCandidate = base.clone().startOf("day").add(index, "day");
    if (!scheduleInput.daysOfWeek.includes(dayCandidate.day())) {
      continue;
    }

    const candidate = applyTimeParts(dayCandidate, scheduleInput.runAt);
    if (candidate.isAfter(base)) {
      return candidate;
    }
  }

  throw new Error("Unable to compute next weekly scheduled export run");
}

function getMonthlyNextRunAt(scheduleInput, fromDate) {
  const start = scheduleInput.startAt
    ? toTimezoneMoment(scheduleInput.startAt, scheduleInput.timezone)
    : null;
  const fallbackBase = toTimezoneMoment(fromDate, scheduleInput.timezone);
  const base = moment.max(fallbackBase, start ?? fallbackBase);

  for (let monthOffset = 0; monthOffset < 24; monthOffset += 1) {
    const monthCandidate = base.clone().startOf("month").add(monthOffset, "month");
    const day = clampMonthlyDay(monthCandidate, scheduleInput.dayOfMonth);
    const candidate = applyTimeParts(monthCandidate.date(day), scheduleInput.runAt);

    if (candidate.isAfter(base)) {
      return candidate;
    }
  }

  throw new Error("Unable to compute next monthly scheduled export run");
}

export function computeScheduledExportNextRunAtCore(scheduleInput, fromDate = new Date()) {
  const normalized = buildScheduledExportScheduleInputCore(scheduleInput);
  const timezoneBase = toTimezoneMoment(fromDate, normalized.timezone);

  let candidate;
  switch (normalized.scheduleType) {
    case SCHEDULED_EXPORT_SCHEDULE_TYPES.ONE_TIME:
      candidate = getOneTimeNextRunAt(normalized, timezoneBase.toDate());
      break;
    case SCHEDULED_EXPORT_SCHEDULE_TYPES.DAILY:
      candidate = getDailyNextRunAt(normalized, timezoneBase.toDate());
      break;
    case SCHEDULED_EXPORT_SCHEDULE_TYPES.WEEKLY:
      candidate = getWeeklyNextRunAt(normalized, timezoneBase.toDate());
      break;
    case SCHEDULED_EXPORT_SCHEDULE_TYPES.MONTHLY:
      candidate = getMonthlyNextRunAt(normalized, timezoneBase.toDate());
      break;
    default:
      throw new Error("Unsupported scheduled export scheduleType");
  }

  if (!candidate || !candidate.isValid()) {
    return null;
  }

  if (normalized.endAt) {
    const endAtMoment = moment(normalized.endAt);
    if (candidate.clone().utc().isAfter(endAtMoment)) {
      return null;
    }
  }

  return candidate.utc().toDate();
}

export function computeScheduledExportNextRunAt(exportRecord, fromDate = new Date()) {
  if (
    exportRecord?.scheduleType === SCHEDULED_EXPORT_SCHEDULE_TYPES.ONE_TIME &&
    (exportRecord.lastRunAt || exportRecord.completedAt)
  ) {
    return null;
  }

  return computeScheduledExportNextRunAtCore(
    normalizeExportRecordForCompute(exportRecord),
    fromDate,
  );
}
