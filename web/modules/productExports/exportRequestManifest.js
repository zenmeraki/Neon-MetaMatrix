import { stableHash } from "../../utils/idempotencyKey.js";

export function buildExportManifest({
  shop,
  source,
  preset,
  filename,
  resolvedFields,
  targetSnapshotId,
  plannerFingerprint,
  mirrorBatchId,
}) {
  return {
    type: "PRODUCT_EXPORT",
    shop,
    source,
    preset: String(preset || "custom"),
    filename,
    fields: Array.isArray(resolvedFields) ? [...resolvedFields] : [],
    targetSnapshotId,
    plannerFingerprint: plannerFingerprint || null,
    mirrorBatchId: mirrorBatchId || null,
  };
}

export function buildExportIdempotencyKey(manifest) {
  return `export:${stableHash(manifest)}`;
}

export function isExportDownloadReady(result) {
  return Boolean(result?.fileUrl);
}

