import {
  BULK_EDIT_EXECUTION_STATES,
  BULK_UNDO_STATES,
  normalizeUndoState,
} from "./bulkEditExecutionStateService.js";
import {
  EXPORT_EXECUTION_STATES,
  parseSerializedExportError,
} from "./exportExecutionStateService.js";

function parseHistoryErrors(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  if (typeof value === "object") {
    return [value];
  }

  return [{ message: String(value) }];
}

function buildStatusSummary({
  key,
  label,
  labelKey = null,
  tone,
  detail = null,
  detailKey = null,
  isTerminal = false,
}) {
  return {
    key,
    label,
    labelKey,
    tone,
    detail,
    detailKey,
    isTerminal,
  };
}

function normalizeLegacyEditStatus(status) {
  return String(status || "").toLowerCase();
}

function normalizeExportStatus(status) {
  return String(status || "").toLowerCase();
}

function mapParentOperationStatus(status) {
  const normalized = String(status || "").toLowerCase();
  switch (normalized) {
    case "snapshotting":
      return buildStatusSummary({
        key: "snapshotting",
        label: "Snapshotting",
        labelKey: "historyStatus.snapshotting",
        tone: "info",
      });
    case "dispatching":
      return buildStatusSummary({
        key: "dispatching",
        label: "Dispatching",
        labelKey: "historyStatus.dispatching",
        tone: "info",
      });
    case "awaiting_shopify":
      return buildStatusSummary({
        key: "awaiting_shopify",
        label: "Running in Shopify",
        labelKey: "historyStatus.awaiting_shopify",
        tone: "info",
      });
    case "applying_results":
      return buildStatusSummary({
        key: "applying_results",
        label: "Applying Results",
        labelKey: "historyStatus.applying_results",
        tone: "info",
      });
    case "completed":
      return buildStatusSummary({
        key: "completed",
        label: "Completed",
        labelKey: "historyStatus.completed",
        tone: "success",
        isTerminal: true,
      });
    case "failed":
      return buildStatusSummary({
        key: "failed",
        label: "Failed",
        labelKey: "historyStatus.failed",
        tone: "critical",
        isTerminal: true,
      });
    case "cancelled":
      return buildStatusSummary({
        key: "cancelled",
        label: "Cancelled",
        labelKey: "historyStatus.cancelled",
        tone: "critical",
        isTerminal: true,
      });
    default:
      return null;
  }
}

function mapBulkEditExecutionSummary(executionState, status) {
  switch (executionState) {
    case BULK_EDIT_EXECUTION_STATES.PLANNED:
    case BULK_EDIT_EXECUTION_STATES.QUEUED:
      return buildStatusSummary({
        key: "queued",
        label: "Queued",
        labelKey: "historyStatus.queued",
        tone: "attention",
        detail: "Waiting for execution.",
        detailKey: "historyStatusDetail.queued",
      });

      
    case BULK_EDIT_EXECUTION_STATES.DISPATCHING:
      return buildStatusSummary({
        key: "dispatching",
        label: "Dispatching",
        labelKey: "historyStatus.dispatching",
        tone: "info",
        detail: "Preparing the next Shopify mutation batch.",
        detailKey: "historyStatusDetail.dispatching",
      });

    case BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY:
      return buildStatusSummary({
        key: "awaiting_shopify",
        label: "Running in Shopify",
        labelKey: "historyStatus.awaiting_shopify",
        tone: "info",
        detail: "Waiting for Shopify bulk operation completion.",
        detailKey: "historyStatusDetail.awaiting_shopify",
      });

    case BULK_EDIT_EXECUTION_STATES.FINALIZING:
      return buildStatusSummary({
        key: "finalizing",
        label: "Finalizing",
        labelKey: "historyStatus.finalizing",
        tone: "info",
        detail: "Applying the completion results safely.",
        detailKey: "historyStatusDetail.finalizing",
      });

    case BULK_EDIT_EXECUTION_STATES.COMPLETED:
      return buildStatusSummary({
        key: "completed",
        label: "Completed",
        labelKey: "historyStatus.completed",
        tone: "success",
        isTerminal: true,
      });

    case BULK_EDIT_EXECUTION_STATES.PARTIAL:
      return buildStatusSummary({
        key: "partial",
        label: "Partially completed",
        labelKey: "historyStatus.partial",
        tone: "attention",
        detail: "Some batches finished, but errors were recorded.",
        detailKey: "historyStatusDetail.partial",
        isTerminal: true,
      });

    case BULK_EDIT_EXECUTION_STATES.FAILED:
      return buildStatusSummary({
        key: "failed",
        label: "Failed",
        labelKey: "historyStatus.failed",
        tone: "critical",
        isTerminal: true,
      });

    case BULK_EDIT_EXECUTION_STATES.CANCELLED:
      return buildStatusSummary({
        key: "cancelled",
        label: "Cancelled",
        labelKey: "historyStatus.cancelled",
        tone: "critical",
        isTerminal: true,
      });

    default: {
      const legacy = normalizeLegacyEditStatus(status);

      if (legacy === "processing") {
        return buildStatusSummary({
          key: "processing",
          label: "Processing",
          labelKey: "historyStatus.processing",
          tone: "info",
          detail: "Execution is still running.",
          detailKey: "historyStatusDetail.processing",
        });
      }

      return buildStatusSummary({
        key: "pending",
        label: "Pending",
        labelKey: "historyStatus.pending",
        tone: "attention",
      });
    }
  }
}

