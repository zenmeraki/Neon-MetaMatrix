CREATE TABLE IF NOT EXISTS "CollectionMirrorBatch" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "bulkOperationId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PLANNED',
  "collectionCount" INTEGER NOT NULL DEFAULT 0,
  "membershipCount" INTEGER NOT NULL DEFAULT 0,
  "activatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CollectionMirrorBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CollectionMirrorBatch_shop_status_idx"
  ON "CollectionMirrorBatch"("shop", "status");

CREATE INDEX IF NOT EXISTS "CollectionMirrorBatch_shop_createdAt_idx"
  ON "CollectionMirrorBatch"("shop", "createdAt");
