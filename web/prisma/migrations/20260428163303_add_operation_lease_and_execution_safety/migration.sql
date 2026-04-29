-- AlterTable
ALTER TABLE "ChangeRecord" ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "entityType" TEXT,
ADD COLUMN     "field" TEXT,
ADD COLUMN     "mutationKey" TEXT,
ADD COLUMN     "newValue" JSONB,
ADD COLUMN     "oldValue" JSONB,
ADD COLUMN     "operationId" TEXT;

-- AlterTable
ALTER TABLE "StoreOperation" ADD COLUMN     "collectionBatchId" TEXT,
ADD COLUMN     "editHistoryId" TEXT,
ADD COLUMN     "failureCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "leaseOwner" TEXT,
ADD COLUMN     "processedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "productBatchId" TEXT,
ADD COLUMN     "successCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalTargets" INTEGER,
ADD COLUMN     "variantBatchId" TEXT;

-- CreateTable
CREATE TABLE "OperationFailure" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationFailure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationMutation" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationMutation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TargetSnapshotSet" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "ordinal" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TargetSnapshotSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperationFailure_shop_operationId_idx" ON "OperationFailure"("shop", "operationId");

-- CreateIndex
CREATE INDEX "OperationFailure_operationId_idx" ON "OperationFailure"("operationId");

-- CreateIndex
CREATE INDEX "OperationMutation_shop_operationId_idx" ON "OperationMutation"("shop", "operationId");

-- CreateIndex
CREATE UNIQUE INDEX "OperationMutation_shop_entityId_field_operationId_key" ON "OperationMutation"("shop", "entityId", "field", "operationId");

-- CreateIndex
CREATE INDEX "TargetSnapshotSet_shop_operationId_idx" ON "TargetSnapshotSet"("shop", "operationId");

-- CreateIndex
CREATE INDEX "TargetSnapshotSet_operationId_ordinal_idx" ON "TargetSnapshotSet"("operationId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "TargetSnapshotSet_operationId_entityId_key" ON "TargetSnapshotSet"("operationId", "entityId");

-- CreateIndex
CREATE INDEX "ChangeRecord_shop_operationId_idx" ON "ChangeRecord"("shop", "operationId");

-- CreateIndex
CREATE INDEX "StoreOperation_shop_leaseExpiresAt_idx" ON "StoreOperation"("shop", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "StoreOperation_shop_editHistoryId_idx" ON "StoreOperation"("shop", "editHistoryId");
