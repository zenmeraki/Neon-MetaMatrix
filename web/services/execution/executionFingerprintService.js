import { stableHash } from "../../utils/idempotencyKey.js";
import {
  computeFrozenTargetIdsHash,
  getFrozenTargetSnapshotSummary,
} from "../productService/productTargetingService.js";

function fingerprintError(code, message, details = null) {
  const err = new Error(message || code);
  err.code = code;
  err.statusCode = 409;
  err.details = details;
  return err;
}

export async function verifyExecutionFingerprint({
  shop,
  ownerType = "AD_HOC_PRODUCT_TARGET",
  targetSnapshotId,
  expectedExecutionFingerprint,
  actionPayload = {},
  fieldVersionPayload = {},
  mirrorBatchId = null,
  canonicalFilterAstHash = null,
}) {
  const expected = String(expectedExecutionFingerprint || "").trim();
  if (!expected) {
    throw fingerprintError(
      "EXECUTION_FINGERPRINT_REQUIRED",
      "executionFingerprint is required to start execution",
    );
  }

  const target = await getFrozenTargetSnapshotSummary({
    ownerType,
    ownerId: targetSnapshotId,
    shop,
  });

  const targetIdsHash = await computeFrozenTargetIdsHash({
    ownerType,
    ownerId: targetSnapshotId,
    shop,
  });
  const actionHash = stableHash(actionPayload || {});
  const fieldVersionHash = stableHash(fieldVersionPayload || {});
  const resolvedMirrorBatchId = mirrorBatchId || target?.mirrorBatchId || null;
  const resolvedCanonicalFilterAstHash =
    canonicalFilterAstHash ||
    target?.canonicalQueryHash ||
    target?.plannerFingerprint ||
    null;

  const computed = stableHash({
    shop,
    activeMirrorBatchId: resolvedMirrorBatchId,
    canonicalFilterAstHash: resolvedCanonicalFilterAstHash,
    actionHash,
    targetIdsHash,
    fieldVersionHash,
  });

  if (computed !== expected) {
    throw fingerprintError(
      "EXECUTION_FINGERPRINT_MISMATCH",
      "Execution fingerprint changed. Re-preview is required.",
      {
        expectedExecutionFingerprint: expected,
        computedExecutionFingerprint: computed,
      },
    );
  }

  return {
    executionFingerprint: computed,
    actionHash,
    targetIdsHash,
    fieldVersionHash,
  };
}

