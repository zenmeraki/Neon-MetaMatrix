import * as syncArtifactRepository from "../../repositories/syncArtifactRepository.js";
import * as syncRunRepository from "../../repositories/syncRunRepository.js";

/**
 * SyncRun lifecycle service.
 *
 * Responsibilities:
 * - create sync runs
 * - mark them running/completed/failed/cancelled
 * - heartbeat long-running work
 * - attach artifact metadata to a run
 *
 * Not responsible for:
 * - Shopify bulk API calls
 * - controller responses
 * - snapshot activation
 * - JSONL parsing
 */

const RUN_STATUS = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
};

const assertShop = (shop) => {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required");
  }
};

const assertRunId = (syncRunId) => {
  if (!syncRunId || typeof syncRunId !== "string") {
    throw new Error("syncRunId is required");
  }
};

const assertRunType = (runType) => {
  if (!runType || typeof runType !== "string") {
    throw new Error("runType is required");
  }
};

const buildConflictError = (message, details = null) => {
  const error = new Error(message);
  error.code = "SYNC_RUN_CONFLICT";
  error.httpStatus = 409;
  error.details = details;
  return error;
};

const buildNotFoundError = (message, details = null) => {
  const error = new Error(message);
  error.code = "SYNC_RUN_NOT_FOUND";
  error.httpStatus = 404;
  error.details = details;
  return error;
};

const now = () => new Date();

/**
 * Create a new pending sync run.
 *
 * Use this at the very beginning of a sync orchestration path.
 */
export const createPendingSyncRun = async ({
  shop,
  runType,
  domain = null,
  catalogBatchId = null,
  triggerSource = null,
  responseUrl = null,
  isInitialSync = false,
}) => {
  assertShop(shop);
  assertRunType(runType);

  return syncRunRepository.createSyncRun({
    shop,
    runType,
    domain,
    status: RUN_STATUS.PENDING,
    stage: "QUEUED",
    catalogBatchId,
    triggerSource,
    responseUrl,
    isInitialSync,
  });
};

/**
 * Return the latest active sync run for a shop.
 *
 * Transitional safety helper while the old truth model still exists.
 */
export const getLatestActiveSyncRun = async ({
  shop,
  runType = null,
  domain = null,
}) => {
  assertShop(shop);

  return syncRunRepository.findLatestActiveSyncRunByShop(
    shop,
    {
      ...(runType ? { runType } : {}),
      ...(domain ? { domain } : {}),
    },
  );
};

export const getSyncRunByBulkOperationId = async ({ bulkOperationId }) => {
  if (!bulkOperationId || typeof bulkOperationId !== "string") {
    throw new Error("bulkOperationId is required");
  }

  return syncRunRepository.findSyncRunByBulkOperationId(bulkOperationId);
};

export const getSyncRunById = async ({ syncRunId }) => {
  assertRunId(syncRunId);

  return syncRunRepository.findSyncRunById(syncRunId);
};

/**
 * Assert there is no active sync run for the given scope.
 *
 * Use this before creating a new authoritative sync run.
 */
export const assertNoActiveSyncRun = async ({
  shop,
  runType = null,
  domain = null,
}) => {
  assertShop(shop);

  const activeRun = await getLatestActiveSyncRun({
    shop,
    runType,
    domain,
  });

  if (activeRun) {
    throw buildConflictError("An active sync run already exists", {
      shop,
      activeSyncRunId: activeRun.id,
      status: activeRun.status,
      stage: activeRun.stage,
      runType: activeRun.runType,
      domain: activeRun.domain,
      catalogBatchId: activeRun.catalogBatchId,
      bulkOperationId: activeRun.bulkOperationId,
    });
  }

  return null;
};

/**
 * Mark a run as RUNNING.
 *
 * Safe to call right after the bulk operation is successfully started.
 */
export const markSyncRunRunning = async ({
  syncRunId,
  stage = "SHOPIFY_BULK_RUNNING",
  bulkOperationId = null,
  catalogBatchId = null,
  triggerSource = null,
  responseUrl = null,
  startedAt = null,
}) => {
  assertRunId(syncRunId);

  const existing = await syncRunRepository.findSyncRunById(syncRunId);

  if (!existing) {
    throw buildNotFoundError("SyncRun not found", { syncRunId });
  }

  if (
    existing.status === RUN_STATUS.COMPLETED ||
    existing.status === RUN_STATUS.FAILED ||
    existing.status === RUN_STATUS.CANCELLED
  ) {
    throw buildConflictError("Cannot mark a terminal SyncRun as running", {
      syncRunId,
      currentStatus: existing.status,
    });
  }

  return syncRunRepository.markSyncRunRunning(syncRunId, {
    stage,
    bulkOperationId,
    catalogBatchId,
    triggerSource,
    responseUrl,
    startedAt: existing.startedAt || startedAt || now(),
  });
};

/**
 * Heartbeat a running sync run.
 *
 * Use in long-running polling loops or ingestion workers.
 */
export const heartbeatSyncRun = async ({
  syncRunId,
  stage = null,
  responseUrl = null,
}) => {
  assertRunId(syncRunId);

  const existing = await syncRunRepository.findSyncRunById(syncRunId);

  if (!existing) {
    throw buildNotFoundError("SyncRun not found", { syncRunId });
  }

  if (
    existing.status === RUN_STATUS.COMPLETED ||
    existing.status === RUN_STATUS.FAILED ||
    existing.status === RUN_STATUS.CANCELLED
  ) {
    return existing;
  }

  return syncRunRepository.updateSyncRun(syncRunId, {
    ...(stage ? { stage } : {}),
    ...(responseUrl ? { responseUrl } : {}),
    lastHeartbeatAt: now(),
  });
};

