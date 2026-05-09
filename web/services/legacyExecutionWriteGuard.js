const LEGACY_EXECUTION_FIELDS_BY_MODEL = {
  editHistory: new Set(["status", "executionState"]),
  exportJob: new Set(["status", "executionState"]),
  bulkUndoExecution: new Set(["state"]),
  storeOperation: new Set(["status"]),
  bulkMutationSubmission: new Set(["status"]),
};

export function assertLegacyExecutionProjectionWrite({
  model,
  data,
  reason,
}) {
  const guardedFields = LEGACY_EXECUTION_FIELDS_BY_MODEL[model];
  if (!guardedFields || !data || typeof data !== "object") return;

  const touchesGuardedField = Object.keys(data).some((key) =>
    guardedFields.has(key),
  );

  if (!touchesGuardedField) return;

  if (!reason || typeof reason !== "string" || !reason.trim()) {
    throw new Error(
      `LEGACY_EXECUTION_PROJECTION_REQUIRED:${model}`,
    );
  }
}

