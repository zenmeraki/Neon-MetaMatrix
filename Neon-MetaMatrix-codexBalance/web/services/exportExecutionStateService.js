export const EXPORT_EXECUTION_STATES = {
  PLANNED: "planned",
  QUEUED: "queued",
  RUNNING: "running",
  FINALIZING: "finalizing",
  COMPLETED: "completed",
  FAILED: "failed",
  PARTIAL: "partial",
  CANCELLED: "cancelled",
};

export function isTerminalExportExecutionState(state) {
  return [
    EXPORT_EXECUTION_STATES.COMPLETED,
    EXPORT_EXECUTION_STATES.FAILED,
    EXPORT_EXECUTION_STATES.PARTIAL,
    EXPORT_EXECUTION_STATES.CANCELLED,
  ].includes(state);
}

export function buildExportExecutionError({
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

export function appendSerializedExportError(existingValue, nextEntry) {
  const existing = parseSerializedExportError(existingValue);
  return JSON.stringify([...existing, nextEntry]);
}

export function parseSerializedExportError(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [{ message: String(value) }];
  }
}
