-- Additive catalog truth tables.
-- Existing SyncRun, SyncArtifact, and CatalogSnapshot tables were introduced
-- in earlier migrations. This migration adds the remaining truth surfaces and
-- reasserts the active snapshot invariant idempotently.

CREATE TABLE IF NOT EXISTS "DomainFreshness" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lastFreshAt" TIMESTAMP(3),
    "staleReason" TEXT,
    "repairRequired" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "sourceRunId" TEXT,
    "catalogBatchId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainFreshness_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FieldAuthorityRegistry" (
    "id" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "authorityDomain" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sourceQuery" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldAuthorityRegistry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProductCollectionMembership" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "catalogBatchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "collectionTitle" TEXT,
    "collectionHandle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCollectionMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VariantInventoryLevel" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "catalogBatchId" TEXT NOT NULL,
    "variantId" TEXT,
    "productId" TEXT,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "available" INTEGER,
    "committed" INTEGER,
    "incoming" INTEGER,
    "onHand" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VariantInventoryLevel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProductTrackedMetafield" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "catalogBatchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT,
    "value" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductTrackedMetafield_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VariantTrackedMetafield" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "catalogBatchId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT,
    "value" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VariantTrackedMetafield_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TargetSnapshotSet" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "catalogBatchId" TEXT,
    "mirrorBatchId" TEXT,
    "sourceType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'BUILDING',
    "targetCount" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TargetSnapshotSet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TargetSnapshotItem" (
    "id" TEXT NOT NULL,
    "targetSnapshotSetId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "catalogBatchId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TargetSnapshotItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TargetSnapshotItem_targetSnapshotSetId_fkey"
        FOREIGN KEY ("targetSnapshotSetId")
        REFERENCES "TargetSnapshotSet"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "BulkMutationSubmission" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "syncRunId" TEXT,
    "editHistoryId" TEXT,
    "bulkOperationId" TEXT,
    "mutationType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "rowCount" INTEGER,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BulkMutationSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BulkMutationOutcome" (
    "id" TEXT NOT NULL,
    "bulkMutationSubmissionId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "targetId" TEXT,
    "productId" TEXT,
    "variantId" TEXT,
    "status" TEXT NOT NULL,
    "code" TEXT,
    "message" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BulkMutationOutcome_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BulkMutationOutcome_bulkMutationSubmissionId_fkey"
        FOREIGN KEY ("bulkMutationSubmissionId")
        REFERENCES "BulkMutationSubmission"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "VariantTombstone" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT,
    "sourceUpdatedAt" TIMESTAMP(3),
    "sourceEventAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "sourceKind" TEXT,
    "lastReconciledAt" TIMESTAMP(3),
    "purgeAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VariantTombstone_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CatalogSnapshot_one_active_per_shop_idx"
ON "CatalogSnapshot"("shop")
WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS "DomainFreshness_shop_domain_key" ON "DomainFreshness"("shop", "domain");
CREATE INDEX IF NOT EXISTS "DomainFreshness_shop_status_updatedAt_idx" ON "DomainFreshness"("shop", "status", "updatedAt");
CREATE INDEX IF NOT EXISTS "DomainFreshness_shop_domain_updatedAt_idx" ON "DomainFreshness"("shop", "domain", "updatedAt");
CREATE INDEX IF NOT EXISTS "DomainFreshness_catalogBatchId_idx" ON "DomainFreshness"("catalogBatchId");

CREATE UNIQUE INDEX IF NOT EXISTS "FieldAuthorityRegistry_fieldKey_key" ON "FieldAuthorityRegistry"("fieldKey");
CREATE INDEX IF NOT EXISTS "FieldAuthorityRegistry_authorityDomain_fieldKey_idx" ON "FieldAuthorityRegistry"("authorityDomain", "fieldKey");
CREATE INDEX IF NOT EXISTS "FieldAuthorityRegistry_status_updatedAt_idx" ON "FieldAuthorityRegistry"("status", "updatedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "ProductCollectionMembership_shop_catalogBatchId_productId_collectionId_key"
ON "ProductCollectionMembership"("shop", "catalogBatchId", "productId", "collectionId");
CREATE INDEX IF NOT EXISTS "ProductCollectionMembership_shop_catalogBatchId_idx" ON "ProductCollectionMembership"("shop", "catalogBatchId");
CREATE INDEX IF NOT EXISTS "ProductCollectionMembership_shop_catalogBatchId_collectionId_idx" ON "ProductCollectionMembership"("shop", "catalogBatchId", "collectionId");
CREATE INDEX IF NOT EXISTS "ProductCollectionMembership_shop_catalogBatchId_productId_idx" ON "ProductCollectionMembership"("shop", "catalogBatchId", "productId");

CREATE UNIQUE INDEX IF NOT EXISTS "VariantInventoryLevel_shop_catalogBatchId_inventoryItemId_locationId_key"
ON "VariantInventoryLevel"("shop", "catalogBatchId", "inventoryItemId", "locationId");
CREATE INDEX IF NOT EXISTS "VariantInventoryLevel_shop_catalogBatchId_idx" ON "VariantInventoryLevel"("shop", "catalogBatchId");
CREATE INDEX IF NOT EXISTS "VariantInventoryLevel_shop_catalogBatchId_variantId_idx" ON "VariantInventoryLevel"("shop", "catalogBatchId", "variantId");
CREATE INDEX IF NOT EXISTS "VariantInventoryLevel_shop_catalogBatchId_locationId_idx" ON "VariantInventoryLevel"("shop", "catalogBatchId", "locationId");
CREATE INDEX IF NOT EXISTS "VariantInventoryLevel_inventoryItemId_idx" ON "VariantInventoryLevel"("inventoryItemId");

CREATE UNIQUE INDEX IF NOT EXISTS "ProductTrackedMetafield_shop_catalogBatchId_productId_namespace_key_key"
ON "ProductTrackedMetafield"("shop", "catalogBatchId", "productId", "namespace", "key");
CREATE INDEX IF NOT EXISTS "ProductTrackedMetafield_shop_catalogBatchId_idx" ON "ProductTrackedMetafield"("shop", "catalogBatchId");
CREATE INDEX IF NOT EXISTS "ProductTrackedMetafield_shop_catalogBatchId_productId_idx" ON "ProductTrackedMetafield"("shop", "catalogBatchId", "productId");
CREATE INDEX IF NOT EXISTS "ProductTrackedMetafield_namespace_key_idx" ON "ProductTrackedMetafield"("namespace", "key");

CREATE UNIQUE INDEX IF NOT EXISTS "VariantTrackedMetafield_shop_catalogBatchId_variantId_namespace_key_key"
ON "VariantTrackedMetafield"("shop", "catalogBatchId", "variantId", "namespace", "key");
CREATE INDEX IF NOT EXISTS "VariantTrackedMetafield_shop_catalogBatchId_idx" ON "VariantTrackedMetafield"("shop", "catalogBatchId");
CREATE INDEX IF NOT EXISTS "VariantTrackedMetafield_shop_catalogBatchId_variantId_idx" ON "VariantTrackedMetafield"("shop", "catalogBatchId", "variantId");
CREATE INDEX IF NOT EXISTS "VariantTrackedMetafield_shop_catalogBatchId_productId_idx" ON "VariantTrackedMetafield"("shop", "catalogBatchId", "productId");
CREATE INDEX IF NOT EXISTS "VariantTrackedMetafield_namespace_key_idx" ON "VariantTrackedMetafield"("namespace", "key");

CREATE INDEX IF NOT EXISTS "TargetSnapshotSet_shop_ownerType_ownerId_idx" ON "TargetSnapshotSet"("shop", "ownerType", "ownerId");
CREATE INDEX IF NOT EXISTS "TargetSnapshotSet_shop_status_createdAt_idx" ON "TargetSnapshotSet"("shop", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "TargetSnapshotSet_catalogBatchId_idx" ON "TargetSnapshotSet"("catalogBatchId");
CREATE UNIQUE INDEX IF NOT EXISTS "TargetSnapshotItem_targetSnapshotSetId_productId_variantId_key"
ON "TargetSnapshotItem"("targetSnapshotSetId", "productId", "variantId");
CREATE INDEX IF NOT EXISTS "TargetSnapshotItem_shop_productId_idx" ON "TargetSnapshotItem"("shop", "productId");
CREATE INDEX IF NOT EXISTS "TargetSnapshotItem_shop_catalogBatchId_idx" ON "TargetSnapshotItem"("shop", "catalogBatchId");

CREATE INDEX IF NOT EXISTS "BulkMutationSubmission_shop_status_createdAt_idx" ON "BulkMutationSubmission"("shop", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "BulkMutationSubmission_bulkOperationId_idx" ON "BulkMutationSubmission"("bulkOperationId");
CREATE INDEX IF NOT EXISTS "BulkMutationSubmission_syncRunId_idx" ON "BulkMutationSubmission"("syncRunId");
CREATE INDEX IF NOT EXISTS "BulkMutationSubmission_editHistoryId_idx" ON "BulkMutationSubmission"("editHistoryId");
CREATE INDEX IF NOT EXISTS "BulkMutationOutcome_bulkMutationSubmissionId_status_idx" ON "BulkMutationOutcome"("bulkMutationSubmissionId", "status");
CREATE INDEX IF NOT EXISTS "BulkMutationOutcome_shop_status_createdAt_idx" ON "BulkMutationOutcome"("shop", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "BulkMutationOutcome_productId_idx" ON "BulkMutationOutcome"("productId");
CREATE INDEX IF NOT EXISTS "BulkMutationOutcome_variantId_idx" ON "BulkMutationOutcome"("variantId");

CREATE UNIQUE INDEX IF NOT EXISTS "VariantTombstone_shop_variantId_key" ON "VariantTombstone"("shop", "variantId");
CREATE INDEX IF NOT EXISTS "VariantTombstone_shop_productId_idx" ON "VariantTombstone"("shop", "productId");
CREATE INDEX IF NOT EXISTS "VariantTombstone_shop_deletedAt_idx" ON "VariantTombstone"("shop", "deletedAt");
CREATE INDEX IF NOT EXISTS "VariantTombstone_shop_purgeAfter_idx" ON "VariantTombstone"("shop", "purgeAfter");
CREATE INDEX IF NOT EXISTS "VariantTombstone_shop_updatedAt_idx" ON "VariantTombstone"("shop", "updatedAt");
