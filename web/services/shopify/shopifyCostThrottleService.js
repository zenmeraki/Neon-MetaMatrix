import { connection } from "../../Config/redis.js";

const SHOPIFY_MAX_POINTS = 1000;
const SHOPIFY_RESTORE_RATE = 50;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throttleKey(shop) {
  return `shopify:points:${shop}`;
}

export async function waitForShopifyCostBudget(shop, requiredCost = 100) {
  if (!shop) return;

  const raw = await connection.get(throttleKey(shop));
  const available = Number.parseInt(raw ?? String(SHOPIFY_MAX_POINTS), 10);

  if (available >= requiredCost) {
    return;
  }

  const deficit = requiredCost - available;
  const waitMs = Math.ceil((deficit / SHOPIFY_RESTORE_RATE) * 1000) + 250;
  await sleep(waitMs);
}

export async function recordShopifyCostBudget(shop, throttleStatus) {
  if (!shop || !throttleStatus) return;

  const available = Number(
    throttleStatus.currentlyAvailable ?? SHOPIFY_MAX_POINTS,
  );
  const restoreRate = Number(throttleStatus.restoreRate ?? SHOPIFY_RESTORE_RATE);
  const ttlSeconds = Math.max(
    1,
    Math.ceil((SHOPIFY_MAX_POINTS - available) / Math.max(restoreRate, 1)),
  );

  await connection.set(
    throttleKey(shop),
    String(Math.max(0, Math.floor(available))),
    "EX",
    ttlSeconds,
  );
}

export function extractShopifyThrottleStatus(responseBody) {
  return (
    responseBody?.extensions?.cost?.throttleStatus ||
    responseBody?.body?.extensions?.cost?.throttleStatus ||
    null
  );
}
