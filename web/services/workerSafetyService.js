import { prisma } from "../config/database.js";
import { buildStoreShopWhere } from "../utils/shopIdentifier.js";

export class RetryableWorkerError extends Error {
  constructor(message, code = "retryable_worker_error", details = null) {
    super(message);
    this.name = "RetryableWorkerError";
    this.code = code;
    this.retryable = true;
    this.details = details;
  }
}

export class SkippableWorkerError extends Error {
  constructor(message, code = "skippable_worker_error", details = null) {
    super(message);
    this.name = "SkippableWorkerError";
    this.code = code;
    this.skippable = true;
    this.details = details;
  }
}

export function isRetryableWorkerError(error) {
  return Boolean(error?.retryable);
}

export function isSkippableWorkerError(error) {
  return Boolean(error?.skippable);
}

export async function getWorkerStoreState(shop, extraSelect = {}) {
  if (!shop) {
    return null;
  }

  return prisma.store.findUnique({
    where: buildStoreShopWhere(shop),
    select: {
      shopUrl: true,
      isUnInstalled: true,
      activeMirrorBatchId: true,
      lastWebhookProcessedAt: true,
      isProductSyncing: true,
      ...extraSelect,
    },
  });
}

export async function assertShopActiveForWorker(shop, options = {}) {
  const { allowMissing = false } = options;
  const store = await getWorkerStoreState(shop);

  if (!store) {
    if (allowMissing) {
      return null;
    }

    throw new SkippableWorkerError("Shop not found for background work", "shop_not_found");
  }

  if (store.isUnInstalled) {
    throw new SkippableWorkerError("Shop has been uninstalled", "shop_uninstalled");
  }

  return store;
}

export function getWebhookEventTimestamp(payload = {}, fallbackTimestamp = null) {
  const candidate =
    payload?.updated_at ||
    payload?.deleted_at ||
    payload?.created_at ||
    fallbackTimestamp ||
    null;

  if (!candidate) {
    return null;
  }

  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function buildWebhookFreshnessMetadata({
  incomingUpdatedAt = null,
  eventTimestamp = null,
  latestKnownUpdatedAt = null,
  latestKnownMirrorBatchId = null,
  activeMirrorBatchId = null,
} = {}) {
  return {
    incomingUpdatedAt: incomingUpdatedAt ? new Date(incomingUpdatedAt).toISOString() : null,
    eventTimestamp: eventTimestamp ? new Date(eventTimestamp).toISOString() : null,
    latestKnownUpdatedAt: latestKnownUpdatedAt
      ? new Date(latestKnownUpdatedAt).toISOString()
      : null,
    latestKnownMirrorBatchId,
    activeMirrorBatchId,
  };
}
