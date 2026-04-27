/*
  Warnings:

  - A unique constraint covering the columns `[ownerType,ownerId,ordinal]` on the table `TargetSnapshot` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `ordinal` to the `TargetSnapshot` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ScheduledExportFrequency" AS ENUM ('HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "EditHistory" ADD COLUMN     "undoBulkOperationId" TEXT,
ADD COLUMN     "undoCompletedAt" TIMESTAMP(3),
ADD COLUMN     "undoExecutionIdentity" TEXT,
ADD COLUMN     "undoQueuedAt" TIMESTAMP(3),
ADD COLUMN     "undoStartedAt" TIMESTAMP(3),
ADD COLUMN     "undoState" TEXT;

-- AlterTable
ALTER TABLE "ExportJob" ADD COLUMN     "fileKey" TEXT,
ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "fileSizeBytes" INTEGER,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "mirrorBatchId" TEXT,
ADD COLUMN     "productCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rowCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ScheduledExport" ADD COLUMN     "error" TEXT,
ADD COLUMN     "frequency" "ScheduledExportFrequency",
ADD COLUMN     "lastExportJobId" TEXT,
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedBy" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "productIds" JSONB,
ADD COLUMN     "queryWhere" JSONB,
ADD COLUMN     "requestedColumns" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'PRODUCT_EXPORT';

-- AlterTable
ALTER TABLE "TargetSnapshot" ADD COLUMN     "ordinal" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Variant" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BulkUndoExecution" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "historyId" TEXT NOT NULL,
    "executionIdentity" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "frozenCount" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "lastSnapshotOrdinal" INTEGER NOT NULL DEFAULT 0,
    "bulkOperationId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkUndoExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkUndoTargetSnapshot" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "historyId" TEXT NOT NULL,
    "executionIdentity" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "changeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BulkUndoTargetSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BulkUndoExecution_executionIdentity_key" ON "BulkUndoExecution"("executionIdentity");

-- CreateIndex
CREATE INDEX "BulkUndoExecution_shop_historyId_idx" ON "BulkUndoExecution"("shop", "historyId");

-- CreateIndex
CREATE INDEX "BulkUndoExecution_shop_state_idx" ON "BulkUndoExecution"("shop", "state");

-- CreateIndex
CREATE INDEX "BulkUndoTargetSnapshot_shop_executionIdentity_ordinal_idx" ON "BulkUndoTargetSnapshot"("shop", "executionIdentity", "ordinal");

-- CreateIndex
CREATE INDEX "BulkUndoTargetSnapshot_shop_historyId_idx" ON "BulkUndoTargetSnapshot"("shop", "historyId");

-- CreateIndex
CREATE UNIQUE INDEX "BulkUndoTargetSnapshot_shop_executionIdentity_productId_key" ON "BulkUndoTargetSnapshot"("shop", "executionIdentity", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "BulkUndoTargetSnapshot_shop_executionIdentity_ordinal_key" ON "BulkUndoTargetSnapshot"("shop", "executionIdentity", "ordinal");

-- CreateIndex
CREATE INDEX "ExportJob_shop_createdAt_idx" ON "ExportJob"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "ExportJob_shop_status_idx" ON "ExportJob"("shop", "status");

-- CreateIndex
CREATE INDEX "ExportJob_shop_mirrorBatchId_idx" ON "ExportJob"("shop", "mirrorBatchId");

-- CreateIndex
CREATE INDEX "ScheduledExport_status_nextRunAt_idx" ON "ScheduledExport"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "ScheduledExport_status_lockedAt_idx" ON "ScheduledExport"("status", "lockedAt");

-- CreateIndex
CREATE INDEX "TargetSnapshot_ownerType_ownerId_ordinal_idx" ON "TargetSnapshot"("ownerType", "ownerId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "TargetSnapshot_ownerType_ownerId_ordinal_key" ON "TargetSnapshot"("ownerType", "ownerId", "ordinal");

-- AddForeignKey
ALTER TABLE "ScheduledExport" ADD CONSTRAINT "ScheduledExport_lastExportJobId_fkey" FOREIGN KEY ("lastExportJobId") REFERENCES "ExportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
