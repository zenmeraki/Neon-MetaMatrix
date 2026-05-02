CREATE TABLE IF NOT EXISTS "BulkUndoDispatchProduct" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "executionIdentity" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "targetIds" TEXT[],
  "payloadHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DISPATCHED',
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BulkUndoDispatchProduct_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BulkUndoDispatchProduct_shop_executionIdentity_productId_key"
  ON "BulkUndoDispatchProduct"("shop", "executionIdentity", "productId");

CREATE INDEX IF NOT EXISTS "BulkUndoDispatchProduct_shop_executionIdentity_status_idx"
  ON "BulkUndoDispatchProduct"("shop", "executionIdentity", "status");
