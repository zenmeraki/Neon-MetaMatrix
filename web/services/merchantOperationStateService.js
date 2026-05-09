import { prisma } from "../config/database.js";
import {
  projectOperationToEditHistory as projectEditHistoryFromOperation,
} from "./operationProjectionService.js";

const LEGACY_TO_CANONICAL = {
  planned: "PLANNED",
  queued: "SNAPSHOTTED",
  freezing: "SNAPSHOTTING",
  snapshooting: "SNAPSHOTTING",
  dispatching: "DISPATCHING",
  submitting: "DISPATCHING",
  awaiting_shopify: "AWAITING_SHOPIFY",
  awaiting_shopify_results: "AWAITING_SHOPIFY",
  finalizing: "APPLYING_RESULTS",
  verifying: "VERIFYING",
  completed: "COMPLETED",
  failed: "FAILED",
  cancelled: "CANCELLED",
  partial: "FAILED",
};

const CANONICAL_TO_LEGACY = {
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

function getClient(db) {
  return db || prisma;
}

export function mapLegacyExecutionStateToCanonical(state) {
  if (!state) return "PLANNED";
  return LEGACY_TO_CANONICAL[String(state)] || "PLANNED";
}

export function mapCanonicalToLegacyExecutionState(status) {
  return CANONICAL_TO_LEGACY[String(status)] || "planned";
}

export async function transitionMerchantOperation({
  shop,
  operationId,
  status,
  processedItems,
  totalItems,
  failedItems,
  errorCode,
  errorMessage,
  completedAt,
  failedAt,
}, db = prisma) {
  const data = {
    status,
    ...(typeof processedItems === "number" ? { processedItems } : {}),
    ...(typeof totalItems === "number" ? { totalItems } : {}),
    ...(typeof failedItems === "number" ? { failedItems } : {}),
    ...(errorCode !== undefined ? { errorCode } : {}),
    ...(errorMessage !== undefined ? { errorMessage } : {}),
    ...(completedAt !== undefined ? { completedAt } : {}),
    ...(failedAt !== undefined ? { failedAt } : {}),
  };
  return getClient(db).merchantOperation.updateMany({
    where: { id: operationId, shop },
    data,
  });
}

export async function projectOperationToEditHistory({
  shop,
  editHistoryId,
  operationId,
}, db = prisma) {
  return projectEditHistoryFromOperation(
    { shop, editHistoryId, operationId },
    db,
  );
}
