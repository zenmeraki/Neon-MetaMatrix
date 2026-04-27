import {
  RECURRING_SCHEDULE_TYPES,
  computeNextRecurringRunAt,
  normalizeTimeString,
  normalizeWeekdays,
} from "./recurringScheduleUtils.js";

export const AUTOMATIC_RULE_SCHEDULE_TYPES = {
  CRON: RECURRING_SCHEDULE_TYPES.CRON,
  DAILY: RECURRING_SCHEDULE_TYPES.DAILY,
  WEEKLY: RECURRING_SCHEDULE_TYPES.WEEKLY,
  MONTHLY: RECURRING_SCHEDULE_TYPES.MONTHLY,
  EVERY_X_MINUTES: RECURRING_SCHEDULE_TYPES.EVERY_X_MINUTES,
};

export { normalizeTimeString, normalizeWeekdays };

export function computeNextAutomaticRuleRunAt(rule, fromDate = new Date()) {
  return computeNextRecurringRunAt(rule, fromDate);
}
