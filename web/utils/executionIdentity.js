export function toQueueExecutionId(value, fallbackId = null) {
  if (value && typeof value === "object") {
    return value.executionId || value.executionIdentity || value.id || fallbackId || null;
  }

  return value || fallbackId || null;
}

export function buildQueueExecutionPayload(basePayload = {}, executionSource = null) {
  return {
    ...basePayload,
    executionId: toQueueExecutionId(
      executionSource || basePayload.executionId || null,
      basePayload.historyId || basePayload.exportJobId || basePayload.id || null,
    ),
  };
}
