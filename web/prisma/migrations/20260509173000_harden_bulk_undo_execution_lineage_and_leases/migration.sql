ALTER TABLE "BulkUndoExecution"
ADD COLUMN IF NOT EXISTS "resultChecksum" TEXT,
ADD COLUMN IF NOT EXISTS "resultsAppliedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "leaseOwner" TEXT,
ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "heartbeatAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lockVersion" BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "BulkUndoExecution_shop_leaseOwner_leaseExpiresAt_idx"
  ON "BulkUndoExecution"("shop", "leaseOwner", "leaseExpiresAt");
