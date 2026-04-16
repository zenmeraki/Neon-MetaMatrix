/*
  Warnings:

  - A unique constraint covering the columns `[editHistoryId,batchId]` on the table `BulkMutationSubmission` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ActiveCatalogSnapshot" ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "activatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "BulkMutationSubmission" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "DomainFreshness" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "EditExecutionSummary" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "FieldAuthorityRegistry" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProductCollectionMembership" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProductTrackedMetafield" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ShopWorkLease" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TargetSnapshotSet" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "VariantInventoryLevel" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "VariantTrackedMetafield" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- RenameIndex
ALTER INDEX "BulkMutationOutcome_submission_dedupeKey_key" RENAME TO "BulkMutationOutcome_bulkMutationSubmissionId_dedupeKey_key";

-- RenameIndex
ALTER INDEX "ProductCollectionMembership_shop_catalogBatchId_collectionId_id" RENAME TO "ProductCollectionMembership_shop_catalogBatchId_collectionI_idx";

-- RenameIndex
ALTER INDEX "ProductCollectionMembership_shop_catalogBatchId_productId_colle" RENAME TO "ProductCollectionMembership_shop_catalogBatchId_productId_c_key";

-- RenameIndex
ALTER INDEX "ProductCollectionMembership_shop_catalogBatchId_sourceUpdatedAt" RENAME TO "ProductCollectionMembership_shop_catalogBatchId_sourceUpdat_idx";

-- RenameIndex
ALTER INDEX "ProductTrackedMetafield_shop_catalogBatchId_productId_namespace" RENAME TO "ProductTrackedMetafield_shop_catalogBatchId_productId_names_key";

-- RenameIndex
ALTER INDEX "TargetSnapshotSet_shop_owner_status_idx" RENAME TO "TargetSnapshotSet_shop_ownerType_ownerId_status_idx";

-- RenameIndex
ALTER INDEX "VariantInventoryLevel_shop_catalogBatchId_inventoryItemId_locat" RENAME TO "VariantInventoryLevel_shop_catalogBatchId_inventoryItemId_l_key";

-- RenameIndex
ALTER INDEX "VariantTrackedMetafield_shop_catalogBatchId_variantId_namespace" RENAME TO "VariantTrackedMetafield_shop_catalogBatchId_variantId_names_key";