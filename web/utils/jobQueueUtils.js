function normalizeDelay(delay) {
  if (!Number.isFinite(delay) || delay <= 0) {
    return undefined;
  }

  return Math.floor(delay);
}

export function buildJobBackoff(delay = 5_000) {
  return {
    type: "exponential",
    delay,
  };
}

export function buildDefaultJobOptions({
  attempts = 5,
  delay,
  priority,
  removeOnComplete = { age: 24 * 3600, count: 500 },
  removeOnFail = { age: 7 * 24 * 3600, count: 2_000 },
  backoffDelay = 5_000,
} = {}) {
  return {
    attempts,
    backoff: buildJobBackoff(backoffDelay),
    removeOnComplete,
    removeOnFail,
    ...(priority !== undefined ? { priority } : {}),
    ...(normalizeDelay(delay) ? { delay: normalizeDelay(delay) } : {}),
  };
}

export function mergeJobOptions(baseOptions = {}, overrideOptions = {}) {
  return {
    ...baseOptions,
    ...overrideOptions,
    ...(baseOptions.backoff || overrideOptions.backoff
      ? {
          backoff: {
            ...(baseOptions.backoff || {}),
            ...(overrideOptions.backoff || {}),
          },
        }
      : {}),
    ...(baseOptions.removeOnComplete || overrideOptions.removeOnComplete
      ? {
          removeOnComplete:
            overrideOptions.removeOnComplete ?? baseOptions.removeOnComplete,
        }
      : {}),
    ...(baseOptions.removeOnFail || overrideOptions.removeOnFail
      ? {
          removeOnFail: overrideOptions.removeOnFail ?? baseOptions.removeOnFail,
        }
      : {}),
  };
}

export function buildWebhookJobId({ topic, webhookId, shop, entityId }) {
  if (webhookId) {
    return `webhook:${topic}:${shop}:${webhookId}`;
  }

  return `webhook:${topic}:${shop}:${entityId || "unknown"}`;
}

