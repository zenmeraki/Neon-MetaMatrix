export const BULK_EDIT_EXECUTION_STATES = {
  PLANNED: "planned",
  QUEUED: "queued",
  DISPATCHING: "dispatching",
  AWAITING_SHOPIFY: "awaiting_shopify",
  FINALIZING: "finalizing",
  COMPLETED: "completed",
  FAILED: "failed",
  PARTIAL: "partial",
  CANCEL_REQUESTED: "cancel_requested",
  CANCELLED_BEFORE_SHOPIFY: "cancelled_before_shopify",
  CANCEL_NOT_POSSIBLE_SHOPIFY_SUBMITTED: "cancel_not_possible_shopify_submitted",
  CANCELLED: "cancelled",
};

export const BULK_UNDO_STATES = {
  PLANNED: "planned",
  QUEUED: "queued",
  DISPATCHING: "dispatching",
  AWAITING_SHOPIFY: "awaiting_shopify",
  FINALIZING: "finalizing",
  COMPLETED: "completed",
  FAILED: "failed",
  PARTIAL: "partial",
  CANCEL_REQUESTED: "cancel_requested",
  CANCELLED_BEFORE_SHOPIFY: "cancelled_before_shopify",
  CANCEL_NOT_POSSIBLE_SHOPIFY_SUBMITTED: "cancel_not_possible_shopify_submitted",
  CANCELLED: "cancelled",
};

export function normalizeUndoState(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : fallback;
}

export function isTerminalExecutionState(state) {
  return [
    BULK_EDIT_EXECUTION_STATES.COMPLETED,
    BULK_EDIT_EXECUTION_STATES.FAILED,
    BULK_EDIT_EXECUTION_STATES.PARTIAL,
    BULK_EDIT_EXECUTION_STATES.CANCELLED,
  ].includes(state);
}

export function isTerminalUndoState(state) {
  return [
    BULK_UNDO_STATES.COMPLETED,
    BULK_UNDO_STATES.FAILED,
    BULK_UNDO_STATES.PARTIAL,
    BULK_UNDO_STATES.CANCELLED,
  ].includes(state);
}

export function buildExecutionError({
  code,
  stage,
  message,
  retryable = false,
  details = null,
}) {
  return {
    code,
    stage,
    message,
    retryable,
    details: details ?? null,
    occurredAt: new Date().toISOString(),
  };
}

export function appendExecutionError(existing, entry) {
  if (!existing) {
    return [entry];
  }

  if (Array.isArray(existing)) {
    return [...existing, entry];
  }

  return [existing, entry];
}

export function buildPlannedUndoState({ allowed, executionIdentity = null }) {
  return {
    allowed: Boolean(allowed),
    status: "idle",
    state: BULK_UNDO_STATES.PLANNED,
    executionIdentity,
    processedCount: 0,
    durationMs: 0,
    queuedAt: null,
    startedAt: null,
    completedAt: null,
    bulkOperationId: null,
    error: null,
  };
}
