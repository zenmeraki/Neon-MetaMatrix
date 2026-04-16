-- Schema-wide naming contract guardrails.
--
-- Contract:
-- - timestamps: createdAt, updatedAt, startedAt, completedAt, activatedAt, scheduledFor
-- - durations: durationMs
-- - counts: rowCount, targetCount, processedCount, affectedCount
-- - statuses: explicit finite vocabularies
-- - type fields: domain-specific names such as runType, artifactType,
--   triggerType, mutationType, scopeType
--
-- Constraints are NOT VALID so historical drift does not block deploy, but new
-- or updated rows are checked immediately.

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_status_enum_ck"
  CHECK ("status" IN ('ACTIVE', 'ARCHIVED', 'DRAFT')) NOT VALID;

ALTER TABLE "SyncRun"
  ADD CONSTRAINT "SyncRun_status_enum_ck"
  CHECK ("status" IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')) NOT VALID,
  ADD CONSTRAINT "SyncRun_rowCount_nonnegative_ck"
  CHECK ("rowCount" IS NULL OR "rowCount" >= 0) NOT VALID,
  ADD CONSTRAINT "SyncRun_durationMs_nonnegative_ck"
  CHECK ("durationMs" IS NULL OR "durationMs" >= 0) NOT VALID;

ALTER TABLE "SyncArtifact"
  ADD CONSTRAINT "SyncArtifact_rowCount_nonnegative_ck"
  CHECK ("rowCount" IS NULL OR "rowCount" >= 0) NOT VALID;

ALTER TABLE "CatalogSnapshot"
  ADD CONSTRAINT "CatalogSnapshot_status_enum_ck"
  CHECK ("status" IN ('BUILDING', 'ACTIVE', 'SUPERSEDED', 'FAILED')) NOT VALID;

ALTER TABLE "DomainFreshness"
  ADD CONSTRAINT "DomainFreshness_status_enum_ck"
  CHECK ("status" IN ('FRESH', 'RUNNING', 'STALE', 'REPAIR_REQUIRED', 'UNKNOWN')) NOT VALID;

ALTER TABLE "FieldAuthorityRegistry"
  ADD CONSTRAINT "FieldAuthorityRegistry_status_enum_ck"
  CHECK ("status" IN ('ACTIVE', 'DEPRECATED', 'DISABLED')) NOT VALID;

ALTER TABLE "TargetSnapshotSet"
  ADD CONSTRAINT "TargetSnapshotSet_status_enum_ck"
  CHECK ("status" IN ('BUILDING', 'ACTIVE', 'SUPERSEDED', 'FAILED')) NOT VALID,
  ADD CONSTRAINT "TargetSnapshotSet_targetCount_nonnegative_ck"
  CHECK ("targetCount" >= 0) NOT VALID,
  ADD CONSTRAINT "TargetSnapshotSet_ownerType_enum_ck"
  CHECK ("ownerType" IN ('EDIT_HISTORY', 'EXPORT_JOB')) NOT VALID,
  ADD CONSTRAINT "TargetSnapshotSet_sourceType_enum_ck"
  CHECK ("sourceType" IS NULL OR "sourceType" IN ('FILTER', 'EXPLICIT')) NOT VALID,
  ADD CONSTRAINT "TargetSnapshotSet_targetLevel_enum_ck"
  CHECK ("targetLevel" IN ('PRODUCT', 'VARIANT')) NOT VALID;

ALTER TABLE "BulkMutationSubmission"
  ADD CONSTRAINT "BulkMutationSubmission_status_enum_ck"
  CHECK ("status" IN ('PLANNED', 'SUBMITTED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')) NOT VALID,
  ADD CONSTRAINT "BulkMutationSubmission_rowCount_nonnegative_ck"
  CHECK ("rowCount" IS NULL OR "rowCount" >= 0) NOT VALID,
  ADD CONSTRAINT "BulkMutationSubmission_failureCategory_enum_ck"
  CHECK ("failureCategory" IS NULL OR "failureCategory" IN ('INTERNAL', 'SHOPIFY', 'VALIDATION', 'TIMEOUT', 'CONCURRENCY')) NOT VALID;

ALTER TABLE "BulkMutationOutcome"
  ADD CONSTRAINT "BulkMutationOutcome_status_enum_ck"
  CHECK ("status" IN ('SUCCESS', 'FAILED', 'SKIPPED')) NOT VALID;

ALTER TABLE "EditHistory"
  ADD CONSTRAINT "EditHistory_status_enum_ck"
  CHECK ("status" IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'partial')) NOT VALID,
  ADD CONSTRAINT "EditHistory_targetSnapshotCount_nonnegative_ck"
  CHECK ("targetSnapshotCount" >= 0) NOT VALID,
  ADD CONSTRAINT "EditHistory_processedCount_nonnegative_ck"
  CHECK ("processedCount" >= 0) NOT VALID,
  ADD CONSTRAINT "EditHistory_durationMs_nonnegative_ck"
  CHECK ("durationMs" >= 0) NOT VALID,
  ADD CONSTRAINT "EditHistory_targetLevel_enum_ck"
  CHECK ("targetLevel" IS NULL OR "targetLevel" IN ('PRODUCT', 'VARIANT')) NOT VALID;