function mapBulkUndoSummary(undoValue) {
  const undo = normalizeUndoState(undoValue, {
    allowed: false,
    status: "idle",
    state: BULK_UNDO_STATES.PLANNED,
    processedCount: 0,
    error: null,
  });

  const state = undo.state || BULK_UNDO_STATES.PLANNED;

  switch (state) {
    case BULK_UNDO_STATES.QUEUED:
      return buildStatusSummary({
        key: "undo_queued",
        label: "Undo queued",
        labelKey: "historyStatus.undo_queued",
        tone: "attention",
        detail: "Waiting to undo this edit safely.",
        detailKey: "historyStatusDetail.undo_queued",
      });

    case BULK_UNDO_STATES.DISPATCHING:
      return buildStatusSummary({
        key: "undo_dispatching",
        label: "Undo dispatching",
        labelKey: "historyStatus.undo_dispatching",
        tone: "info",
        detail: "Preparing the undo mutation batch.",
        detailKey: "historyStatusDetail.undo_dispatching",
      });

    case BULK_UNDO_STATES.AWAITING_SHOPIFY:
      return buildStatusSummary({
        key: "undo_awaiting_shopify",
        label: "Undo running in Shopify",
        labelKey: "historyStatus.undo_awaiting_shopify",
        tone: "info",
        detail: "Waiting for Shopify undo completion.",
        detailKey: "historyStatusDetail.undo_awaiting_shopify",
      });

    case BULK_UNDO_STATES.FINALIZING:
      return buildStatusSummary({
        key: "undo_finalizing",
        label: "Undo finalizing",
        labelKey: "historyStatus.undo_finalizing",
        tone: "info",
        detail: "Applying undo completion results safely.",
        detailKey: "historyStatusDetail.undo_finalizing",
      });

    case BULK_UNDO_STATES.COMPLETED:
      return buildStatusSummary({
        key: "undo_completed",
        label: "Undo completed",
        labelKey: "historyStatus.undo_completed",
        tone: "success",
        isTerminal: true,
      });

    case BULK_UNDO_STATES.PARTIAL:
      return buildStatusSummary({
        key: "undo_partial",
        label: "Undo partially completed",
        labelKey: "historyStatus.undo_partial",
        tone: "attention",
        detail: "Undo finished with recorded errors.",
        detailKey: "historyStatusDetail.undo_partial",
        isTerminal: true,
      });

    case BULK_UNDO_STATES.FAILED:
      return buildStatusSummary({
        key: "undo_failed",
        label: "Undo failed",
        labelKey: "historyStatus.undo_failed",
        tone: "critical",
        isTerminal: true,
      });

    case BULK_UNDO_STATES.CANCELLED:
      return buildStatusSummary({
        key: "undo_cancelled",
        label: "Undo cancelled",
        labelKey: "historyStatus.undo_cancelled",
        tone: "critical",
        isTerminal: true,
      });

    default: {
      const legacyStatus = String(undo.status || "").toLowerCase();

      if (!legacyStatus || legacyStatus === "idle") {
        return null;
      }

      if (legacyStatus === "completed") {
        return buildStatusSummary({
          key: "undo_completed",
          label: "Undo completed",
          labelKey: "historyStatus.undo_completed",
          tone: "success",
          isTerminal: true,
        });
      }

      if (legacyStatus === "failed") {
        return buildStatusSummary({
          key: "undo_failed",
          label: "Undo failed",
          labelKey: "historyStatus.undo_failed",
          tone: "critical",
          isTerminal: true,
        });
      }

      return buildStatusSummary({
        key: "undo_processing",
        label: "Undo processing",
        labelKey: "historyStatus.undo_processing",
        tone: "info",
        detail: "Undo is still running.",
        detailKey: "historyStatusDetail.undo_processing",
      });
    }
  }
}

