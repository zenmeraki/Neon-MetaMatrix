function normalizeDelay(delay) {
  const parsed = Number(delay);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed);
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export function withRetryJitter(delay = 5_000, jitterMs = 2_000) {
  const baseDelay = normalizeDelay(delay) ?? 5_000;
  const maxJitter = Math.max(0, Number(jitterMs) || 0);

  return baseDelay + Math.floor(Math.random() * (maxJitter + 1));
}

export function buildJobBackoff(delay = 5_000) {
  return {
    type: "exponential",
    delay: withRetryJitter(delay),
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
  const normalizedDelay = normalizeDelay(delay);
  const normalizedPriority =
    priority === undefined ? undefined : normalizePositiveInteger(priority);

  return {
    attempts: normalizePositiveInteger(attempts, 5),
    backoff: buildJobBackoff(backoffDelay),
    removeOnComplete,
    removeOnFail,
    ...(normalizedPriority !== undefined ? { priority: normalizedPriority } : {}),
    ...(normalizedDelay ? { delay: normalizedDelay } : {}),
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

export function createLazyQueueProxy(getQueue) {
  return new Proxy(
    {},
    {
      get(_target, property) {
        const queue = getQueue();
        const value = queue[property];
        return typeof value === "function" ? value.bind(queue) : value;
      },
    },
  );
}
