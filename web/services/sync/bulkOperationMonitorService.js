import { getBulkOperationStatusById } from "../../utils/bulkOperationHelper.js";
import * as syncRunService from "./syncRunService.js";

/**
 * Bulk operation monitor service.
 *
 * Responsibilities:
 * - fetch Shopify bulk-operation status by id
 * - heartbeat SyncRun progress
 * - attach result artifact metadata when Shopify exposes a result URL
 * - fail SyncRun when Shopify reports a terminal failure
 *
 * Not responsible for:
 * - polling loops / schedulers
 * - JSONL download
 * - ingestion
 * - snapshot activation
 */

const BULK_STATUS = {
  CREATED: "CREATED",
  RUNNING: "RUNNING",
  CANCELING: "CANCELING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELED: "CANCELED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
  NOT_FOUND: "NOT_FOUND",
};

const TERMINAL_STATUSES = new Set([
  BULK_STATUS.COMPLETED,
  BULK_STATUS.FAILED,
  BULK_STATUS.CANCELED,
  BULK_STATUS.CANCELLED,
  BULK_STATUS.EXPIRED,
  BULK_STATUS.NOT_FOUND,
]);

const FAILED_STATUSES = new Set([
  BULK_STATUS.FAILED,
  BULK_STATUS.CANCELED,
  BULK_STATUS.CANCELLED,
  BULK_STATUS.EXPIRED,
  BULK_STATUS.NOT_FOUND,
]);

const DEFAULT_ARTIFACT_TYPE = "BULK_JSONL";
const DEFAULT_CONTENT_TYPE = "application/x-ndjson";
const DEFAULT_PIPELINE_VERSION = "catalog-sync-v1";
const DEFAULT_SCHEMA_VERSION = "v1";

const assertSession = (session) => {
  if (!session) {
    throw new Error("Shopify session is required");
  }
};

const assertId = (id, fieldName) => {
  if (!id || typeof id !== "string") {
    throw new Error(`${fieldName} is required`);
  }
};

const assertShop = (shop) => {
  if (!shop || typeof shop !== "string") {
    throw new Error("shop is required");
  }
};

const normalizeBulkStatus = (status) => {
  if (!status || typeof status !== "string") {
    return null;
  }

  return status.trim().toUpperCase();
};

const buildBulkStage = (status) => {
  const normalizedStatus = normalizeBulkStatus(status);

  if (!normalizedStatus) {
    return "SHOPIFY_BULK_STATUS_UNKNOWN";
  }

  if (normalizedStatus === BULK_STATUS.COMPLETED) {
    return "BULK_ARTIFACT_READY";
  }

  return `SHOPIFY_BULK_${normalizedStatus}`;
};

export const isBulkOperationTerminal = (status) => {
  return TERMINAL_STATUSES.has(normalizeBulkStatus(status));
};

export const isBulkOperationFailure = (status) => {
  return FAILED_STATUSES.has(normalizeBulkStatus(status));
};

/**
 * Fetch a single Shopify bulk-operation status snapshot.
 */
export const getBulkOperationSnapshot = async ({
  session,
  bulkOperationId,
}) => {
  assertSession(session);
  assertId(bulkOperationId, "bulkOperationId");

  return getBulkOperationStatusById({
    session,
    bulkOperationId,
  });
};

/**
 * Monitor one bulk-operation tick.
 *
 * This is intentionally one-shot. Schedulers/workers can call it repeatedly,
 * but this service does not own timing.
 */
export const monitorBulkOperationOnce = async ({
  session,
  shop,
  syncRunId = null,
  bulkOperationId,
  artifactType = DEFAULT_ARTIFACT_TYPE,
  contentType = DEFAULT_CONTENT_TYPE,
  pipelineVersion = DEFAULT_PIPELINE_VERSION,
  schemaVersion = DEFAULT_SCHEMA_VERSION,
}) => {
  assertSession(session);
  assertShop(shop);
  assertId(bulkOperationId, "bulkOperationId");

  const bulkOperation = await getBulkOperationSnapshot({
    session,
    bulkOperationId,
  });

  const status = normalizeBulkStatus(bulkOperation.status);
  const responseUrl = bulkOperation.url || bulkOperation.partialDataUrl || null;
  const stage = buildBulkStage(status);

  if (isBulkOperationFailure(status)) {
    const syncRun = syncRunId
      ? await syncRunService.markSyncRunFailed({
          syncRunId,
          stage,
          failureCode: bulkOperation.errorCode || `SHOPIFY_BULK_${status}`,
          failureMessage:
            bulkOperation.errorCode ||
            `Shopify bulk operation ended with status ${status}`,
          bulkOperationId,
          responseUrl,
        })
      : null;

    return {
      status,
      terminal: true,
      failed: true,
      artifactAttached: false,
      bulkOperation,
      syncRun,
    };
  }

  const syncRun = syncRunId
    ? await syncRunService.heartbeatSyncRun({
        syncRunId,
        stage,
        responseUrl,
      })
    : null;

  let artifact = null;

  if (syncRunId && status === BULK_STATUS.COMPLETED && responseUrl) {
    artifact = await syncRunService.attachArtifactToSyncRun({
      syncRunId,
      shop,
      artifactType,
      sourceUrl: responseUrl,
      rowCount: bulkOperation.objectCount,
      contentType,
      pipelineVersion,
      schemaVersion,
    });
  }

  return {
    status,
    terminal: isBulkOperationTerminal(status),
    failed: false,
    artifactAttached: !!artifact,
    bulkOperation,
    syncRun,
    artifact,
  };
};
