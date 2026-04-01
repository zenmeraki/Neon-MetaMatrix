import moment from "moment-timezone";

export function assertValidTimezone(timezone) {
  if (!timezone || !moment.tz.zone(timezone)) {
    throw new Error("A valid timezone is required");
  }

  return timezone;
}

export function toTimezoneMoment(value, timezone) {
  assertValidTimezone(timezone);
  return value ? moment(value).tz(timezone) : moment.tz(timezone);
}

export function toUtcDate(value, timezone) {
  return toTimezoneMoment(value, timezone).utc().toDate();
}
