import { prisma } from "../config/database.js";

const CANONICAL_TO_EDIT_HISTORY_EXECUTION_STATE = {
  PLANNED: "planned",
  SNAPSHOTTING: "freezing",
  SNAPSHOTTED: "queued",
  DISPATCHING: "dispatching",
  AWAITING_SHOPIFY: "awaiting_shopify",
  APPLYING_RESULTS: "finalizing",
  VERIFYING: "finalizing",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

const CANONICAL_TO_BULK_UNDO_STATE = {
  PLANNED: "queued",
  SNAPSHOTTING: "queued",
  SNAPSHOTTED: "queued",
  DISPATCHING: "running",
  AWAITING_SHOPIFY: "running",
  APPLYING_RESULTS: "running",
  VERIFYING: "running",
  COMPLETED: "done",
  FAILED: "failed",
  CANCELLED: "failed",
};

const CANONICAL_TO_EXPORT_EXECUTION_STATE = {
  PLANNED: "planned",
  SNAPSHOTTING: "queued",
  SNAPSHOTTED: "queued",
  DISPATCHING: "running",
  AWAITING_SHOPIFY: "running",
  APPLYING_RESULTS: "finalizing",
  VERIFYING: "finalizing",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

const CANONICAL_TO_STORE_OPERATION_STATUS = {
  PLANNED: "QUEUED",
  SNAPSHOTTING: "RUNNING",
  SNAPSHOTTED: "QUEUED",
  DISPATCHING: "RUNNING",
  AWAITING_SHOPIFY: "RUNNING",
  APPLYING_RESULTS: "FINALIZING",
  VERIFYING: "FINALIZING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
};

function getClient(db) {
  return db || prisma;
}

async function getOperation({ shop, operationId }, db = prisma) {
  return getClient(db).merchantOperation.findFirst({
    where: { id: operationId, shop },
    select: {
      id: true,
      shop: true,
      status: true,
      processedItems: true,
      totalItems: true,
      failedItems: true,
      completedAt: true,
      failedAt: true,
      errorCode: true,
      errorMessage: true,
      updatedAt: true,
    },
  });
}

async function getLatestExportArtifact(
  { shop, operationId, exportJobId },
  db = prisma,
) {
  if (!exportJobId) return null;
  return getClient(db).exportArtifact.findFirst({
    where: {
      shop,
      merchantOperationId: operationId,
      exportJobId,
    },
    orderBy: { createdAt: "desc" },
    select: {
      status: true,
      completedAt: true,
      updatedAt: true,
    },
  });
}

function mapOperationToEditHistoryStatus(operationStatus) {
  if (operationStatus === "COMPLETED") return "completed";
  if (operationStatus === "FAILED" || operationStatus === "CANCELLED") return "failed";
  if (
    operationStatus === "SNAPSHOTTING" ||
    operationStatus === "DISPATCHING" ||
    operationStatus === "AWAITING_SHOPIFY" ||
    operationStatus === "APPLYING_RESULTS" ||
    operationStatus === "VERIFYING"
  ) {
    return "processing";
  }
  return "pending";
}

function mapOperationAndArtifactToExportStatus(operationStatus, artifactStatus) {
  if (operationStatus === "FAILED") return "FAILED";
  if (operationStatus === "CANCELLED") return "CANCELLED";
  if (artifactStatus === "FAILED" || artifactStatus === "EXPIRED") return "FAILED";
  if (artifactStatus === "STORED") return "DONE";
  if (
    operationStatus === "COMPLETED" ||
    operationStatus === "DISPATCHING" ||
    operationStatus === "AWAITING_SHOPIFY" ||
    operationStatus === "APPLYING_RESULTS" ||
    operationStatus === "VERIFYING" ||
    artifactStatus === "GENERATING"
  ) {
    return "RUNNING";
  }
  return "PENDING";
}

export async function projectOperationToEditHistory(
  { shop, editHistoryId, operationId },
  db = prisma,
) {
  const operation = await getOperation({ shop, operationId }, db);
  if (!operation) return { count: 0 };
  const executionState =
    CANONICAL_TO_EDIT_HISTORY_EXECUTION_STATE[operation.status] || "planned";
  const status = mapOperationToEditHistoryStatus(operation.status);
  return getClient(db).editHistory.updateMany({
    where: { id: editHistoryId, shop, operationId },
    data: {
      executionState,
      status,
      processedCount: Number(operation.processedItems || 0),
      totalItems: Number(operation.totalItems || 0),
      completedAt: operation.completedAt,
      error: operation.errorMessage
        ? { code: operation.errorCode || null, message: operation.errorMessage }
        : undefined,
      summary: {
        operationStatus: operation.status,
        failedItems: Number(operation.failedItems || 0),
        projectedAt: operation.updatedAt.toISOString(),
      },
    },
  });
}

export async function projectOperationToExportJob(
  { shop, exportJobId, operationId },
  db = prisma,
) {
  const operation = await getOperation({ shop, operationId }, db);
  if (!operation) return { count: 0 };
  const artifact = await getLatestExportArtifact(
    { shop, operationId, exportJobId },
    db,
  );
  return getClient(db).exportJob.updateMany({
    where: { id: exportJobId, shop, operationId },
    data: {
      status: mapOperationAndArtifactToExportStatus(
        operation.status,
        artifact?.status || null,
      ),
      executionState:
        CANONICAL_TO_EXPORT_EXECUTION_STATE[operation.status] || "planned",
      totalItems: Number(operation.totalItems || 0),
      completedAt: artifact?.completedAt || operation.completedAt || null,
      error: operation.errorMessage || null,
    },
  });
}

export async function projectOperationToBulkUndoExecution(
  { shop, executionIdentity, operationId },
  db = prisma,
) {
  const operation = await getOperation({ shop, operationId }, db);
  if (!operation) return { count: 0 };
  return getClient(db).bulkUndoExecution.updateMany({
    where: { shop, executionIdentity, operationId },
    data: {
      state: CANONICAL_TO_BULK_UNDO_STATE[operation.status] || "FREEZING",
      processedCount: Number(operation.processedItems || 0),
      frozenCount: Number(operation.totalItems || 0),
      errorMessage: operation.errorMessage || null,
    },
  });
}

export async function projectOperationToStoreOperation(
  { shop, storeOperationId, operationId },
  db = prisma,
) {
  const operation = await getOperation({ shop, operationId }, db);
  if (!operation) return { count: 0 };
  return getClient(db).storeOperation.updateMany({
    where: { id: storeOperationId, shop },
    data: {
      status: CANONICAL_TO_STORE_OPERATION_STATUS[operation.status] || "QUEUED",
      processedCount: Number(operation.processedItems || 0),
      totalTargets: Number(operation.totalItems || 0),
      failureCount: Number(operation.failedItems || 0),
      errorCode: operation.errorCode || null,
      errorMessage: operation.errorMessage || null,
      completedAt: operation.completedAt || null,
      failedAt: operation.failedAt || null,
    },
  });
}
