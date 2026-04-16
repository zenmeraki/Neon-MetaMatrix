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

function withExecutionSummary(record) {
  if (!record?.executionSummary) {
    return record || {};
  }

  const { executionSummary, ...parent } = record;

  return {
    ...parent,
    ...executionSummary,
    id: parent.id,
    editHistoryId: parent.id,
    title: parent.title,
    type: parent.type,
    editTime: parent.editTime,
    createdAt: parent.createdAt,
    updatedAt: parent.updatedAt,
  };
}

function getHistoryTargetBatchMetadata(record) {
  const batchField = record?.batch?.batchField || "catalogBatchId";

  return {
    targetBatchField: batchField,
    targetCatalogBatchId:
      record?.targetCatalogBatchId || record?.targetMirrorBatchId || null,
  };
}

function buildStatusSummary({ key, label, tone, detail = null, isTerminal = false }) {
  return {
    key,
    label,
    tone,
    detail,
    isTerminal,
  };
}

function normalizeLegacyEditStatus(status) {
  return String(status || "").toLowerCase();
}

function normalizeExportStatus(status) {
  return String(status || "").toLowerCase();
}

function mapBulkEditExecutionSummary(executionState, status) {
  switch (executionState) {
    case BULK_EDIT_EXECUTION_STATES.PLANNED:
    case BULK_EDIT_EXECUTION_STATES.QUEUED:
      return buildStatusSummary({
        key: "queued",
        label: "Queued",
        tone: "attention",
        detail: "Waiting for execution.",
      });
    case BULK_EDIT_EXECUTION_STATES.DISPATCHING:
      return buildStatusSummary({
        key: "dispatching",
        label: "Dispatching",
        tone: "info",
        detail: "Preparing the next Shopify mutation batch.",
      });
    case BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY:
      return buildStatusSummary({
        key: "awaiting_shopify",
        label: "Running in Shopify",
        tone: "info",
        detail: "Waiting for Shopify bulk operation completion.",
      });
    case BULK_EDIT_EXECUTION_STATES.FINALIZING:
      return buildStatusSummary({
        key: "finalizing",
        label: "Finalizing",
        tone: "info",
        detail: "Applying the completion results safely.",
      });
    case BULK_EDIT_EXECUTION_STATES.COMPLETED:
      return buildStatusSummary({
        key: "completed",
        label: "Completed",
        tone: "success",
        isTerminal: true,
      });
    case BULK_EDIT_EXECUTION_STATES.PARTIAL:
        return buildStatusSummary({
          key: "partial",
          label: "Partially completed",
          tone: "attention",
          detail: "Some batches finished, but errors were recorded.",
          isTerminal: true,
        });
    case BULK_EDIT_EXECUTION_STATES.FAILED:
      return buildStatusSummary({
        key: "failed",
        label: "Failed",
        tone: "critical",
        isTerminal: true,
      });
    case BULK_EDIT_EXECUTION_STATES.FAILED_INTEGRITY_CHECK:
      return buildStatusSummary({
        key: "failed_integrity_check",
        label: "Failed integrity check",
        tone: "critical",
        detail: "The frozen catalog targets no longer match the local mirror.",
        isTerminal: true,
      });
    case BULK_EDIT_EXECUTION_STATES.CANCELLED:
      return buildStatusSummary({
        key: "cancelled",
        label: "Cancelled",
        tone: "critical",
        isTerminal: true,
      });
    default: {
      const legacy = normalizeLegacyEditStatus(status);
      if (legacy === "completed") {
        return buildStatusSummary({
          key: "completed",
          label: "Completed",
          tone: "success",
          isTerminal: true,
        });
      }
      if (legacy === "failed") {
        return buildStatusSummary({
          key: "failed",
          label: "Failed",
          tone: "critical",
          isTerminal: true,
        });
      }
      if (legacy === "processing") {
        return buildStatusSummary({
          key: "processing",
          label: "Processing",
          tone: "info",
          detail: "Execution is still running.",
        });
      }
      return buildStatusSummary({
        key: "pending",
        label: "Pending",
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
        tone: "attention",
        detail: "Waiting to undo this edit safely.",
      });
    case BULK_UNDO_STATES.DISPATCHING:
      return buildStatusSummary({
        key: "undo_dispatching",
        label: "Undo dispatching",
        tone: "info",
        detail: "Preparing the undo mutation batch.",
      });
    case BULK_UNDO_STATES.AWAITING_SHOPIFY:
      return buildStatusSummary({
        key: "undo_awaiting_shopify",
        label: "Undo running in Shopify",
        tone: "info",
        detail: "Waiting for Shopify undo completion.",
      });
    case BULK_UNDO_STATES.FINALIZING:
      return buildStatusSummary({
        key: "undo_finalizing",
        label: "Undo finalizing",
        tone: "info",
        detail: "Applying undo completion results safely.",
      });
    case BULK_UNDO_STATES.COMPLETED:
      return buildStatusSummary({
        key: "undo_completed",
        label: "Undo completed",
        tone: "success",
        isTerminal: true,
      });
    case BULK_UNDO_STATES.PARTIAL:
        return buildStatusSummary({
          key: "undo_partial",
          label: "Undo partially completed",
          tone: "attention",
          detail: "Undo finished with recorded errors.",
          isTerminal: true,
        });
    case BULK_UNDO_STATES.FAILED:
      return buildStatusSummary({
        key: "undo_failed",
        label: "Undo failed",
        tone: "critical",
        isTerminal: true,
      });
    case BULK_UNDO_STATES.CANCELLED:
      return buildStatusSummary({
        key: "undo_cancelled",
        label: "Undo cancelled",
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
          tone: "success",
          isTerminal: true,
        });
      }

      if (legacyStatus === "failed") {
        return buildStatusSummary({
          key: "undo_failed",
          label: "Undo failed",
          tone: "critical",
          isTerminal: true,
        });
      }

      return buildStatusSummary({
        key: "undo_processing",
        label: "Undo processing",
        tone: "info",
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
        tone: "attention",
        detail: "Waiting for export execution.",
      });
    case EXPORT_EXECUTION_STATES.RUNNING:
      return buildStatusSummary({
        key: "running",
        label: "Building file",
        tone: "info",
        detail: "Export rows are being generated.",
      });
    case EXPORT_EXECUTION_STATES.FINALIZING:
      return buildStatusSummary({
        key: "finalizing",
        label: "Uploading file",
        tone: "info",
        detail: "Final file upload and completion write are in progress.",
      });
    case EXPORT_EXECUTION_STATES.COMPLETED:
      return buildStatusSummary({
        key: "completed",
        label: "Completed",
        tone: "success",
        isTerminal: true,
      });
    case EXPORT_EXECUTION_STATES.PARTIAL:
        return buildStatusSummary({
          key: "partial",
          label: "Partially completed",
          tone: "attention",
          detail: "The export finished with recorded issues.",
          isTerminal: true,
        });
    case EXPORT_EXECUTION_STATES.FAILED:
      return buildStatusSummary({
        key: "failed",
        label: "Failed",
        tone: "critical",
        isTerminal: true,
      });
    case EXPORT_EXECUTION_STATES.CANCELLED:
      return buildStatusSummary({
        key: "cancelled",
        label: "Cancelled",
        tone: "critical",
        isTerminal: true,
      });
    default: {
      const legacy = normalizeExportStatus(status);
      if (legacy === "completed") {
        return buildStatusSummary({
          key: "completed",
          label: "Completed",
          tone: "success",
          isTerminal: true,
        });
      }
      if (legacy === "failed") {
        return buildStatusSummary({
          key: "failed",
          label: "Failed",
          tone: "critical",
          isTerminal: true,
        });
      }
      if (legacy === "processing") {
        return buildStatusSummary({
          key: "running",
          label: "Building file",
          tone: "info",
        });
      }
      return buildStatusSummary({
        key: "pending",
        label: "Pending",
        tone: "attention",
      });
    }
  }
}

