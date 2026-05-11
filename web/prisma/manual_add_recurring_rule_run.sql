CREATE TABLE IF NOT EXISTS "RecurringRuleRun" (
  "id" TEXT NOT NULL,
  "recurringEditId" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "operationId" TEXT,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "executionKey" TEXT NOT NULL,
  "executionId" TEXT,
  "targetSnapshotId" TEXT,
  "mirrorBatchId" TEXT,
  "plannerFingerprint" TEXT,
  "frozenAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "editHistoryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecurringRuleRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RecurringRuleRun_executionKey_key"
ON "RecurringRuleRun"("executionKey");

CREATE INDEX IF NOT EXISTS "RecurringRuleRun_recurringEditId_idx"
ON "RecurringRuleRun"("recurringEditId");

CREATE INDEX IF NOT EXISTS "RecurringRuleRun_shop_status_idx"
ON "RecurringRuleRun"("shop", "status");

CREATE INDEX IF NOT EXISTS "RecurringRuleRun_shop_scheduledFor_idx"
ON "RecurringRuleRun"("shop", "scheduledFor");

CREATE INDEX IF NOT EXISTS "RecurringRuleRun_shop_operationId_idx"
ON "RecurringRuleRun"("shop", "operationId");

CREATE INDEX IF NOT EXISTS "RecurringRuleRun_editHistoryId_idx"
ON "RecurringRuleRun"("editHistoryId");

CREATE INDEX IF NOT EXISTS "RecurringRuleRun_shop_targetSnapshotId_idx"
ON "RecurringRuleRun"("shop", "targetSnapshotId");

CREATE INDEX IF NOT EXISTS "RecurringRuleRun_shop_mirrorBatchId_idx"
ON "RecurringRuleRun"("shop", "mirrorBatchId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'RecurringRuleRun_recurringEditId_fkey'
  ) THEN
    ALTER TABLE "RecurringRuleRun"
      ADD CONSTRAINT "RecurringRuleRun_recurringEditId_fkey"
      FOREIGN KEY ("recurringEditId")
      REFERENCES "RecurringEdit"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'RecurringRuleRun_operationId_fkey'
  ) THEN
    ALTER TABLE "RecurringRuleRun"
      ADD CONSTRAINT "RecurringRuleRun_operationId_fkey"
      FOREIGN KEY ("operationId")
      REFERENCES "MerchantOperation"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;