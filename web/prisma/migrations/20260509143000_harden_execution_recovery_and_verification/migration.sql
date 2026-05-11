ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "sourceSequence" BIGINT;

ALTER TABLE "Variant"
  ADD COLUMN IF NOT EXISTS "sourceSequence" BIGINT;

CREATE INDEX IF NOT EXISTS "Product_shop_sourceSequence_idx"
  ON "Product"("shop", "sourceSequence");
CREATE INDEX IF NOT EXISTS "Variant_shop_sourceSequence_idx"
  ON "Variant"("shop", "sourceSequence");

ALTER TABLE "MerchantOperation"
  ADD COLUMN IF NOT EXISTS "plannerVersion" INTEGER,
  ADD COLUMN IF NOT EXISTS "compilerVersion" INTEGER,
  ADD COLUMN IF NOT EXISTS "executionEngineVersion" INTEGER;

ALTER TABLE "OperationExecution"
  ADD COLUMN IF NOT EXISTS "leaseOwner" TEXT,
  ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "heartbeatAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastCompletedPartition" INTEGER,
  ADD COLUMN IF NOT EXISTS "lastCompletedTargetOrdinal" INTEGER,
  ADD COLUMN IF NOT EXISTS "retryExhaustedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "poisoned" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "OperationExecution_shop_leaseOwner_leaseExpiresAt_idx"
  ON "OperationExecution"("shop", "leaseOwner", "leaseExpiresAt");
CREATE INDEX IF NOT EXISTS "OperationExecution_shop_poisoned_status_idx"
  ON "OperationExecution"("shop", "poisoned", "status");

ALTER TABLE "OperationSubmission"
  ADD COLUMN IF NOT EXISTS "submissionFingerprint" TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS "OperationSubmission_shop_merchantOperationId_partitionOrd_submis_key"
  ON "OperationSubmission"("shop", "merchantOperationId", "partitionOrdinal", "submissionFingerprint");

CREATE TABLE IF NOT EXISTS "VerificationResult" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "partitionId" TEXT,
  "expectedFingerprint" TEXT NOT NULL,
  "actualFingerprint" TEXT NOT NULL,
  "verified" BOOLEAN NOT NULL,
  "mismatchReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerificationResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VerificationResult_shop_operationId_idx"
  ON "VerificationResult"("shop", "operationId");

ALTER TABLE "OperationLease"
  ADD COLUMN IF NOT EXISTS "leaseOwner" TEXT,
  ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "heartbeatAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "fencingToken" BIGINT;

CREATE INDEX IF NOT EXISTS "OperationLease_shop_pipeline_leaseExpiresAt_idx"
  ON "OperationLease"("shop", "pipeline", "leaseExpiresAt");
CREATE INDEX IF NOT EXISTS "OperationLease_shop_leaseOwner_heartbeatAt_idx"
  ON "OperationLease"("shop", "leaseOwner", "heartbeatAt");
