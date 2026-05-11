export const AUTHORITATIVE_MODELS = Object.freeze([
  "MerchantOperation",
  "OperationExecution",
  "OperationSubmission",
  "TargetSnapshotSet",
  "ImmutableTargetSnapshotSet",
  "TargetSnapshot",
  "ImmutableTargetSnapshotItem",
  "ChangeRecord",
  "ExportArtifact",
]);

export const PROJECTION_MODELS = Object.freeze([
  "EditHistory",
  "ExportHistory",
  "ExportJob",
  "BulkUndoExecution",
  "StoreOperation",
]);

const AUTHORITATIVE_SET = new Set(AUTHORITATIVE_MODELS);
const PROJECTION_SET = new Set(PROJECTION_MODELS);

export function isAuthoritativeModel(name) {
  return AUTHORITATIVE_SET.has(String(name || ""));
}

export function isProjectionModel(name) {
  return PROJECTION_SET.has(String(name || ""));
}

