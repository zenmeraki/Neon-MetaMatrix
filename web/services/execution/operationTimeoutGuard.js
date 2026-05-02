const DEFAULT_MAX_OPERATION_RUNTIME_MS = 60 * 60 * 1000;

export function getMaxOperationRuntimeMs() {
  const parsed = Number(process.env.MAX_OPERATION_RUNTIME_MS);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_OPERATION_RUNTIME_MS;
}

export function assertOperationNotTimedOut(operation, maxRuntimeMs = getMaxOperationRuntimeMs()) {
  if (!operation?.startedAt) return;

  const startedAt = new Date(operation.startedAt).getTime();
  if (!Number.isFinite(startedAt)) return;

  if (Date.now() - startedAt > maxRuntimeMs) {
    const error = new Error("OPERATION_TIMEOUT");
    error.code = "OPERATION_TIMEOUT";
    error.operationId = operation.id;
    error.maxRuntimeMs = maxRuntimeMs;
    throw error;
  }
}
