-- CreateTable
CREATE TABLE "StoreOperationalState" (
    "shop" TEXT NOT NULL,
    "activeCatalogBatchId" TEXT,
    "activeProductBatchId" TEXT,
    "activeVariantBatchId" TEXT,
    "activeCollectionBatchId" TEXT,
    "catalogConsistencyStatus" TEXT NOT NULL DEFAULT 'NOT_READY',
    "activeWriteOperationId" TEXT,
    "activeSyncOperationId" TEXT,
    "activeImportOperationId" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastWriteAt" TIMESTAMP(3),
    "lastHealthCheckAt" TIMESTAMP(3),
    "writeBlockedReason" TEXT,
    "writesBlockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreOperationalState_pkey" PRIMARY KEY ("shop")
);
