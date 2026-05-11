export function codedReplayError(code, message = code, statusCode = 409, details = null) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  err.details = details;
  return err;
}

export function assertReplayExecuteRequiresSnapshot({ targetSnapshotId }) {
  const normalized = typeof targetSnapshotId === "string" ? targetSnapshotId.trim() : "";
  if (!normalized) {
    throw codedReplayError(
      "IMMUTABLE_TARGET_REQUIRED",
      "Replay execution requires targetSnapshotId",
      409,
    );
  }
  return normalized;
}

export function diffTargetIds(previousIds = new Set(), currentIds = new Set()) {
  const prev = previousIds instanceof Set ? previousIds : new Set();
  const next = currentIds instanceof Set ? currentIds : new Set();
  const added = [];
  const removed = [];
  for (const id of next) {
    if (!prev.has(id)) added.push(id);
  }
  for (const id of prev) {
    if (!next.has(id)) removed.push(id);
  }
  return {
    previousTargetCount: prev.size,
    currentTargetCount: next.size,
    addedCount: added.length,
    removedCount: removed.length,
    addedSample: added.slice(0, 20),
    removedSample: removed.slice(0, 20),
  };
}

