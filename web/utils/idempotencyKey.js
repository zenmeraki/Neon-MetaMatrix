import crypto from "crypto";

export function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

export function buildBulkEditIdempotencyKey({
  shop,
  userId,
  targetHash,
  editPayload,
  clientRequestId,
}) {
  return stableHash({
    type: "BULK_EDIT",
    shop,
    userId,
    targetHash,
    editPayload,
    clientRequestId,
  });
}

export function buildScheduledRunIdempotencyKey({
  shop,
  scheduleId,
  scheduledFor,
}) {
  return stableHash({
    type: "SCHEDULED_EDIT",
    shop,
    scheduleId,
    scheduledFor,
  });
}
