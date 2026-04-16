-- Make catalogBatchId the declared authority for targeting/execution identity.
-- mirrorBatchId remains only as a storage/legacy compatibility bridge while
-- old rows and older workers drain.

ALTER TABLE "EditHistory"
  ADD COLUMN IF NOT EXISTS "targetCatalogBatchId" TEXT;

ALTER TABLE "ExportJob"
  ADD COLUMN IF NOT EXISTS "targetCatalogBatchId" TEXT;

UPDATE "EditHistory"
SET "targetCatalogBatchId" = "targetMirrorBatchId"
WHERE "targetCatalogBatchId" IS NULL
  AND "targetMirrorBatchId" IS NOT NULL;

UPDATE "ExportJob"
SET "targetCatalogBatchId" = "targetMirrorBatchId"
WHERE "targetCatalogBatchId" IS NULL
  AND "targetMirrorBatchId" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "EditHistory_targetCatalogBatchId_idx"
  ON "EditHistory" ("targetCatalogBatchId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ExportJob_targetCatalogBatchId_idx"
  ON "ExportJob" ("targetCatalogBatchId");

ALTER TABLE "TargetSnapshotSet"
  ADD CONSTRAINT "TargetSnapshotSet_catalog_mirror_batch_match"
  CHECK (
    "mirrorBatchId" IS NULL
    OR "catalogBatchId" IS NULL
    OR "mirrorBatchId" = "catalogBatchId"
  ) NOT VALID;

ALTER TABLE "EditHistory"
  ADD CONSTRAINT "EditHistory_target_catalog_mirror_batch_match"
  CHECK (
    "targetMirrorBatchId" IS NULL
    OR "targetCatalogBatchId" IS NULL
    OR "targetMirrorBatchId" = "targetCatalogBatchId"
  ) NOT VALID;

ALTER TABLE "ExportJob"
  ADD CONSTRAINT "ExportJob_target_catalog_mirror_batch_match"
  CHECK (
    "targetMirrorBatchId" IS NULL
    OR "targetCatalogBatchId" IS NULL
    OR "targetMirrorBatchId" = "targetCatalogBatchId"
  ) NOT VALID;

COMMENT ON COLUMN "Product"."catalogBatchId" IS
  'Authoritative active catalog batch identity for product read-plane filtering and targeting.';
COMMENT ON COLUMN "Product"."mirrorBatchId" IS
  'Legacy storage/primary-key bridge. Do not use for new targeting, export, preview, or execution filtering.';
COMMENT ON COLUMN "Variant"."catalogBatchId" IS
  'Authoritative active catalog batch identity for variant read-plane filtering and targeting.';
COMMENT ON COLUMN "Variant"."mirrorBatchId" IS
  'Legacy Product relation/primary-key bridge. Do not use for new targeting, export, preview, or execution filtering.';
COMMENT ON COLUMN "Store"."activeMirrorBatchId" IS
  'Legacy compatibility cache only. SyncRun/CatalogSnapshot/ActiveCatalogSnapshot own runtime catalog truth.';
COMMENT ON COLUMN "Store"."activeCollectionBatchId" IS
  'Legacy compatibility cache only. ActiveCatalogSnapshot and DomainFreshness own runtime catalog truth.';
COMMENT ON COLUMN "TargetSnapshotSet"."catalogBatchId" IS
  'Authoritative batch identity for frozen targeting.';
COMMENT ON COLUMN "TargetSnapshotSet"."mirrorBatchId" IS
  'Legacy compatibility alias only; must match catalogBatchId when present.';
COMMENT ON COLUMN "EditHistory"."targetCatalogBatchId" IS
  'Authoritative batch identity for edit targeting and execution.';
COMMENT ON COLUMN "EditHistory"."targetMirrorBatchId" IS
  'Legacy compatibility alias only; must match targetCatalogBatchId when present.';
COMMENT ON COLUMN "ExportJob"."targetCatalogBatchId" IS
  'Authoritative batch identity for export targeting and execution.';
COMMENT ON COLUMN "ExportJob"."targetMirrorBatchId" IS
  'Legacy compatibility alias only; must match targetCatalogBatchId when present.';
