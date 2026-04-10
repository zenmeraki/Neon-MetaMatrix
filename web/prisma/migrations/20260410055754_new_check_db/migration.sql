/*
  Warnings:

  - You are about to drop the column `description` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `errorSummary` on the `SyncHistory` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[scheduledTask]` on the table `ExportHistory` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[shop]` on the table `Subscription` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "AutomaticProductRule" ADD COLUMN     "canonicalFilterKey" TEXT,
ADD COLUMN     "filterVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "EditHistory" ADD COLUMN     "canonicalFilterKey" TEXT,
ADD COLUMN     "filterVersion" INTEGER;

-- AlterTable
ALTER TABLE "ExportJob" ADD COLUMN     "canonicalFilterKey" TEXT,
ADD COLUMN     "filterVersion" INTEGER;

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "description",
ADD COLUMN     "descriptionHtml" TEXT,
ADD COLUMN     "descriptionText" TEXT,
ADD COLUMN     "lastReconciledAt" TIMESTAMP(3),
ADD COLUMN     "lastSourceEventAt" TIMESTAMP(3),
ADD COLUMN     "lastSourceKind" TEXT,
ADD COLUMN     "lastSourceUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RecurringEdit" ADD COLUMN     "canonicalFilterKey" TEXT,
ADD COLUMN     "filterVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ScheduledExport" ADD COLUMN     "canonicalFilterKey" TEXT,
ADD COLUMN     "filterVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "SyncHistory" DROP COLUMN "errorSummary",
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "executionIdentity" TEXT,
ADD COLUMN     "executionState" TEXT NOT NULL DEFAULT 'planned',
ADD COLUMN     "lastHeartbeatAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MirrorReconcileSignal" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "topic" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "signalCount" INTEGER NOT NULL DEFAULT 1,
    "latestWebhookId" TEXT,
    "latestPayloadHash" TEXT,
    "latestEventAt" TIMESTAMP(3),
    "latestSourceUpdatedAt" TIMESTAMP(3),
    "latestSourceKind" TEXT,
    "processingToken" TEXT,
    "processingStartedAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MirrorReconcileSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationFingerprint" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationFingerprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTombstone" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),
    "sourceEventAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "sourceKind" TEXT,
    "lastReconciledAt" TIMESTAMP(3),
    "purgeAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductTombstone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "webhookId" TEXT,
    "entityId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "payloadHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MirrorReconcileSignal_shop_status_updatedAt_idx" ON "MirrorReconcileSignal"("shop", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "MirrorReconcileSignal_status_updatedAt_idx" ON "MirrorReconcileSignal"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MirrorReconcileSignal_shop_entityType_entityId_key" ON "MirrorReconcileSignal"("shop", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "OperationFingerprint_resource_idx" ON "OperationFingerprint"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "OperationFingerprint_shop_status_createdAt_idx" ON "OperationFingerprint"("shop", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OperationFingerprint_shop_operationType_fingerprint_key" ON "OperationFingerprint"("shop", "operationType", "fingerprint");

-- CreateIndex
CREATE INDEX "ProductTombstone_shop_deletedAt_idx" ON "ProductTombstone"("shop", "deletedAt");

-- CreateIndex
CREATE INDEX "ProductTombstone_shop_purgeAfter_idx" ON "ProductTombstone"("shop", "purgeAfter");

-- CreateIndex
CREATE INDEX "ProductTombstone_shop_updatedAt_idx" ON "ProductTombstone"("shop", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductTombstone_shop_productId_key" ON "ProductTombstone"("shop", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_dedupeKey_key" ON "WebhookDelivery"("dedupeKey");

-- CreateIndex
CREATE INDEX "WebhookDelivery_shop_topic_createdAt_idx" ON "WebhookDelivery"("shop", "topic", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_createdAt_idx" ON "WebhookDelivery"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AutomaticProductRule_shop_canonicalFilterKey_idx" ON "AutomaticProductRule"("shop", "canonicalFilterKey");

-- CreateIndex
CREATE INDEX "Collection_shop_mirrorBatchId_title_idx" ON "Collection"("shop", "mirrorBatchId", "title");

-- CreateIndex
CREATE INDEX "EditHistory_shop_canonicalFilterKey_idx" ON "EditHistory"("shop", "canonicalFilterKey");

-- CreateIndex
CREATE UNIQUE INDEX "ExportHistory_scheduledTask_key" ON "ExportHistory"("scheduledTask");

-- CreateIndex
CREATE INDEX "ExportJob_shop_canonicalFilterKey_idx" ON "ExportJob"("shop", "canonicalFilterKey");

-- CreateIndex
CREATE INDEX "Product_shop_lastReconciledAt_idx" ON "Product"("shop", "lastReconciledAt");

-- CreateIndex
CREATE INDEX "Product_shop_lastSourceEventAt_idx" ON "Product"("shop", "lastSourceEventAt");

-- CreateIndex
CREATE INDEX "Product_shop_lastSourceKind_idx" ON "Product"("shop", "lastSourceKind");

-- CreateIndex
CREATE INDEX "Product_shop_lastSourceUpdatedAt_idx" ON "Product"("shop", "lastSourceUpdatedAt");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_categoryAgeGroup_idx" ON "Product"("shop", "mirrorBatchId", "categoryAgeGroup");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_categoryColor_idx" ON "Product"("shop", "mirrorBatchId", "categoryColor");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_categoryFabric_idx" ON "Product"("shop", "mirrorBatchId", "categoryFabric");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_categoryFit_idx" ON "Product"("shop", "mirrorBatchId", "categoryFit");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_categoryName_idx" ON "Product"("shop", "mirrorBatchId", "categoryName");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_categorySize_idx" ON "Product"("shop", "mirrorBatchId", "categorySize");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_categoryTargetGender_idx" ON "Product"("shop", "mirrorBatchId", "categoryTargetGender");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_categoryWaistRise_idx" ON "Product"("shop", "mirrorBatchId", "categoryWaistRise");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_googleShoppingCategory_idx" ON "Product"("shop", "mirrorBatchId", "googleShoppingCategory");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_googleShoppingColor_idx" ON "Product"("shop", "mirrorBatchId", "googleShoppingColor");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_googleShoppingCustomLabel0_idx" ON "Product"("shop", "mirrorBatchId", "googleShoppingCustomLabel0");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_googleShoppingCustomLabel1_idx" ON "Product"("shop", "mirrorBatchId", "googleShoppingCustomLabel1");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_googleShoppingCustomLabel2_idx" ON "Product"("shop", "mirrorBatchId", "googleShoppingCustomLabel2");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_googleShoppingCustomLabel3_idx" ON "Product"("shop", "mirrorBatchId", "googleShoppingCustomLabel3");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_googleShoppingCustomLabel4_idx" ON "Product"("shop", "mirrorBatchId", "googleShoppingCustomLabel4");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_googleShoppingMaterial_idx" ON "Product"("shop", "mirrorBatchId", "googleShoppingMaterial");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_googleShoppingMpn_idx" ON "Product"("shop", "mirrorBatchId", "googleShoppingMpn");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_googleShoppingSize_idx" ON "Product"("shop", "mirrorBatchId", "googleShoppingSize");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_option1Name_idx" ON "Product"("shop", "mirrorBatchId", "option1Name");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_option2Name_idx" ON "Product"("shop", "mirrorBatchId", "option2Name");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_option3Name_idx" ON "Product"("shop", "mirrorBatchId", "option3Name");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_productType_idx" ON "Product"("shop", "mirrorBatchId", "productType");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_vendor_idx" ON "Product"("shop", "mirrorBatchId", "vendor");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_descriptionText_idx" ON "Product"("shop", "mirrorBatchId", "descriptionText");

-- CreateIndex
CREATE INDEX "RecurringEdit_shop_canonicalFilterKey_idx" ON "RecurringEdit"("shop", "canonicalFilterKey");

-- CreateIndex
CREATE INDEX "ScheduledExport_shop_canonicalFilterKey_idx" ON "ScheduledExport"("shop", "canonicalFilterKey");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_shop_key" ON "Subscription"("shop");

-- CreateIndex
CREATE INDEX "SyncHistory_shop_executionState_idx" ON "SyncHistory"("shop", "executionState");

-- CreateIndex
CREATE INDEX "Variant_shop_mirrorBatchId_countryOfOrigin_idx" ON "Variant"("shop", "mirrorBatchId", "countryOfOrigin");

-- CreateIndex
CREATE INDEX "Variant_shop_mirrorBatchId_inventoryPolicy_idx" ON "Variant"("shop", "mirrorBatchId", "inventoryPolicy");

-- CreateIndex
CREATE INDEX "Variant_shop_mirrorBatchId_option1Value_idx" ON "Variant"("shop", "mirrorBatchId", "option1Value");

-- CreateIndex
CREATE INDEX "Variant_shop_mirrorBatchId_option2Value_idx" ON "Variant"("shop", "mirrorBatchId", "option2Value");

-- CreateIndex
CREATE INDEX "Variant_shop_mirrorBatchId_option3Value_idx" ON "Variant"("shop", "mirrorBatchId", "option3Value");

-- CreateIndex
CREATE INDEX "Variant_shop_mirrorBatchId_weightUnit_idx" ON "Variant"("shop", "mirrorBatchId", "weightUnit");
