-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('FREE', 'PENDING', 'ACTIVE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('completed', 'processing', 'failed');

-- CreateEnum
CREATE TYPE "MirrorHealthState" AS ENUM ('HEALTHY', 'DEGRADED', 'UNSAFE', 'REPAIR_REQUIRED');

-- CreateEnum
CREATE TYPE "SyncProgressStage" AS ENUM ('IDLE', 'SHOPIFY_BULK_RUNNING', 'MIRROR_STAGING', 'RECONCILING');

-- CreateEnum
CREATE TYPE "SyncOperationType" AS ENUM ('Collection', 'ProductType', 'Product');

-- CreateEnum
CREATE TYPE "FilterTrackType" AS ENUM ('filter', 'preview');

-- CreateEnum
CREATE TYPE "RecurringEditStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecurringScheduleType" AS ENUM ('ONE_TIME', 'CRON', 'DAILY', 'WEEKLY', 'MONTHLY', 'EVERY_X_MINUTES');

-- CreateEnum
CREATE TYPE "RecurringEditRunStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AutomaticProductRuleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AutomaticProductRuleTriggerType" AS ENUM ('EVENT', 'SCHEDULED', 'HYBRID');

-- CreateEnum
CREATE TYPE "AutomaticRuleScheduleType" AS ENUM ('CRON', 'DAILY', 'WEEKLY', 'MONTHLY', 'EVERY_X_MINUTES');

-- CreateEnum
CREATE TYPE "AutomaticProductRuleScopeType" AS ENUM ('PRODUCT', 'VARIANT');

-- CreateEnum
CREATE TYPE "AutomaticProductRuleRunStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AutomaticProductRuleRunTriggerSource" AS ENUM ('SCHEDULE', 'WEBHOOK', 'MANUAL', 'REINDEX');

-- CreateEnum
CREATE TYPE "ProductCodeSnippetStatus" AS ENUM ('ACTIVE', 'DRAFT', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProductCodeSnippetLanguage" AS ENUM ('SNIPPET_DSL');

-- CreateEnum
CREATE TYPE "ProductCodeSnippetValidationStatus" AS ENUM ('VALID', 'INVALID');

-- CreateEnum
CREATE TYPE "EditHistoryTriggerType" AS ENUM ('MANUAL', 'SCHEDULED_ONCE', 'RECURRING', 'AUTOMATIC_RULE');

-- CreateEnum
CREATE TYPE "ScheduledExportStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScheduledExportRunStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ExportJobTriggerType" AS ENUM ('MANUAL', 'SCHEDULED');

-- CreateTable
CREATE TABLE "Product" (
    "shop" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "mirrorBatchId" TEXT NOT NULL,
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
    "googleShoppingEnabled" BOOLEAN,
    "googleShoppingAgeGroup" TEXT,
    "googleShoppingCategory" TEXT,
    "googleShoppingColor" TEXT,
    "googleShoppingCondition" TEXT,
    "googleShoppingCustomLabel0" TEXT,
    "googleShoppingCustomLabel1" TEXT,
    "googleShoppingCustomLabel2" TEXT,
    "googleShoppingCustomLabel3" TEXT,
    "googleShoppingCustomLabel4" TEXT,
    "googleShoppingCustomProduct" BOOLEAN,
    "googleShoppingGender" TEXT,
    "googleShoppingMpn" TEXT,
    "googleShoppingMaterial" TEXT,
    "googleShoppingSize" TEXT,
    "googleShoppingSizeSystem" TEXT,
    "googleShoppingSizeType" TEXT,
    "categoryAgeGroup" TEXT,
    "categoryColor" TEXT,
    "categoryFabric" TEXT,
    "categoryFit" TEXT,
    "categorySize" TEXT,
    "categoryTargetGender" TEXT,
    "categoryWaistRise" TEXT,
    "featuredImageUrl" TEXT,
    "featuredImageAltText" TEXT,
    "optionsJson" JSONB,
    "collectionsJson" JSONB,
    "option1Name" TEXT,
    "option2Name" TEXT,
    "option3Name" TEXT,
    "variantCount" INTEGER DEFAULT 0,
    "visibleOnlineStore" BOOLEAN,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("shop","id","mirrorBatchId")
);

-- CreateTable
CREATE TABLE "Variant" (
    "shop" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mirrorBatchId" TEXT NOT NULL,
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
    "cost" DOUBLE PRECISION,
    "countryOfOrigin" TEXT,
    "hsTariffCode" TEXT,
    "weight" DOUBLE PRECISION,
    "weightUnit" TEXT,
    "option1Value" TEXT,
    "option2Value" TEXT,
    "option3Value" TEXT,
    "physicalProduct" BOOLEAN,
    "profitMargin" DOUBLE PRECISION,
    "tracked" BOOLEAN,

    CONSTRAINT "Variant_pkey" PRIMARY KEY ("shop","id","mirrorBatchId")
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
    "activeMirrorBatchId" TEXT,
    "activeCollectionBatchId" TEXT,
    "isCollectionSyncing" BOOLEAN NOT NULL DEFAULT false,
    "lastCollectionSyncAt" TIMESTAMP(3),
    "isProductTypeSyncing" BOOLEAN NOT NULL DEFAULT false,
    "lastProductTypeSyncAt" TIMESTAMP(3),
    "isProductInitialySyning" BOOLEAN NOT NULL DEFAULT false,
    "productInitialSyncProgress" INTEGER NOT NULL DEFAULT 0,
    "syncProgressStage" "SyncProgressStage" NOT NULL DEFAULT 'IDLE',
    "shopifyBulkJobCompleted" BOOLEAN NOT NULL DEFAULT false,
    "storeTotalProducts" INTEGER NOT NULL DEFAULT 0,
    "isProductSyncing" BOOLEAN NOT NULL DEFAULT false,
    "lastProductSyncAt" TIMESTAMP(3),
    "mirrorHealthState" "MirrorHealthState" NOT NULL DEFAULT 'HEALTHY',
    "staleReason" TEXT,
    "repairRequired" BOOLEAN NOT NULL DEFAULT false,
    "lastFullSyncAt" TIMESTAMP(3),
    "lastIncrementalSyncAt" TIMESTAMP(3),
    "lastWebhookProcessedAt" TIMESTAMP(3),
    "lastReconcileAt" TIMESTAMP(3),
    "lastInventoryReconcileAt" TIMESTAMP(3),
    "lastCollectionReconcileAt" TIMESTAMP(3),
    "mirrorUnsafeSince" TIMESTAMP(3),
    "lastSyncErrorSummary" TEXT,
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
    "syncBatchId" TEXT,
    "responseUrl" TEXT,
    "status" "SyncStatus" NOT NULL DEFAULT 'processing',
    "stage" TEXT,
    "errorSummary" TEXT,
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
    "executionState" TEXT NOT NULL DEFAULT 'planned',
    "executionIdentity" TEXT,
    "targetSnapshotCount" INTEGER NOT NULL DEFAULT 0,
    "targetMirrorBatchId" TEXT,
    "failureStage" TEXT,
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
    "user" TEXT,
    "isFavourite" BOOLEAN NOT NULL DEFAULT false,
    "isSpreadsheetEdit" BOOLEAN NOT NULL DEFAULT false,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurringEditId" TEXT,
    "recurringRunId" TEXT,
    "automaticProductRuleId" TEXT,
    "automaticProductRuleRunId" TEXT,
    "triggerType" "EditHistoryTriggerType" NOT NULL DEFAULT 'MANUAL',
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringEdit" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "RecurringEditStatus" NOT NULL DEFAULT 'ACTIVE',
    "scheduleType" "RecurringScheduleType" NOT NULL,
    "timezone" TEXT NOT NULL,
    "scheduleConfig" JSONB NOT NULL,
    "cronExpression" TEXT,
    "intervalMinutes" INTEGER,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "filterParams" JSONB NOT NULL,
    "rules" JSONB NOT NULL,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastFailureReason" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringEdit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringEditRun" (
    "id" TEXT NOT NULL,
    "recurringEditId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "RecurringEditRunStatus" NOT NULL DEFAULT 'PENDING',
    "executionKey" TEXT NOT NULL,
    "errorMessage" TEXT,
    "editHistoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringEditRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomaticProductRule" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "AutomaticProductRuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "triggerType" "AutomaticProductRuleTriggerType" NOT NULL,
    "scheduleType" "AutomaticRuleScheduleType",
    "timezone" TEXT,
    "scheduleConfig" JSONB,
    "cronExpression" TEXT,
    "intervalMinutes" INTEGER,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "scopeType" "AutomaticProductRuleScopeType" NOT NULL,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "applyMode" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "cooldownMinutes" INTEGER,
    "maxAffectedPerRun" INTEGER,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastFailureReason" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomaticProductRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomaticProductRuleRun" (
    "id" TEXT NOT NULL,
    "automaticProductRuleId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "triggerSource" "AutomaticProductRuleRunTriggerSource" NOT NULL,
    "triggerReference" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "AutomaticProductRuleRunStatus" NOT NULL DEFAULT 'PENDING',
    "executionKey" TEXT NOT NULL,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "affectedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "editHistoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomaticProductRuleRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomaticProductRuleProductState" (
    "id" TEXT NOT NULL,
    "automaticProductRuleId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lastMatchedAt" TIMESTAMP(3),
    "lastAppliedAt" TIMESTAMP(3),
    "lastFingerprint" TEXT,
    "suppressedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomaticProductRuleProductState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCodeSnippet" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ProductCodeSnippetStatus" NOT NULL DEFAULT 'DRAFT',
    "language" "ProductCodeSnippetLanguage" NOT NULL DEFAULT 'SNIPPET_DSL',
    "code" TEXT NOT NULL,
    "normalizedAst" JSONB,
    "lastValidationStatus" "ProductCodeSnippetValidationStatus",
    "lastValidationError" TEXT,
    "lastPreviewedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCodeSnippet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "shop" TEXT,
    "shopifyId" TEXT,
    "mirrorBatchId" TEXT,
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
CREATE TABLE "ScheduledExport" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ScheduledExportStatus" NOT NULL DEFAULT 'ACTIVE',
    "scheduleType" "RecurringScheduleType" NOT NULL,
    "timezone" TEXT NOT NULL,
    "scheduleConfig" JSONB NOT NULL,
    "cronExpression" TEXT,
    "intervalMinutes" INTEGER,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "filterParams" JSONB NOT NULL,
    "fields" TEXT[],
    "filename" TEXT NOT NULL,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastFailureReason" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledExportRun" (
    "id" TEXT NOT NULL,
    "scheduledExportId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "ScheduledExportRunStatus" NOT NULL DEFAULT 'PENDING',
    "executionKey" TEXT NOT NULL,
    "errorMessage" TEXT,
    "exportJobId" TEXT,
    "fileUrl" TEXT,
    "totalItems" INTEGER,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledExportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "filterQuery" TEXT NOT NULL DEFAULT '{}',
    "executionState" TEXT NOT NULL DEFAULT 'planned',
    "targetSnapshotCount" INTEGER NOT NULL DEFAULT 0,
    "targetMirrorBatchId" TEXT,
    "failureStage" TEXT,
    "filename" TEXT NOT NULL,
    "fields" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "fileUrl" TEXT,
    "type" TEXT NOT NULL DEFAULT 'Manual export',
    "isScheduled" BOOLEAN NOT NULL DEFAULT false,
    "scheduledExportId" TEXT,
    "scheduledExportRunId" TEXT,
    "triggerType" "ExportJobTriggerType" NOT NULL DEFAULT 'MANUAL',
    "totalItems" INTEGER,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeRecord" (
    "id" TEXT NOT NULL,
    "editHistoryId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "options" JSONB,
    "productFieldChanges" JSONB,
    "variantFieldChanges" JSONB,
    "image" TEXT,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilterTrack" (
    "id" TEXT NOT NULL,
    "shop" TEXT,
    "filterParams" JSONB,
    "previewFilterParams" JSONB,
    "respondProductCount" INTEGER,
    "previewResCount" INTEGER,
    "type" "FilterTrackType" NOT NULL DEFAULT 'filter',
    "field" TEXT,
    "editOption" TEXT,
    "searchKey" TEXT,
    "replaceText" TEXT,
    "supportValue" TEXT,
    "value" JSONB,
    "en" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FilterTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralCode" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateUser" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "referralLink" TEXT NOT NULL,
    "numberOfReferrals" INTEGER NOT NULL DEFAULT 0,
    "numberOfStoresSubscribed" INTEGER NOT NULL DEFAULT 0,
    "totalAmountEarned" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "shop" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("shop","id")
);

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" BIGSERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'error',
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "source" TEXT,
    "request" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TargetSnapshot" (
    "id" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mirrorBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TargetSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MirrorAnomaly" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MirrorAnomaly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopify_sessions" (
    "id" VARCHAR(255) NOT NULL,
    "shop" VARCHAR(255) NOT NULL,
    "state" VARCHAR(255) NOT NULL,
    "isOnline" BOOLEAN NOT NULL,
    "scope" VARCHAR(1024),
    "expires" INTEGER,
    "onlineAccessInfo" VARCHAR(255),
    "accessToken" VARCHAR(255),

    CONSTRAINT "shopify_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopify_sessions_migrations" (
    "migration_name" VARCHAR(255) NOT NULL,

    CONSTRAINT "shopify_sessions_migrations_pkey" PRIMARY KEY ("migration_name")
);

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_idx" ON "Product"("shop", "mirrorBatchId");

-- CreateIndex
CREATE INDEX "Product_shop_status_idx" ON "Product"("shop", "status");

-- CreateIndex
CREATE INDEX "Product_shop_vendor_idx" ON "Product"("shop", "vendor");

-- CreateIndex
CREATE INDEX "Product_shop_productType_idx" ON "Product"("shop", "productType");

-- CreateIndex
CREATE INDEX "Product_shop_title_idx" ON "Product"("shop", "title");

-- CreateIndex
CREATE INDEX "Product_shop_handle_idx" ON "Product"("shop", "handle");

-- CreateIndex
CREATE INDEX "Product_shop_createdAt_idx" ON "Product"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "Product_shop_updatedAt_idx" ON "Product"("shop", "updatedAt");

-- CreateIndex
CREATE INDEX "Product_shop_publishedAt_idx" ON "Product"("shop", "publishedAt");

-- CreateIndex
CREATE INDEX "Product_shop_categoryName_idx" ON "Product"("shop", "categoryName");

-- CreateIndex
CREATE INDEX "Product_shop_googleShoppingEnabled_idx" ON "Product"("shop", "googleShoppingEnabled");

-- CreateIndex
CREATE INDEX "Product_shop_googleShoppingCategory_idx" ON "Product"("shop", "googleShoppingCategory");

-- CreateIndex
CREATE INDEX "Product_shop_googleShoppingCondition_idx" ON "Product"("shop", "googleShoppingCondition");

-- CreateIndex
CREATE INDEX "Product_shop_googleShoppingGender_idx" ON "Product"("shop", "googleShoppingGender");

-- CreateIndex
CREATE INDEX "Product_shop_googleShoppingAgeGroup_idx" ON "Product"("shop", "googleShoppingAgeGroup");

-- CreateIndex
CREATE INDEX "Product_shop_categoryColor_idx" ON "Product"("shop", "categoryColor");

-- CreateIndex
CREATE INDEX "Product_shop_categorySize_idx" ON "Product"("shop", "categorySize");

-- CreateIndex
CREATE INDEX "Product_shop_categoryTargetGender_idx" ON "Product"("shop", "categoryTargetGender");

-- CreateIndex
CREATE INDEX "Product_shop_templateSuffix_idx" ON "Product"("shop", "templateSuffix");

-- CreateIndex
CREATE INDEX "Product_shop_option1Name_idx" ON "Product"("shop", "option1Name");

-- CreateIndex
CREATE INDEX "Product_shop_option2Name_idx" ON "Product"("shop", "option2Name");

-- CreateIndex
CREATE INDEX "Product_shop_option3Name_idx" ON "Product"("shop", "option3Name");

-- CreateIndex
CREATE INDEX "Product_shop_variantCount_idx" ON "Product"("shop", "variantCount");

-- CreateIndex
CREATE INDEX "Product_shop_visibleOnlineStore_idx" ON "Product"("shop", "visibleOnlineStore");

-- CreateIndex
CREATE INDEX "Variant_shop_mirrorBatchId_idx" ON "Variant"("shop", "mirrorBatchId");

-- CreateIndex
CREATE INDEX "Variant_shop_sku_idx" ON "Variant"("shop", "sku");

-- CreateIndex
CREATE INDEX "Variant_shop_price_idx" ON "Variant"("shop", "price");

-- CreateIndex
CREATE INDEX "Variant_shop_productId_idx" ON "Variant"("shop", "productId");

-- CreateIndex
CREATE INDEX "Variant_shop_barcode_idx" ON "Variant"("shop", "barcode");

-- CreateIndex
CREATE INDEX "Variant_shop_title_idx" ON "Variant"("shop", "title");

-- CreateIndex
CREATE INDEX "Variant_shop_compareAtPrice_idx" ON "Variant"("shop", "compareAtPrice");

-- CreateIndex
CREATE INDEX "Variant_shop_cost_idx" ON "Variant"("shop", "cost");

-- CreateIndex
CREATE INDEX "Variant_shop_inventoryQuantity_idx" ON "Variant"("shop", "inventoryQuantity");

-- CreateIndex
CREATE INDEX "Variant_shop_inventoryPolicy_idx" ON "Variant"("shop", "inventoryPolicy");

-- CreateIndex
CREATE INDEX "Variant_shop_taxable_idx" ON "Variant"("shop", "taxable");

-- CreateIndex
CREATE INDEX "Variant_shop_weight_idx" ON "Variant"("shop", "weight");

-- CreateIndex
CREATE INDEX "Variant_shop_weightUnit_idx" ON "Variant"("shop", "weightUnit");

-- CreateIndex
CREATE INDEX "Variant_shop_countryOfOrigin_idx" ON "Variant"("shop", "countryOfOrigin");

-- CreateIndex
CREATE INDEX "Variant_shop_hsTariffCode_idx" ON "Variant"("shop", "hsTariffCode");

-- CreateIndex
CREATE INDEX "Variant_shop_option1Value_idx" ON "Variant"("shop", "option1Value");

-- CreateIndex
CREATE INDEX "Variant_shop_option2Value_idx" ON "Variant"("shop", "option2Value");

-- CreateIndex
CREATE INDEX "Variant_shop_option3Value_idx" ON "Variant"("shop", "option3Value");

-- CreateIndex
CREATE INDEX "Variant_shop_tracked_idx" ON "Variant"("shop", "tracked");

-- CreateIndex
CREATE INDEX "Variant_shop_physicalProduct_idx" ON "Variant"("shop", "physicalProduct");

-- CreateIndex
CREATE INDEX "Variant_shop_profitMargin_idx" ON "Variant"("shop", "profitMargin");

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
CREATE UNIQUE INDEX "EditHistory_executionIdentity_key" ON "EditHistory"("executionIdentity");

-- CreateIndex
CREATE UNIQUE INDEX "EditHistory_automaticProductRuleRunId_key" ON "EditHistory"("automaticProductRuleRunId");

-- CreateIndex
CREATE INDEX "shop_status_type_recent" ON "EditHistory"("shop", "status", "type", "updatedAt");

-- CreateIndex
CREATE INDEX "EditHistory_shop_idx" ON "EditHistory"("shop");

-- CreateIndex
CREATE INDEX "EditHistory_shop_executionState_idx" ON "EditHistory"("shop", "executionState");

-- CreateIndex
CREATE INDEX "EditHistory_isSpreadsheetEdit_idx" ON "EditHistory"("isSpreadsheetEdit");

-- CreateIndex
CREATE INDEX "EditHistory_recurringEditId_idx" ON "EditHistory"("recurringEditId");

-- CreateIndex
CREATE INDEX "EditHistory_recurringRunId_idx" ON "EditHistory"("recurringRunId");

-- CreateIndex
CREATE INDEX "EditHistory_automaticProductRuleId_idx" ON "EditHistory"("automaticProductRuleId");

-- CreateIndex
CREATE INDEX "EditHistory_automaticProductRuleRunId_idx" ON "EditHistory"("automaticProductRuleRunId");

-- CreateIndex
CREATE INDEX "RecurringEdit_shop_idx" ON "RecurringEdit"("shop");

-- CreateIndex
CREATE INDEX "RecurringEdit_shop_status_idx" ON "RecurringEdit"("shop", "status");

-- CreateIndex
CREATE INDEX "RecurringEdit_shop_nextRunAt_idx" ON "RecurringEdit"("shop", "nextRunAt");

-- CreateIndex
CREATE INDEX "RecurringEdit_nextRunAt_idx" ON "RecurringEdit"("nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringEditRun_executionKey_key" ON "RecurringEditRun"("executionKey");

-- CreateIndex
CREATE INDEX "RecurringEditRun_recurringEditId_idx" ON "RecurringEditRun"("recurringEditId");

-- CreateIndex
CREATE INDEX "RecurringEditRun_shop_status_idx" ON "RecurringEditRun"("shop", "status");

-- CreateIndex
CREATE INDEX "RecurringEditRun_shop_scheduledFor_idx" ON "RecurringEditRun"("shop", "scheduledFor");

-- CreateIndex
CREATE INDEX "RecurringEditRun_editHistoryId_idx" ON "RecurringEditRun"("editHistoryId");

-- CreateIndex
CREATE INDEX "AutomaticProductRule_shop_status_idx" ON "AutomaticProductRule"("shop", "status");

-- CreateIndex
CREATE INDEX "AutomaticProductRule_shop_nextRunAt_idx" ON "AutomaticProductRule"("shop", "nextRunAt");

-- CreateIndex
CREATE INDEX "AutomaticProductRule_shop_triggerType_idx" ON "AutomaticProductRule"("shop", "triggerType");

-- CreateIndex
CREATE INDEX "AutomaticProductRule_shop_priority_status_idx" ON "AutomaticProductRule"("shop", "priority", "status");

-- CreateIndex
CREATE INDEX "AutomaticProductRule_shop_createdAt_idx" ON "AutomaticProductRule"("shop", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomaticProductRuleRun_executionKey_key" ON "AutomaticProductRuleRun"("executionKey");

-- CreateIndex
CREATE INDEX "AutomaticProductRuleRun_shop_status_createdAt_idx" ON "AutomaticProductRuleRun"("shop", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AutomaticProductRuleRun_automaticProductRuleId_createdAt_idx" ON "AutomaticProductRuleRun"("automaticProductRuleId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomaticProductRuleRun_automaticProductRuleId_scheduledFor_idx" ON "AutomaticProductRuleRun"("automaticProductRuleId", "scheduledFor");

-- CreateIndex
CREATE INDEX "AutomaticProductRuleRun_editHistoryId_idx" ON "AutomaticProductRuleRun"("editHistoryId");

-- CreateIndex
CREATE INDEX "AutomaticProductRuleProductState_shop_productId_idx" ON "AutomaticProductRuleProductState"("shop", "productId");

-- CreateIndex
CREATE INDEX "AutomaticProductRuleProductState_automaticProductRuleId_sup_idx" ON "AutomaticProductRuleProductState"("automaticProductRuleId", "suppressedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "AutomaticProductRuleProductState_automaticProductRuleId_sho_key" ON "AutomaticProductRuleProductState"("automaticProductRuleId", "shop", "productId");

-- CreateIndex
CREATE INDEX "ProductCodeSnippet_shop_status_idx" ON "ProductCodeSnippet"("shop", "status");

-- CreateIndex
CREATE INDEX "ProductCodeSnippet_shop_createdAt_idx" ON "ProductCodeSnippet"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "ProductCodeSnippet_shop_updatedAt_idx" ON "ProductCodeSnippet"("shop", "updatedAt");

-- CreateIndex
CREATE INDEX "Collection_updatedAt_idx" ON "Collection"("updatedAt");

-- CreateIndex
CREATE INDEX "Collection_shop_mirrorBatchId_idx" ON "Collection"("shop", "mirrorBatchId");

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
CREATE INDEX "ScheduledExport_shop_idx" ON "ScheduledExport"("shop");

-- CreateIndex
CREATE INDEX "ScheduledExport_shop_status_idx" ON "ScheduledExport"("shop", "status");

-- CreateIndex
CREATE INDEX "ScheduledExport_shop_nextRunAt_idx" ON "ScheduledExport"("shop", "nextRunAt");

-- CreateIndex
CREATE INDEX "ScheduledExport_nextRunAt_idx" ON "ScheduledExport"("nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledExportRun_executionKey_key" ON "ScheduledExportRun"("executionKey");

-- CreateIndex
CREATE INDEX "ScheduledExportRun_scheduledExportId_idx" ON "ScheduledExportRun"("scheduledExportId");

-- CreateIndex
CREATE INDEX "ScheduledExportRun_shop_status_idx" ON "ScheduledExportRun"("shop", "status");

-- CreateIndex
CREATE INDEX "ScheduledExportRun_shop_scheduledFor_idx" ON "ScheduledExportRun"("shop", "scheduledFor");

-- CreateIndex
CREATE INDEX "ScheduledExportRun_exportJobId_idx" ON "ScheduledExportRun"("exportJobId");

-- CreateIndex
CREATE INDEX "ExportJob_shop_idx" ON "ExportJob"("shop");

-- CreateIndex
CREATE INDEX "ExportJob_shop_executionState_idx" ON "ExportJob"("shop", "executionState");

-- CreateIndex
CREATE INDEX "ExportJob_status_idx" ON "ExportJob"("status");

-- CreateIndex
CREATE INDEX "ExportJob_scheduledExportId_idx" ON "ExportJob"("scheduledExportId");

-- CreateIndex
CREATE INDEX "ExportJob_scheduledExportRunId_idx" ON "ExportJob"("scheduledExportRunId");

-- CreateIndex
CREATE INDEX "ChangeRecord_editHistoryId_idx" ON "ChangeRecord"("editHistoryId");

-- CreateIndex
CREATE INDEX "ChangeRecord_productId_idx" ON "ChangeRecord"("productId");

-- CreateIndex
CREATE INDEX "ChangeRecord_shop_idx" ON "ChangeRecord"("shop");

-- CreateIndex
CREATE INDEX "ChangeRecord_status_idx" ON "ChangeRecord"("status");

-- CreateIndex
CREATE INDEX "ChangeRecord_batchId_idx" ON "ChangeRecord"("batchId");

-- CreateIndex
CREATE INDEX "FilterTrack_shop_idx" ON "FilterTrack"("shop");

-- CreateIndex
CREATE INDEX "FilterTrack_type_idx" ON "FilterTrack"("type");

-- CreateIndex
CREATE INDEX "ReferralCode_shop_idx" ON "ReferralCode"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateUser_email_key" ON "AffiliateUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateUser_referralCode_key" ON "AffiliateUser"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateUser_referralLink_key" ON "AffiliateUser"("referralLink");

-- CreateIndex
CREATE INDEX "AffiliateUser_referralCode_idx" ON "AffiliateUser"("referralCode");

-- CreateIndex
CREATE INDEX "Location_shop_idx" ON "Location"("shop");

-- CreateIndex
CREATE INDEX "ErrorLog_shop_idx" ON "ErrorLog"("shop");

-- CreateIndex
CREATE INDEX "ErrorLog_type_idx" ON "ErrorLog"("type");

-- CreateIndex
CREATE INDEX "ErrorLog_level_idx" ON "ErrorLog"("level");

-- CreateIndex
CREATE INDEX "ErrorLog_source_idx" ON "ErrorLog"("source");

-- CreateIndex
CREATE INDEX "ErrorLog_createdAt_idx" ON "ErrorLog"("createdAt");

-- CreateIndex
CREATE INDEX "TargetSnapshot_ownerType_ownerId_idx" ON "TargetSnapshot"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "TargetSnapshot_shop_ownerType_createdAt_idx" ON "TargetSnapshot"("shop", "ownerType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TargetSnapshot_ownerType_ownerId_productId_key" ON "TargetSnapshot"("ownerType", "ownerId", "productId");

-- CreateIndex
CREATE INDEX "MirrorAnomaly_shop_createdAt_idx" ON "MirrorAnomaly"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "MirrorAnomaly_shop_severity_createdAt_idx" ON "MirrorAnomaly"("shop", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "MirrorAnomaly_shop_type_createdAt_idx" ON "MirrorAnomaly"("shop", "type", "createdAt");

-- AddForeignKey
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_shop_productId_mirrorBatchId_fkey" FOREIGN KEY ("shop", "productId", "mirrorBatchId") REFERENCES "Product"("shop", "id", "mirrorBatchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringEditRun" ADD CONSTRAINT "RecurringEditRun_recurringEditId_fkey" FOREIGN KEY ("recurringEditId") REFERENCES "RecurringEdit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomaticProductRuleRun" ADD CONSTRAINT "AutomaticProductRuleRun_automaticProductRuleId_fkey" FOREIGN KEY ("automaticProductRuleId") REFERENCES "AutomaticProductRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomaticProductRuleProductState" ADD CONSTRAINT "AutomaticProductRuleProductState_automaticProductRuleId_fkey" FOREIGN KEY ("automaticProductRuleId") REFERENCES "AutomaticProductRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledExportRun" ADD CONSTRAINT "ScheduledExportRun_scheduledExportId_fkey" FOREIGN KEY ("scheduledExportId") REFERENCES "ScheduledExport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRecord" ADD CONSTRAINT "ChangeRecord_editHistoryId_fkey" FOREIGN KEY ("editHistoryId") REFERENCES "EditHistory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