function buildProgressSummary({
  processedCount,
  totalItems,
  fallbackPercent = 0,
  statusLabel,
}) {
  const current = Number(processedCount || 0);
  const total = Number(totalItems || 0);
  const percent =
    total > 0
      ? Math.max(0, Math.min(100, Math.round((current / total) * 100)))
      : fallbackPercent;

  return {
    current,
    total,
    percent,
    label:
      total > 0
        ? `${current} / ${total}`
        : current > 0
        ? `${current}`
        : statusLabel,
  };
}

function getExportProgressPercent(executionState, processedCount, totalItems) {
  const exact = buildProgressSummary({
    processedCount,
    totalItems,
    fallbackPercent: 0,
    statusLabel: "Queued",
  }).percent;

  if (exact > 0) return exact;

  switch (executionState) {
    case EXPORT_EXECUTION_STATES.PLANNED:
    case EXPORT_EXECUTION_STATES.QUEUED:
      return 5;
    case EXPORT_EXECUTION_STATES.RUNNING:
      return 60;
    case EXPORT_EXECUTION_STATES.FINALIZING:
      return 90;
    case EXPORT_EXECUTION_STATES.COMPLETED:
      return 100;
    default:
      return 0;
  }
}

function mapExportExecutionSummary(executionState, status) {
  switch (executionState) {
    case EXPORT_EXECUTION_STATES.PLANNED:
    case EXPORT_EXECUTION_STATES.QUEUED:
      return buildStatusSummary({
        key: "queued",
        label: "Queued",
        labelKey: "historyStatus.queued",
        tone: "attention",
        detail: "Waiting for export execution.",
        detailKey: "historyStatusDetail.export_queued",
      });

    case EXPORT_EXECUTION_STATES.RUNNING:
      return buildStatusSummary({
        key: "running",
        label: "Building file",
        labelKey: "historyStatus.running",
        tone: "info",
        detail: "Export rows are being generated.",
        detailKey: "historyStatusDetail.export_running",
      });

    case EXPORT_EXECUTION_STATES.FINALIZING:
      return buildStatusSummary({
        key: "finalizing",
        label: "Uploading file",
        labelKey: "historyStatus.finalizing",
        tone: "info",
        detail: "Final file upload and completion write are in progress.",
        detailKey: "historyStatusDetail.export_finalizing",
      });

    case EXPORT_EXECUTION_STATES.COMPLETED:
      return buildStatusSummary({
        key: "completed",
        label: "Completed",
        labelKey: "historyStatus.completed",
        tone: "success",
        isTerminal: true,
      });

    case EXPORT_EXECUTION_STATES.PARTIAL:
      return buildStatusSummary({
        key: "partial",
        label: "Partially completed",
        labelKey: "historyStatus.partial",
        tone: "attention",
        detail: "The export finished with recorded issues.",
        detailKey: "historyStatusDetail.export_partial",
        isTerminal: true,
      });

    case EXPORT_EXECUTION_STATES.FAILED:
      return buildStatusSummary({
        key: "failed",
        label: "Failed",
        labelKey: "historyStatus.failed",
        tone: "critical",
        isTerminal: true,
      });

    case EXPORT_EXECUTION_STATES.CANCELLED:
      return buildStatusSummary({
        key: "cancelled",
        label: "Cancelled",
        labelKey: "historyStatus.cancelled",
        tone: "critical",
        isTerminal: true,
      });

    default: {
      const legacy = normalizeExportStatus(status);

      if (legacy === "processing") {
        return buildStatusSummary({
          key: "running",
          label: "Building file",
          labelKey: "historyStatus.running",
          tone: "info",
          detail: "Export rows are being generated.",
          detailKey: "historyStatusDetail.export_running",
        });
      }

      return buildStatusSummary({
        key: "pending",
        label: "Pending",
        labelKey: "historyStatus.pending",
        tone: "attention",
      });
    }
  }
}

