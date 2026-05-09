import { createQueue } from "./createQueue.js";
import { DEFAULT_JOB_OPTIONS } from "../jobOptions.js";

export const SCHEDULED_DISPATCH_JOB_OPTIONS = {
  ...DEFAULT_JOB_OPTIONS,
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 10_000,
  },
};

export const scheduledDispatchQueue = createQueue(
  "scheduled.dispatch",
  SCHEDULED_DISPATCH_JOB_OPTIONS,
);

export function addScheduledDispatchJob({ shop, scheduledRunId }) {
  return scheduledDispatchQueue.add(
    "scheduled.dispatch",
    { shop, scheduledRunId },
    {
      jobId: `scheduled:dispatch:${shop}:${scheduledRunId}`,
      priority: 4,
    },
  );
}
