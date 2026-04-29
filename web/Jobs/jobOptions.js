import { withRetryJitter } from "../utils/jobQueueUtils.js";

export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: {
    type: "exponential",
    delay: withRetryJitter(5_000),
  },
  removeOnComplete: {
    age: 48 * 3600,
    count: 5_000,
  },
  removeOnFail: {
    age: 14 * 24 * 3600,
    count: 20_000,
  },
};

export const WRITE_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: withRetryJitter(15_000),
  },
  removeOnComplete: {
    age: 7 * 24 * 3600,
    count: 20_000,
  },
  removeOnFail: {
    age: 30 * 24 * 3600,
    count: 50_000,
  },
};
