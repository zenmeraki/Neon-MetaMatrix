-- CreateTable
CREATE TABLE "OperationEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperationEvent_shop_operationId_idx" ON "OperationEvent"("shop", "operationId");

-- CreateIndex
CREATE INDEX "OperationEvent_operationId_createdAt_idx" ON "OperationEvent"("operationId", "createdAt");

-- CreateIndex
CREATE INDEX "OperationEvent_type_idx" ON "OperationEvent"("type");
