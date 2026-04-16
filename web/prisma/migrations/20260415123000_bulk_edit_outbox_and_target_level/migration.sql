ALTER TABLE "EditHistory"
ADD COLUMN IF NOT EXISTS "targetLevel" TEXT,
ADD COLUMN IF NOT EXISTS "skippedItems" JSONB;

CREATE TABLE IF NOT EXISTS "BulkEditJobOutbox" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "editHistoryId" TEXT NOT NULL,
  "executionIdentity" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "claimedAt" TIMESTAMP(3),
  "dispatchedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BulkEditJobOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BulkEditJobOutbox_editHistoryId_key"
ON "BulkEditJobOutbox"("editHistoryId");

CREATE INDEX IF NOT EXISTS "BulkEditJobOutbox_status_createdAt_idx"
ON "BulkEditJobOutbox"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "BulkEditJobOutbox_shop_status_idx"
ON "BulkEditJobOutbox"("shop", "status");