export function projectEditHistoryStatus(record) {
  const executionState = record.executionState || null;
  const parentStatus = mapParentOperationStatus(record.status);
  const primaryStatus =
    parentStatus ||
    mapBulkEditExecutionSummary(
      executionState,
      record.status,
    );
  const undoStatus = mapBulkUndoSummary(record.undo);
  const errors = parseHistoryErrors(record.error);

  const undo = normalizeUndoState(record.undo, {
    allowed: false,
    status: "idle",
    state: BULK_UNDO_STATES.PLANNED,
    error: null,
    processedCount: 0,
  });

  const undoErrors = parseHistoryErrors(undo.error);
  const batch = record.batch && typeof record.batch === "object" ? record.batch : {};
  const lastRetryableError = errors
    .slice()
    .reverse()
    .find((entry) => entry?.retryable === true);
  const queuedForRetry = Boolean(
    batch.lastRetryableErrorAt || lastRetryableError,
  );

  const progress = buildProgressSummary({
    processedCount: record.processedCount,
    totalItems: record.targetSnapshotCount || record.totalItems,
    fallbackPercent: primaryStatus.key === "completed" ? 100 : 0,
    statusLabel: primaryStatus.label,
  });

  return {
    ...record,
    primaryStatus,
    undoStatusSummary: undoStatus,
    progressSummary: progress,
    progressCount: progress.current,
    displayStatus: primaryStatus.key,
    supportStatus: {
      executionState,
      failureStage: record.failureStage || null,
      executionIdentity: record.executionIdentity || null,
      targetSnapshotCount: Number(record.targetSnapshotCount || 0),
      targetMirrorBatchId: record.targetMirrorBatchId || null,
      queuedForRetry,
      retryMessage: queuedForRetry
        ? "Queued for retry. Will auto-complete when Shopify recovers."
        : null,
      lastRetryableErrorAt: batch.lastRetryableErrorAt || null,
      lastRetryableErrorCode:
        batch.lastRetryableErrorCode || lastRetryableError?.code || null,
      errors,
      lastError: errors[errors.length - 1] || null,
      undoState: undo.state || null,
      undoAllowed: Boolean(undo.allowed),
      undoErrors,
      lastUndoError: undoErrors[undoErrors.length - 1] || null,
    },
  };
}

export function projectExportHistoryStatus(record) {
  const executionState = record.executionState || null;
  const parentStatus = mapParentOperationStatus(record.status);
  const primaryStatus =
    parentStatus ||
    mapExportExecutionSummary(
      executionState,
      record.status,
    );
  const errors = parseSerializedExportError(record.error);

  const progress = buildProgressSummary({
    processedCount: record.processedCount || record.totalItems || 0,
    totalItems: record.targetSnapshotCount || record.totalItems || 0,
    fallbackPercent: getExportProgressPercent(
      executionState,
      record.processedCount || record.totalItems || 0,
      record.targetSnapshotCount || record.totalItems || 0,
    ),
    statusLabel: primaryStatus.label,
  });

  return {
    ...record,
    _id: record.id,
    primaryStatus,
    progressSummary: progress,
    progressPercent: progress.percent,
    displayStatus: primaryStatus.key,
    supportStatus: {
      executionState,
      failureStage: record.failureStage || null,
      targetSnapshotCount: Number(record.targetSnapshotCount || 0),
      targetMirrorBatchId: record.targetMirrorBatchId || null,
      errors,
      lastError: errors[errors.length - 1] || null,
    },
  };
}
