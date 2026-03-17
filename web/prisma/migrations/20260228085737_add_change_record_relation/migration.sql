-- CreateTable
CREATE TABLE "ChangeRecord" (
    "id" TEXT NOT NULL,
    "editHistoryId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "options" JSONB,
    "productFieldChanges" JSONB,
    "variantFieldChanges" JSONB,
    "image" TEXT,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChangeRecord_editHistoryId_idx" ON "ChangeRecord"("editHistoryId");

-- CreateIndex
CREATE INDEX "ChangeRecord_productId_idx" ON "ChangeRecord"("productId");

-- CreateIndex
CREATE INDEX "ChangeRecord_shop_idx" ON "ChangeRecord"("shop");

-- CreateIndex
CREATE INDEX "ChangeRecord_status_idx" ON "ChangeRecord"("status");

-- CreateIndex
CREATE INDEX "ChangeRecord_batchId_idx" ON "ChangeRecord"("batchId");

-- AddForeignKey
ALTER TABLE "ChangeRecord" ADD CONSTRAINT "ChangeRecord_editHistoryId_fkey" FOREIGN KEY ("editHistoryId") REFERENCES "EditHistory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
