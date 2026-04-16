ALTER TABLE "TargetSnapshotSet"
  ADD COLUMN IF NOT EXISTS "targetLevel" TEXT NOT NULL DEFAULT 'PRODUCT',
  ADD COLUMN IF NOT EXISTS "filterVersion" INTEGER,
  ADD COLUMN IF NOT EXISTS "canonicalFilterKey" TEXT,
  ADD COLUMN IF NOT EXISTS "compiledWhereHash" TEXT,
  ADD COLUMN IF NOT EXISTS "rulesHash" TEXT,
  ADD COLUMN IF NOT EXISTS "ruleEngineVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "filterAnchorTime" TIMESTAMP(3);

ALTER TABLE "TargetSnapshotItem"
  ADD COLUMN IF NOT EXISTS "targetKey" TEXT;

UPDATE "TargetSnapshotItem"
SET "targetKey" = CASE
  WHEN "variantId" IS NULL THEN 'product:' || "productId"
  ELSE 'variant:' || "variantId"
END
WHERE "targetKey" IS NULL;

ALTER TABLE "TargetSnapshotItem"
  ALTER COLUMN "targetKey" SET NOT NULL;

ALTER TABLE "BulkMutationSubmission"
  ADD COLUMN IF NOT EXISTS "targetSnapshotSetId" TEXT,
  ADD COLUMN IF NOT EXISTS "batchId" TEXT,
  ADD COLUMN IF NOT EXISTS "inputArtifactSha256" TEXT,
  ADD COLUMN IF NOT EXISTS "inputRowHash" TEXT;

ALTER TABLE "EditHistory"
  ADD COLUMN IF NOT EXISTS "targetSnapshotSetId" TEXT,
  ADD COLUMN IF NOT EXISTS "rulesHash" TEXT,
  ADD COLUMN IF NOT EXISTS "ruleEngineVersion" TEXT;

ALTER TABLE "ExportJob"
  ADD COLUMN IF NOT EXISTS "targetSnapshotSetId" TEXT;

ALTER TABLE "ChangeRecord"
  ADD COLUMN IF NOT EXISTS "variantId" TEXT,
  ADD COLUMN IF NOT EXISTS "targetKey" TEXT,
  ADD COLUMN IF NOT EXISTS "bulkMutationSubmissionId" TEXT;

CREATE INDEX IF NOT EXISTS "TargetSnapshotSet_shop_owner_status_idx"
  ON "TargetSnapshotSet"("shop", "ownerType", "ownerId", "status");

CREATE INDEX IF NOT EXISTS "TargetSnapshotSet_shop_canonicalFilterKey_idx"
  ON "TargetSnapshotSet"("shop", "canonicalFilterKey");

CREATE UNIQUE INDEX IF NOT EXISTS "TargetSnapshotItem_targetSnapshotSetId_targetKey_key"
  ON "TargetSnapshotItem"("targetSnapshotSetId", "targetKey");

CREATE INDEX IF NOT EXISTS "TargetSnapshotItem_shop_variantId_idx"
  ON "TargetSnapshotItem"("shop", "variantId");

CREATE INDEX IF NOT EXISTS "BulkMutationSubmission_targetSnapshotSetId_idx"
  ON "BulkMutationSubmission"("targetSnapshotSetId");

CREATE UNIQUE INDEX IF NOT EXISTS "BulkMutationSubmission_editHistoryId_batchId_key"
  ON "BulkMutationSubmission"("editHistoryId", "batchId")
  WHERE "editHistoryId" IS NOT NULL AND "batchId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "EditHistory_targetSnapshotSetId_idx"
  ON "EditHistory"("targetSnapshotSetId");

CREATE INDEX IF NOT EXISTS "ExportJob_targetSnapshotSetId_idx"
  ON "ExportJob"("targetSnapshotSetId");

CREATE INDEX IF NOT EXISTS "ChangeRecord_variantId_idx"
  ON "ChangeRecord"("variantId");

CREATE INDEX IF NOT EXISTS "ChangeRecord_targetKey_idx"
  ON "ChangeRecord"("targetKey");

CREATE INDEX IF NOT EXISTS "ChangeRecord_bulkMutationSubmissionId_idx"
  ON "ChangeRecord"("bulkMutationSubmissionId");
