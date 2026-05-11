import crypto from "crypto";
import { stableCanonicalStringify } from "./stableCanonicalStringify.js";

export function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(stableCanonicalStringify(value))
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
