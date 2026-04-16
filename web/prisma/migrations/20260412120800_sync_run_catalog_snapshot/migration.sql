-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "runType" TEXT NOT NULL,
    "domain" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "stage" TEXT,
    "catalogBatchId" TEXT,
    "bulkOperationId" TEXT,
    "triggerSource" TEXT,
    "responseUrl" TEXT,
    "rowCount" INTEGER,
    "durationMs" INTEGER,
    "isInitialSync" BOOLEAN NOT NULL DEFAULT false,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogSnapshot" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "catalogBatchId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BUILDING',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncRun_shop_createdAt_idx" ON "SyncRun"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "SyncRun_shop_runType_createdAt_idx" ON "SyncRun"("shop", "runType", "createdAt");

-- CreateIndex
CREATE INDEX "SyncRun_shop_domain_createdAt_idx" ON "SyncRun"("shop", "domain", "createdAt");

-- CreateIndex
CREATE INDEX "SyncRun_shop_status_createdAt_idx" ON "SyncRun"("shop", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SyncRun_shop_runType_status_createdAt_idx" ON "SyncRun"("shop", "runType", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SyncRun_bulkOperationId_idx" ON "SyncRun"("bulkOperationId");

-- CreateIndex
CREATE INDEX "SyncRun_catalogBatchId_idx" ON "SyncRun"("catalogBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogSnapshot_shop_catalogBatchId_key" ON "CatalogSnapshot"("shop", "catalogBatchId");

-- CreateIndex
CREATE INDEX "CatalogSnapshot_shop_status_activatedAt_idx" ON "CatalogSnapshot"("shop", "status", "activatedAt");

-- CreateIndex
CREATE INDEX "CatalogSnapshot_shop_createdAt_idx" ON "CatalogSnapshot"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "CatalogSnapshot_catalogBatchId_idx" ON "CatalogSnapshot"("catalogBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogSnapshot_one_active_per_shop_idx"
ON "CatalogSnapshot"("shop")
WHERE "status" = 'ACTIVE';
