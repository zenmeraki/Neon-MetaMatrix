-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('FREE', 'PENDING', 'ACTIVE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('completed', 'processing', 'failed');

-- CreateEnum
CREATE TYPE "SyncOperationType" AS ENUM ('Collection', 'ProductType', 'Product');

-- CreateTable
CREATE TABLE "Product" (
    "shop" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "status" TEXT NOT NULL,
    "productType" TEXT,
    "vendor" TEXT,
    "tags" TEXT[],
    "templateSuffix" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "totalInventory" INTEGER,
    "categoryId" TEXT,
    "categoryName" TEXT,
    "featuredImageUrl" TEXT,
    "featuredImageAltText" TEXT,
    "optionsJson" JSONB,
    "collectionsJson" JSONB,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("shop","id")
);

-- CreateTable
CREATE TABLE "Variant" (
    "shop" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "price" DOUBLE PRECISION,
    "compareAtPrice" DOUBLE PRECISION,
    "inventoryQuantity" INTEGER,
    "inventoryPolicy" TEXT,
    "taxable" BOOLEAN,
    "taxCode" TEXT,
    "position" INTEGER,
    "selectedOptionsJson" JSONB,

    CONSTRAINT "Variant_pkey" PRIMARY KEY ("shop","id")
);

-- CreateTable
CREATE TABLE "SpreadsheetFile" (
    "id" TEXT NOT NULL,
    "shop" TEXT,
    "editHistoryId" TEXT,
    "fileUrl" TEXT,
    "columnMappings" JSONB,
    "totalRows" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpreadsheetFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "shopUrl" TEXT NOT NULL,
    "shopEmail" TEXT NOT NULL,
    "accessToken" TEXT,
    "isCollectionSyncing" BOOLEAN NOT NULL DEFAULT false,
    "lastCollectionSyncAt" TIMESTAMP(3),
    "isProductTypeSyncing" BOOLEAN NOT NULL DEFAULT false,
    "lastProductTypeSyncAt" TIMESTAMP(3),
    "isProductInitialySyning" BOOLEAN NOT NULL DEFAULT false,
    "productInitialSyncProgress" INTEGER NOT NULL DEFAULT 0,
    "shopifyBulkJobCompleted" BOOLEAN NOT NULL DEFAULT false,
    "storeTotalProducts" INTEGER NOT NULL DEFAULT 0,
    "isProductSyncing" BOOLEAN NOT NULL DEFAULT false,
    "lastProductSyncAt" TIMESTAMP(3),
    "scope" TEXT DEFAULT '',
    "installedAt" TIMESTAMP(3),
    "unInstalledAt" TIMESTAMP(3),
    "isUnInstalled" BOOLEAN NOT NULL DEFAULT false,
    "referralCode" TEXT,
    "referralLink" TEXT,
    "referredBy" TEXT,
    "refIsFirstSubscriptionCompleted" BOOLEAN NOT NULL DEFAULT false,
    "refSubscribedDate" TIMESTAMP(3),
    "refRewardExpiresAt" TIMESTAMP(3),
    "refRewarded" BOOLEAN NOT NULL DEFAULT false,
    "refSubscribedPlanDetails" JSONB,
    "refEarnedPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isCreditAvailable" BOOLEAN NOT NULL DEFAULT false,
    "lastActivityAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "planKey" TEXT,
    "planName" TEXT,
    "subscriptionId" TEXT,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'FREE',
    "pendingSubscriptionId" TEXT,
    "pendingPlanKey" TEXT,
    "pendingPlanName" TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suggestion" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "suggestion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncHistory" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "bulkOperationId" TEXT,
    "responseUrl" TEXT,
    "status" "SyncStatus" NOT NULL DEFAULT 'processing',
    "duration" INTEGER DEFAULT 0,
    "recordCount" INTEGER,
    "operationType" "SyncOperationType",
    "isInitialProductSync" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditHistory" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "bulkOperationId" TEXT,
    "title" JSONB,
    "queryFilter" TEXT NOT NULL DEFAULT '',
    "editedType" TEXT,
    "rules" JSONB,
    "affectedFields" JSONB,
    "locationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduledAt" TIMESTAMP(3),
    "scheduledUndoAt" TIMESTAMP(3),
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "editTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "undo" JSONB,
    "batch" JSONB,
    "type" TEXT DEFAULT 'Manual edit',
    "processingBatchId" TEXT,
    "scheduledTask" TEXT,
    "importFileId" TEXT,
    "user" TEXT,
    "isFavourite" BOOLEAN NOT NULL DEFAULT false,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "shop" TEXT,
    "shopifyId" TEXT,
    "title" TEXT,
    "handle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportHistory" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "exportedData" TEXT,
    "status" TEXT NOT NULL,
    "duration" TEXT NOT NULL,
    "totalItems" INTEGER,
    "errorMessage" TEXT,
    "exportTime" TIMESTAMP(3),
    "type" TEXT NOT NULL DEFAULT 'Manual export',
    "isFavourite" BOOLEAN NOT NULL DEFAULT false,
    "scheduledTask" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "filterQuery" TEXT NOT NULL DEFAULT '{}',
    "filename" TEXT NOT NULL,
    "fields" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "fileUrl" TEXT,
    "type" TEXT NOT NULL DEFAULT 'Manual export',
    "totalItems" INTEGER,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_shop_status_idx" ON "Product"("shop", "status");

-- CreateIndex
CREATE INDEX "Product_shop_vendor_idx" ON "Product"("shop", "vendor");

-- CreateIndex
CREATE INDEX "Product_shop_productType_idx" ON "Product"("shop", "productType");

-- CreateIndex
CREATE INDEX "Variant_shop_sku_idx" ON "Variant"("shop", "sku");

-- CreateIndex
CREATE INDEX "Variant_shop_price_idx" ON "Variant"("shop", "price");

-- CreateIndex
CREATE INDEX "Variant_shop_productId_idx" ON "Variant"("shop", "productId");

-- CreateIndex
CREATE INDEX "SpreadsheetFile_shop_idx" ON "SpreadsheetFile"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Store_shopUrl_key" ON "Store"("shopUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Store_referralCode_key" ON "Store"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "Store_referralLink_key" ON "Store"("referralLink");

-- CreateIndex
CREATE INDEX "Store_isProductSyncing_idx" ON "Store"("isProductSyncing");

-- CreateIndex
CREATE INDEX "Store_lastProductSyncAt_idx" ON "Store"("lastProductSyncAt");

-- CreateIndex
CREATE INDEX "Store_isCollectionSyncing_idx" ON "Store"("isCollectionSyncing");

-- CreateIndex
CREATE INDEX "Store_lastCollectionSyncAt_idx" ON "Store"("lastCollectionSyncAt");

-- CreateIndex
CREATE INDEX "Store_lastProductTypeSyncAt_idx" ON "Store"("lastProductTypeSyncAt");

-- CreateIndex
CREATE INDEX "Store_referralCode_idx" ON "Store"("referralCode");

-- CreateIndex
CREATE INDEX "Store_referredBy_idx" ON "Store"("referredBy");

-- CreateIndex
CREATE INDEX "Store_lastActivityAt_idx" ON "Store"("lastActivityAt");

-- CreateIndex
CREATE INDEX "Store_isUnInstalled_idx" ON "Store"("isUnInstalled");

-- CreateIndex
CREATE INDEX "Store_installedAt_idx" ON "Store"("installedAt");

-- CreateIndex
CREATE INDEX "Store_createdAt_idx" ON "Store"("createdAt");

-- CreateIndex
CREATE INDEX "Subscription_shop_idx" ON "Subscription"("shop");

-- CreateIndex
CREATE INDEX "Suggestion_email_idx" ON "Suggestion"("email");

-- CreateIndex
CREATE INDEX "SyncHistory_shop_createdAt_idx" ON "SyncHistory"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "SyncHistory_shop_status_idx" ON "SyncHistory"("shop", "status");

-- CreateIndex
CREATE INDEX "SyncHistory_shop_operationType_idx" ON "SyncHistory"("shop", "operationType");

-- CreateIndex
CREATE INDEX "shop_status_type_recent" ON "EditHistory"("shop", "status", "type", "updatedAt");

-- CreateIndex
CREATE INDEX "EditHistory_shop_idx" ON "EditHistory"("shop");

-- CreateIndex
CREATE INDEX "Collection_updatedAt_idx" ON "Collection"("updatedAt");

-- CreateIndex
CREATE INDEX "Collection_shop_title_idx" ON "Collection"("shop", "title");

-- CreateIndex
CREATE INDEX "ExportHistory_shop_createdAt_idx" ON "ExportHistory"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "ExportHistory_shop_status_idx" ON "ExportHistory"("shop", "status");

-- CreateIndex
CREATE INDEX "ExportHistory_shop_isFavourite_idx" ON "ExportHistory"("shop", "isFavourite");

-- CreateIndex
CREATE INDEX "ExportHistory_shop_type_idx" ON "ExportHistory"("shop", "type");

-- CreateIndex
CREATE INDEX "ExportHistory_shop_exportTime_idx" ON "ExportHistory"("shop", "exportTime");

-- CreateIndex
CREATE INDEX "ExportJob_shop_idx" ON "ExportJob"("shop");

-- CreateIndex
CREATE INDEX "ExportJob_status_idx" ON "ExportJob"("status");

-- AddForeignKey
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_shop_productId_fkey" FOREIGN KEY ("shop", "productId") REFERENCES "Product"("shop", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditHistory" ADD CONSTRAINT "EditHistory_importFileId_fkey" FOREIGN KEY ("importFileId") REFERENCES "SpreadsheetFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