ALTER TABLE "BulkEditJobOutbox"
  ADD CONSTRAINT "BulkEditJobOutbox_status_enum_ck"
  CHECK ("status" IN ('PENDING', 'DISPATCHING', 'DISPATCHED', 'FAILED_RETRYABLE', 'FAILED')) NOT VALID;

ALTER TABLE "AutomaticProductRuleRun"
  ADD CONSTRAINT "AutomaticProductRuleRun_affectedCount_nonnegative_ck"
  CHECK ("affectedCount" >= 0) NOT VALID;

ALTER TABLE "ScheduledExportRun"
  ADD CONSTRAINT "ScheduledExportRun_durationMs_nonnegative_ck"
  CHECK ("durationMs" IS NULL OR "durationMs" >= 0) NOT VALID;

ALTER TABLE "ExportJob"
  ADD CONSTRAINT "ExportJob_status_enum_ck"
  CHECK ("status" IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'PARTIAL')) NOT VALID,
  ADD CONSTRAINT "ExportJob_targetSnapshotCount_nonnegative_ck"
  CHECK ("targetSnapshotCount" >= 0) NOT VALID,
  ADD CONSTRAINT "ExportJob_durationMs_nonnegative_ck"
  CHECK ("durationMs" IS NULL OR "durationMs" >= 0) NOT VALID;

ALTER TABLE "ChangeRecord"
  ADD CONSTRAINT "ChangeRecord_status_enum_ck"
  CHECK ("status" IN ('pending', 'processing', 'completed', 'failed', 'SUCCEEDED', 'PARTIAL', 'SKIPPED')) NOT VALID;

ALTER TABLE "MirrorAnomaly"
  ADD CONSTRAINT "MirrorAnomaly_severity_enum_ck"
  CHECK ("severity" IN ('low', 'medium', 'high', 'critical')) NOT VALID;

ALTER TABLE "MirrorReconcileSignal"
  ADD CONSTRAINT "MirrorReconcileSignal_status_enum_ck"
  CHECK ("status" IN ('pending', 'processing', 'pendingActivation', 'completed', 'failed')) NOT VALID;

ALTER TABLE "OperationFingerprint"
  ADD CONSTRAINT "OperationFingerprint_status_enum_ck"
  CHECK ("status" IN ('RESERVED', 'CONSUMED', 'FAILED')) NOT VALID;

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_status_enum_ck"
  CHECK ("status" IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'SKIPPED')) NOT VALID;

COMMENT ON COLUMN "SyncHistory"."duration" IS
  'LEGACY NAME: use durationMs on new lifecycle tables.';
COMMENT ON COLUMN "SyncHistory"."recordCount" IS
  'LEGACY NAME: use rowCount for input/output row counts.';
COMMENT ON COLUMN "EditHistory"."type" IS
  'LEGACY UI label. New workflow discriminators must use domain-specific names such as triggerType, mutationType, scopeType, or runType.';
COMMENT ON COLUMN "ExportHistory"."duration" IS
  'LEGACY NAME: use durationMs on new export/run tables.';
COMMENT ON COLUMN "ExportHistory"."type" IS
  'LEGACY UI label. New export discriminators must use triggerType.';
COMMENT ON COLUMN "ExportJob"."type" IS
  'LEGACY UI label. New export discriminators must use triggerType.';
COMMENT ON COLUMN "ErrorLog"."type" IS
  'LEGACY log category. New operational workflows should use domain-specific *Type fields.';
COMMENT ON COLUMN "MirrorAnomaly"."type" IS
  'LEGACY anomaly category. New anomaly producers should migrate to anomalyType in an additive compatibility migration.';
