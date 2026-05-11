import { createQueue } from "./createQueue.js";
import { DEFAULT_JOB_OPTIONS } from "../jobOptions.js";

export const SCHEDULED_CLAIM_JOB_OPTIONS = {
  ...DEFAULT_JOB_OPTIONS,
  attempts: 1,
};

export const scheduledClaimQueue = createQueue(
  "scheduled.claim",
  SCHEDULED_CLAIM_JOB_OPTIONS,
);

export function buildMinuteBucket(date = new Date()) {
  return date.toISOString().slice(0, 16);
}

export function addScheduledClaimRepeatableJob(date = new Date()) {
  const minuteBucket = buildMinuteBucket(date);

  return scheduledClaimQueue.add(
    "scheduled.claim",
    {},
    {
      jobId: `scheduled:claim:${minuteBucket}`,
      repeat: { pattern: "* * * * *" },
    },
  );
}
