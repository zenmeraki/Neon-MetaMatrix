CREATE TABLE IF NOT EXISTS "OperationLease" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "pipeline" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationLease_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OperationLease_shop_pipeline_operationId_key"
  ON "OperationLease"("shop", "pipeline", "operationId");

CREATE INDEX IF NOT EXISTS "OperationLease_shop_pipeline_createdAt_idx"
  ON "OperationLease"("shop", "pipeline", "createdAt");
