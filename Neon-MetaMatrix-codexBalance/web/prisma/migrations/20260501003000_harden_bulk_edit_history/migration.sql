ALTER TABLE "EditHistory"
ADD COLUMN IF NOT EXISTS "executionLeaseUntil" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "executionLeaseOwner" TEXT,
ADD COLUMN IF NOT EXISTS "executionAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "lastExecutionAttemptAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "targetSnapshotSetId" TEXT;

CREATE INDEX IF NOT EXISTS "EditHistory_shop_executionState_executionLeaseUntil_idx"
ON "EditHistory" ("shop", "executionState", "executionLeaseUntil");

CREATE INDEX IF NOT EXISTS "EditHistory_shop_bulkOperationId_idx"
ON "EditHistory" ("shop", "bulkOperationId");

CREATE UNIQUE INDEX IF NOT EXISTS "edit_history_shop_execution_identity_key"
ON "EditHistory" ("shop", "executionIdentity");
