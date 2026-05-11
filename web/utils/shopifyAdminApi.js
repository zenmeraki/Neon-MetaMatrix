import shopify from "../shopify.js";
import logger from "./loggerUtils.js";
import {
  extractShopifyThrottleStatus,
  recordShopifyCostBudget,
  waitForShopifyCostBudget,
} from "../services/shopify/shopifyCostThrottleService.js";
import { recordShopifyError } from "./metricsUtils.js";
import { assertShadowExternalCallsAllowed } from "../services/shadowReadOnlyGuardService.js";

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(baseMs) {
  return baseMs + Math.floor(Math.random() * Math.max(250, Math.floor(baseMs * 0.2)));
}

function extractThrottleWaitMs(responseBody) {
  const throttleStatus = extractShopifyThrottleStatus(responseBody);

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
  executionContext = null,
  maxAttempts = 5,
  minDelayMs = 1_000,
  requiredCost = 100,
} = {}) {
  assertShadowExternalCallsAllowed(
    executionContext,
    `shopify_admin_api.${operationName}`,
  );
  const client = new shopify.api.clients.Graphql({ session });
  let attempt = 0;
  let lastError = null;

  while (attempt < maxAttempts) {
    attempt += 1;

    try {
      await waitForShopifyCostBudget(shop, requiredCost);
      const response = await client.query({ data });
      await recordShopifyCostBudget(
        shop,
        extractShopifyThrottleStatus(response),
      );
      const throttleWaitMs = extractThrottleWaitMs(response);

      if (throttleWaitMs > 0) {
        await sleep(jitter(throttleWaitMs));
      }

      return response;
    } catch (error) {
      lastError = error;
      recordShopifyError({
        shop,
        source: operationName,
        errorType: error?.code || error?.response?.statusCode || "SHOPIFY_API_ERROR",
      });

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
