ALTER TABLE "BulkMutationOutcome"
  ADD COLUMN IF NOT EXISTS "targetSnapshotSetId" TEXT,
  ADD COLUMN IF NOT EXISTS "catalogBatchId" TEXT,
  ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;

UPDATE "BulkMutationOutcome" outcome
SET
  "targetSnapshotSetId" = submission."targetSnapshotSetId",
  "catalogBatchId" = submission."batchId",
  "dedupeKey" = outcome."id"
FROM "BulkMutationSubmission" submission
WHERE outcome."bulkMutationSubmissionId" = submission."id"
  AND outcome."dedupeKey" IS NULL;

UPDATE "BulkMutationOutcome"
SET "status" = 'SUCCESS'
WHERE "status" = 'SUCCEEDED';

UPDATE "BulkMutationOutcome"
SET "status" = 'FAILED'
WHERE "status" = 'PARTIAL';

CREATE INDEX IF NOT EXISTS "BulkMutationOutcome_targetSnapshotSetId_idx"
  ON "BulkMutationOutcome"("targetSnapshotSetId");

CREATE INDEX IF NOT EXISTS "BulkMutationOutcome_catalogBatchId_idx"
  ON "BulkMutationOutcome"("catalogBatchId");

CREATE UNIQUE INDEX IF NOT EXISTS "BulkMutationOutcome_submission_dedupeKey_key"
  ON "BulkMutationOutcome"("bulkMutationSubmissionId", "dedupeKey");
