ALTER TABLE "ImmutableTargetSnapshotItem"
  ADD COLUMN IF NOT EXISTS "plannedFieldMutations" JSONB,
  ADD COLUMN IF NOT EXISTS "mutationFingerprint" TEXT;

ALTER TABLE "MerchantOperation"
  ADD COLUMN IF NOT EXISTS "replayOfOperationId" TEXT,
  ADD COLUMN IF NOT EXISTS "snapshotSetId" TEXT,
  ADD COLUMN IF NOT EXISTS "executionPlanId" TEXT,
  ADD COLUMN IF NOT EXISTS "intentId" TEXT;

DO $$
BEGIN
  IF to_regclass('"MerchantOperation"') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'MerchantOperation_replayOfOperationId_fkey'
     )
  THEN
    ALTER TABLE "MerchantOperation"
      ADD CONSTRAINT "MerchantOperation_replayOfOperationId_fkey"
      FOREIGN KEY ("replayOfOperationId")
      REFERENCES "MerchantOperation"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "MerchantOperation_shop_replayOfOperationId_idx"
  ON "MerchantOperation"("shop", "replayOfOperationId");
CREATE INDEX IF NOT EXISTS "MerchantOperation_shop_snapshotSetId_idx"
  ON "MerchantOperation"("shop", "snapshotSetId");
CREATE INDEX IF NOT EXISTS "MerchantOperation_shop_executionPlanId_idx"
  ON "MerchantOperation"("shop", "executionPlanId");
CREATE INDEX IF NOT EXISTS "MerchantOperation_shop_intentId_idx"
  ON "MerchantOperation"("shop", "intentId");

CREATE TABLE IF NOT EXISTS "ExecutionPlan" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "operationId" TEXT,
  "snapshotSetId" TEXT,
  "intentHash" TEXT NOT NULL DEFAULT '',
  "mutationCount" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'PLANNED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExecutionPlan_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ExecutionPlan"
  ADD COLUMN IF NOT EXISTS "operationId" TEXT,
  ADD COLUMN IF NOT EXISTS "snapshotSetId" TEXT,
  ADD COLUMN IF NOT EXISTS "intentHash" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "mutationCount" INTEGER NOT NULL DEFAULT 0;

INSERT INTO "MerchantOperation" (
  "id",
  "shop",
  "type",
  "status",
  "title",
  "source",
  "idempotencyKey",
  "totalItems",
  "createdAt",
  "updatedAt"
)
SELECT
  'op_execution_plan_' || ep."id",
  ep."shop",
  'BULK_EDIT'::"MerchantOperationType",
  'PLANNED'::"MerchantOperationStatus",
  'Backfilled execution plan operation',
  'migration_backfill',
  'execution-plan-backfill:' || ep."id",
  COALESCE(ep."mutationCount", 0),
  NOW(),
  NOW()
FROM "ExecutionPlan" ep
WHERE ep."operationId" IS NULL
ON CONFLICT ("shop", "idempotencyKey") DO NOTHING;

UPDATE "ExecutionPlan" ep
SET "operationId" = mo."id"
FROM "MerchantOperation" mo
WHERE ep."operationId" IS NULL
  AND mo."shop" = ep."shop"
  AND mo."idempotencyKey" = 'execution-plan-backfill:' || ep."id";

ALTER TABLE "ExecutionPlan"
  ALTER COLUMN "operationId" SET NOT NULL;

DROP INDEX IF EXISTS "ExecutionPlan_shop_intentHash_snapshotSetId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "ExecutionPlan_shop_operationId_intentHash_snapshotSetId_key"
  ON "ExecutionPlan"("shop", "operationId", "intentHash", "snapshotSetId");

CREATE INDEX IF NOT EXISTS "ExecutionPlan_shop_operationId_idx"
  ON "ExecutionPlan"("shop", "operationId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ExecutionPlan_operationId_fkey'
  ) THEN
    ALTER TABLE "ExecutionPlan"
      ADD CONSTRAINT "ExecutionPlan_operationId_fkey"
      FOREIGN KEY ("operationId")
      REFERENCES "MerchantOperation"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ExecutionPartition" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "executionPlanId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "targetStartOrdinal" INTEGER NOT NULL,
  "targetEndOrdinal" INTEGER NOT NULL,
  "estimatedBytes" BIGINT,
  "actualBytes" BIGINT,
  "payloadHash" TEXT NOT NULL,
  "resultChecksum" TEXT,
  "stagedUploadPath" TEXT,
  "bulkOperationId" TEXT,
  "submittedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExecutionPartition_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ExecutionPartition_operationId_fkey'
  ) THEN
    ALTER TABLE "ExecutionPartition"
      ADD CONSTRAINT "ExecutionPartition_operationId_fkey"
      FOREIGN KEY ("operationId")
      REFERENCES "MerchantOperation"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ExecutionPartition_executionPlanId_fkey'
  ) THEN
    ALTER TABLE "ExecutionPartition"
      ADD CONSTRAINT "ExecutionPartition_executionPlanId_fkey"
      FOREIGN KEY ("executionPlanId")
      REFERENCES "ExecutionPlan"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ExecutionPartition_shop_executionPlanId_ordinal_key"
  ON "ExecutionPartition"("shop", "executionPlanId", "ordinal");

CREATE INDEX IF NOT EXISTS "ExecutionPartition_shop_operationId_idx"
  ON "ExecutionPartition"("shop", "operationId");

CREATE INDEX IF NOT EXISTS "ExecutionPartition_shop_status_idx"
  ON "ExecutionPartition"("shop", "status");