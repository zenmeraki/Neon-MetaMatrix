-- CreateTable
CREATE TABLE "SyncArtifact" (
    "id" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "artifactType" TEXT NOT NULL,
    "storageUrl" TEXT,
    "sourceUrl" TEXT,
    "checksum" TEXT,
    "rowCount" INTEGER,
    "contentType" TEXT,
    "pipelineVersion" TEXT,
    "schemaVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncArtifact_syncRunId_createdAt_idx" ON "SyncArtifact"("syncRunId", "createdAt");

-- CreateIndex
CREATE INDEX "SyncArtifact_shop_createdAt_idx" ON "SyncArtifact"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "SyncArtifact_shop_artifactType_createdAt_idx" ON "SyncArtifact"("shop", "artifactType", "createdAt");

-- CreateIndex
CREATE INDEX "SyncArtifact_syncRunId_artifactType_createdAt_idx" ON "SyncArtifact"("syncRunId", "artifactType", "createdAt");

-- AddForeignKey
ALTER TABLE "SyncArtifact" ADD CONSTRAINT "SyncArtifact_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
