import moment from "moment-timezone";
import parser from "cron-parser";
import { assertValidTimezone, toTimezoneMoment } from "./timezoneUtils.js";

export const RECURRING_SCHEDULE_TYPES = {
  ONE_TIME: "ONE_TIME",
  CRON: "CRON",
  DAILY: "DAILY",
  WEEKLY: "WEEKLY",
  MONTHLY: "MONTHLY",
  EVERY_X_MINUTES: "EVERY_X_MINUTES",
};

const WEEKDAY_NAME_MAP = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export function normalizeTimeString(time) {
  const value = String(time || "").trim();
  if (!/^\d{2}:\d{2}$/.test(value)) {
    throw new Error("Time must be in HH:mm format");
  }

  const [hour, minute] = value.split(":").map(Number);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("Time must be in HH:mm format");
  }

  return value;
}

export function normalizeWeekdays(weekdays = []) {
  const values = Array.isArray(weekdays) ? weekdays : [weekdays];

  const normalized = values
    .map((value) => {
      if (typeof value === "number" && value >= 0 && value <= 6) {
        return value;
      }

      const numeric = Number.parseInt(value, 10);
      if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 6) {
        return numeric;
      }

      const mapped = WEEKDAY_NAME_MAP[String(value || "").trim().toLowerCase()];
      if (mapped !== undefined) {
        return mapped;
      }

      throw new Error("Weekdays must be numbers between 0 and 6");
    })
    .sort((left, right) => left - right);

  return Array.from(new Set(normalized));
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

function getOneTimeNextRunAt({ scheduleConfig, timezone }, fromDate) {
  const runAt = scheduleConfig?.runAt;
  if (!runAt) {
    throw new Error("One-time schedules require runAt");
  }

  const candidate = toTimezoneMoment(runAt, timezone);
  const base = toTimezoneMoment(fromDate, timezone);

  if (!candidate.isAfter(base)) {
    return null;
  }

  return candidate;
}

function getDailyNextRunAt({ scheduleConfig, timezone, startAt }, fromDate) {
  const time = scheduleConfig?.time;
  const start = startAt ? toTimezoneMoment(startAt, timezone) : null;
  const fallbackBase = toTimezoneMoment(fromDate, timezone);
  const base = moment.max(fallbackBase, start ?? fallbackBase);

  let candidate = applyTimeParts(base, time);
  if (!candidate.isAfter(base)) {
    candidate = candidate.add(1, "day");
  }

  return candidate;
}

function getWeeklyNextRunAt({ scheduleConfig, timezone, startAt }, fromDate) {
  const time = scheduleConfig?.time;
  const weekdays = normalizeWeekdays(scheduleConfig?.weekdays || []);
  if (!weekdays.length) {
    throw new Error("Weekly schedules require at least one weekday");
  }

  const start = startAt ? toTimezoneMoment(startAt, timezone) : null;
  const fallbackBase = toTimezoneMoment(fromDate, timezone);
  const base = moment.max(fallbackBase, start ?? fallbackBase);

  for (let index = 0; index < 14; index += 1) {
    const dayCandidate = base.clone().startOf("day").add(index, "day");
    if (!weekdays.includes(dayCandidate.day())) {
      continue;
    }

    const candidate = applyTimeParts(dayCandidate, time);
    if (candidate.isAfter(base)) {
      return candidate;
    }
  }

  throw new Error("Unable to compute next weekly run");
}

function getMonthlyNextRunAt({ scheduleConfig, timezone, startAt }, fromDate) {
  const time = scheduleConfig?.time;
  const requestedDay = Number.parseInt(scheduleConfig?.dayOfMonth, 10);
  if (!Number.isInteger(requestedDay) || requestedDay < 1 || requestedDay > 31) {
    throw new Error("Monthly schedules require dayOfMonth between 1 and 31");
  }

  const start = startAt ? toTimezoneMoment(startAt, timezone) : null;
  const fallbackBase = toTimezoneMoment(fromDate, timezone);
  const base = moment.max(fallbackBase, start ?? fallbackBase);

  for (let monthOffset = 0; monthOffset < 24; monthOffset += 1) {
    const monthCandidate = base.clone().startOf("month").add(monthOffset, "month");
    const day = clampMonthlyDay(monthCandidate, requestedDay);
    const candidate = applyTimeParts(monthCandidate.date(day), time);

    if (candidate.isAfter(base)) {
      return candidate;
    }
  }

  throw new Error("Unable to compute next monthly run");
}

function getIntervalNextRunAt({ scheduleConfig, timezone, startAt }, fromDate) {
  const intervalMinutes = Number.parseInt(scheduleConfig?.intervalMinutes, 10);

  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1) {
    throw new Error("Interval schedules require intervalMinutes >= 1");
  }

  const base = toTimezoneMoment(fromDate, timezone).startOf("minute");
  const anchor = startAt
    ? toTimezoneMoment(startAt, timezone).startOf("minute")
    : base.clone();

  if (anchor.isAfter(base)) {
    return anchor;
  }

  const diffMinutes = base.diff(anchor, "minutes");
  const increments = Math.floor(diffMinutes / intervalMinutes) + 1;
  return anchor.clone().add(increments * intervalMinutes, "minutes");
}

function getCronNextRunAt({ cronExpression, timezone, startAt }, fromDate) {
  if (!cronExpression) {
    throw new Error("Cron schedules require cronExpression");
  }

  const start = startAt ? new Date(startAt) : null;
  const base = start && start > fromDate ? start : fromDate;

  const interval = parser.parseExpression(cronExpression, {
    currentDate: base,
    tz: timezone,
  });

  return moment(interval.next().toDate()).tz(timezone);
}

export function computeNextRecurringRunAt(edit, fromDate = new Date()) {
  const timezone = assertValidTimezone(edit.timezone);
  const scheduleType = String(edit.scheduleType || "").toUpperCase();

  let candidate;
  switch (scheduleType) {
    case RECURRING_SCHEDULE_TYPES.ONE_TIME:
      candidate = getOneTimeNextRunAt(edit, fromDate);
      break;
    case RECURRING_SCHEDULE_TYPES.DAILY:
      candidate = getDailyNextRunAt(edit, fromDate);
      break;
    case RECURRING_SCHEDULE_TYPES.WEEKLY:
      candidate = getWeeklyNextRunAt(edit, fromDate);
      break;
    case RECURRING_SCHEDULE_TYPES.MONTHLY:
      candidate = getMonthlyNextRunAt(edit, fromDate);
      break;
    case RECURRING_SCHEDULE_TYPES.EVERY_X_MINUTES:
      candidate = getIntervalNextRunAt(edit, fromDate);
      break;
    case RECURRING_SCHEDULE_TYPES.CRON:
      candidate = getCronNextRunAt(edit, fromDate);
      break;
    default:
      throw new Error("Unsupported recurring schedule type");
  }

  if (!candidate || !candidate.isValid()) {
    return null;
  }

  if (edit.endAt) {
    const endAtMoment = moment(edit.endAt);
    if (candidate.utc().isAfter(endAtMoment)) {
      return null;
    }
  }

  return candidate.utc().toDate();
}
