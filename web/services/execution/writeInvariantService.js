export function assertWriteInvariant({
  operation,
  lockResult,
  idempotencyKey,
  snapshotFrozen,
}) {
  if (!operation?.id) {
    const error = new Error("Write operation requires an operation ledger entry.");
    error.code = "WRITE_OPERATION_REQUIRED";
    throw error;
  }

  if (!idempotencyKey && !operation.idempotencyKey) {
    const error = new Error("Write operation requires an idempotency key.");
    error.code = "IDEMPOTENCY_KEY_REQUIRED";
    throw error;
  }

  if (!lockResult?.acquired && !operation.lockKey) {
    const error = new Error("Write operation requires an acquired lock.");
    error.code = "WRITE_LOCK_REQUIRED";
    throw error;
  }

  if (!snapshotFrozen) {
    const error = new Error("Write operation requires a frozen target snapshot.");
    error.code = "SNAPSHOT_REQUIRED";
    throw error;
  }
}