/**
 * Mark a sync run as completed.
 */
export const markSyncRunCompleted = async ({
  syncRunId,
  stage = "COMPLETED",
  rowCount = null,
  durationMs = null,
  catalogBatchId = null,
  bulkOperationId = null,
  responseUrl = null,
}) => {
  assertRunId(syncRunId);

  const existing = await syncRunRepository.findSyncRunById(syncRunId);

  if (!existing) {
    throw buildNotFoundError("SyncRun not found", { syncRunId });
  }

  if (existing.status === RUN_STATUS.COMPLETED) {
    return existing;
  }

  if (
    existing.status === RUN_STATUS.FAILED ||
    existing.status === RUN_STATUS.CANCELLED
  ) {
    throw buildConflictError("Cannot complete a terminal failed/cancelled SyncRun", {
      syncRunId,
      currentStatus: existing.status,
    });
  }

  return syncRunRepository.markSyncRunCompleted(syncRunId, {
    stage,
    rowCount,
    durationMs,
    catalogBatchId,
    bulkOperationId,
    responseUrl,
    completedAt: now(),
  });
};

/**
 * Mark a sync run as failed.
 */
export const markSyncRunFailed = async ({
  syncRunId,
  stage = "FAILED",
  failureCode = null,
  failureMessage = "Sync failed",
  durationMs = null,
  bulkOperationId = null,
  responseUrl = null,
}) => {
  assertRunId(syncRunId);

  const existing = await syncRunRepository.findSyncRunById(syncRunId);

  if (!existing) {
    throw buildNotFoundError("SyncRun not found", { syncRunId });
  }

  if (
    existing.status === RUN_STATUS.COMPLETED ||
    existing.status === RUN_STATUS.CANCELLED
  ) {
    throw buildConflictError("Cannot fail a completed/cancelled SyncRun", {
      syncRunId,
      currentStatus: existing.status,
    });
  }

  return syncRunRepository.markSyncRunFailed(syncRunId, {
    stage,
    failureCode,
    failureMessage,
    durationMs,
    bulkOperationId,
    responseUrl,
    completedAt: now(),
  });
};

/**
 * Mark a sync run as cancelled.
 */
export const markSyncRunCancelled = async ({
  syncRunId,
  stage = "FAILED",
  failureCode = null,
  failureMessage = "Sync cancelled",
}) => {
  assertRunId(syncRunId);

  const existing = await syncRunRepository.findSyncRunById(syncRunId);

  if (!existing) {
    throw buildNotFoundError("SyncRun not found", { syncRunId });
  }

  if (
    existing.status === RUN_STATUS.COMPLETED ||
    existing.status === RUN_STATUS.FAILED ||
    existing.status === RUN_STATUS.CANCELLED
  ) {
    return existing;
  }

  return syncRunRepository.markSyncRunCancelled(syncRunId, {
    stage,
    failureCode,
    failureMessage,
    completedAt: now(),
  });
};

/**
 * Attach an artifact record to a sync run.
 *
 * This is the first clean integration point for SyncArtifact.
 */
export const attachArtifactToSyncRun = async ({
  syncRunId,
  shop,
  artifactType,
  sourceUrl = null,
  storageUrl = null,
  checksum = null,
  rowCount = null,
  contentType = null,
  pipelineVersion = null,
  schemaVersion = null,
}) => {
  assertRunId(syncRunId);
  assertShop(shop);

  const existing = await syncRunRepository.findSyncRunById(syncRunId, {
    select: {
      id: true,
      shop: true,
      status: true,
    },
  });

  if (!existing) {
    throw buildNotFoundError("SyncRun not found", { syncRunId });
  }

  if (existing.shop !== shop) {
    throw buildConflictError("SyncRun does not belong to the provided shop", {
      syncRunId,
      syncRunShop: existing.shop,
      providedShop: shop,
    });
  }

  return syncArtifactRepository.upsertArtifactByRunTypeAndSourceUrl({
    syncRunId,
    shop,
    artifactType,
    sourceUrl,
    storageUrl,
    checksum,
    rowCount,
    contentType,
    pipelineVersion,
    schemaVersion,
  });
};

/**
 * Get recent sync runs for diagnostics or admin screens.
 */
export const listRecentSyncRuns = async ({
  shop,
  runType = null,
  domain = null,
  status = null,
  take = 20,
}) => {
  assertShop(shop);

  return syncRunRepository.listRecentSyncRunsByShop(
    shop,
    {
      ...(runType ? { runType } : {}),
      ...(domain ? { domain } : {}),
      ...(status ? { status } : {}),
    },
    { take },
  );
};

/**
 * Get latest sync run for a shop.
 */
export const getLatestSyncRun = async ({
  shop,
  runType = null,
  domain = null,
  status = null,
}) => {
  assertShop(shop);

  return syncRunRepository.findLatestSyncRunByShop(shop, {
    ...(runType ? { runType } : {}),
    ...(domain ? { domain } : {}),
    ...(status ? { status } : {}),
  });
};
