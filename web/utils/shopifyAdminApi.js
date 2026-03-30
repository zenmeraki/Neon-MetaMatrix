import shopify from "../shopify.js";
import logger from "./loggerUtils.js";

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(baseMs) {
  return baseMs + Math.floor(Math.random() * Math.max(250, Math.floor(baseMs * 0.2)));
}

function extractThrottleWaitMs(responseBody) {
  const throttleStatus =
    responseBody?.extensions?.cost?.throttleStatus ||
    responseBody?.body?.extensions?.cost?.throttleStatus ||
    null;

  if (!throttleStatus) {
    return 0;
  }

  const currentlyAvailable = Number(throttleStatus.currentlyAvailable ?? 0);
  const restoreRate = Number(throttleStatus.restoreRate ?? 50);

  if (currentlyAvailable > 100 || restoreRate <= 0) {
    return 0;
  }

  const deficit = 100 - currentlyAvailable;
  return Math.ceil((deficit / restoreRate) * 1000);
}

function isRetryableError(error) {
  const statusCode =
    error?.response?.statusCode ||
    error?.response?.code ||
    error?.code ||
    null;

  if (RETRYABLE_STATUS_CODES.has(Number(statusCode))) {
    return true;
  }

  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("throttled") ||
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("bulk operation already in progress") ||
    message.includes("temporarily unavailable")
  );
}

export async function adminGraphqlWithRetry({
  session,
  data,
  operationName = "shopify-admin-request",
  shop = session?.shop,
  maxAttempts = 5,
  minDelayMs = 1_000,
} = {}) {
  const client = new shopify.api.clients.Graphql({ session });
  let attempt = 0;
  let lastError = null;

  while (attempt < maxAttempts) {
    attempt += 1;

    try {
      const response = await client.query({ data });
      const throttleWaitMs = extractThrottleWaitMs(response);

      if (throttleWaitMs > 0) {
        await sleep(jitter(throttleWaitMs));
      }

      return response;
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error) || attempt >= maxAttempts) {
        break;
      }

      const delayMs = jitter(minDelayMs * 2 ** (attempt - 1));
      logger.warn("Retrying Shopify Admin API request", {
        shop,
        operationName,
        attempt,
        delayMs,
        message: error.message,
      });
      await sleep(delayMs);
    }
  }

  throw lastError;
}
