-- CreateTable
CREATE TABLE "StoreOperation" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestedBy" TEXT,
    "source" TEXT NOT NULL,
    "lockKey" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "targetHash" TEXT,
    "catalogBatchId" TEXT,
    "mirrorBatchId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreOperation_idempotencyKey_key" ON "StoreOperation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StoreOperation_shop_status_idx" ON "StoreOperation"("shop", "status");

-- CreateIndex
CREATE INDEX "StoreOperation_shop_type_status_idx" ON "StoreOperation"("shop", "type", "status");

-- CreateIndex
CREATE INDEX "StoreOperation_shop_heartbeatAt_idx" ON "StoreOperation"("shop", "heartbeatAt");