export function projectEditHistoryStatus(record) {
  record = withExecutionSummary(record);
  const executionState = record.executionState || null;
  const primaryStatus = mapBulkEditExecutionSummary(executionState, record.status);
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
  const progress = buildProgressSummary({
    processedCount: record.processedCount,
    totalItems: record.targetSnapshotCount || record.totalItems,
    fallbackPercent: primaryStatus.key === "completed" ? 100 : 0,
    statusLabel: primaryStatus.label,
  });

  return {
    ...record,
    ...getHistoryTargetBatchMetadata(record),
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
      targetCatalogBatchId:
        record.targetCatalogBatchId || record.targetMirrorBatchId || null,
      targetMirrorBatchId: record.targetMirrorBatchId || null,
      ...getHistoryTargetBatchMetadata(record),
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
  record = withExecutionSummary(record);
  const executionState = record.executionState || null;
  const primaryStatus = mapExportExecutionSummary(executionState, record.status);
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
    ...getHistoryTargetBatchMetadata(record),
    primaryStatus,
    progressSummary: progress,
    progressPercent: progress.percent,
    displayStatus: primaryStatus.key,
    supportStatus: {
      executionState,
      failureStage: record.failureStage || null,
      targetSnapshotCount: Number(record.targetSnapshotCount || 0),
      targetCatalogBatchId:
        record.targetCatalogBatchId || record.targetMirrorBatchId || null,
      targetMirrorBatchId: record.targetMirrorBatchId || null,
      ...getHistoryTargetBatchMetadata(record),
      errors,
      lastError: errors[errors.length - 1] || null,
    },
  };
}
