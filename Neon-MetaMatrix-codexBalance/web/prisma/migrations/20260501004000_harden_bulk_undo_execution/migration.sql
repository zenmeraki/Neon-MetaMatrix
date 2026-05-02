ALTER TABLE "BulkUndoExecution"
ADD COLUMN IF NOT EXISTS "errorHistory" JSONB,
ADD COLUMN IF NOT EXISTS "leaseOwner" TEXT,
ADD COLUMN IF NOT EXISTS "leaseUntil" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "heartbeatAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "freezeCursorId" TEXT,
ADD COLUMN IF NOT EXISTS "frozenAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "BulkUndoExecution_shop_executionIdentity_state_idx"
ON "BulkUndoExecution" ("shop", "executionIdentity", "state");

CREATE INDEX IF NOT EXISTS "BulkUndoExecution_shop_state_leaseUntil_idx"
ON "BulkUndoExecution" ("shop", "state", "leaseUntil");

CREATE INDEX IF NOT EXISTS "BulkUndoExecution_shop_bulkOperationId_idx"
ON "BulkUndoExecution" ("shop", "bulkOperationId");

CREATE INDEX IF NOT EXISTS "BulkUndoExecution_shop_historyId_state_idx"
ON "BulkUndoExecution" ("shop", "historyId", "state");
