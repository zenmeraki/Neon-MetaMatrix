ALTER TABLE "BulkMutationSubmission"
  ADD COLUMN IF NOT EXISTS "failureCategory" TEXT,
  ADD COLUMN IF NOT EXISTS "failureStage" TEXT,
  ADD COLUMN IF NOT EXISTS "retryable" BOOLEAN;
