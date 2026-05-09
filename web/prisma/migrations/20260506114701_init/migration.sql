-- CreateEnum
CREATE TYPE "MerchantOperationType" AS ENUM ('BULK_EDIT', 'BULK_UNDO', 'EXPORT', 'IMPORT', 'SCHEDULED_EDIT', 'SCHEDULED_EXPORT');

-- CreateEnum
CREATE TYPE "MerchantOperationStatus" AS ENUM ('PLANNED', 'SNAPSHOTTING', 'SNAPSHOTTED', 'DISPATCHING', 'AWAITING_SHOPIFY', 'APPLYING_RESULTS', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OperationSubmissionType" AS ENUM ('SHOPIFY_BULK_QUERY', 'SHOPIFY_BULK_MUTATION', 'CSV_EXPORT', 'IMPORT_APPLY');

-- CreateEnum
CREATE TYPE "OperationSubmissionStatus" AS ENUM ('PLANNED', 'STAGED', 'SUBMITTED', 'AWAITING_SHOPIFY', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExportArtifactStatus" AS ENUM ('PLANNED', 'GENERATING', 'STORED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('FREE', 'PENDING', 'ACTIVE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('completed', 'processing', 'failed');

-- CreateEnum
CREATE TYPE "MirrorHealthState" AS ENUM ('HEALTHY', 'DEGRADED', 'UNSAFE', 'REPAIR_REQUIRED');

-- CreateEnum
CREATE TYPE "SyncProgressStage" AS ENUM ('IDLE', 'SHOPIFY_BULK_STARTING', 'SHOPIFY_BULK_RUNNING', 'MIRROR_STAGING', 'RECONCILING');

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
CREATE TYPE "AutomaticProductRuleRunTriggerSource" AS ENUM ('SCHEDULE', 'WEBHOOK', 'MANUAL', 'DRY_RUN', 'REINDEX');

-- CreateEnum
CREATE TYPE "RuleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DELETED');

-- CreateEnum
CREATE TYPE "RuleMode" AS ENUM ('REALTIME', 'SCHEDULED', 'MANUAL', 'DRY_RUN');

-- CreateEnum
CREATE TYPE "RuleRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "RuleExecutionStatus" AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED');

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
CREATE TYPE "ScheduledExportFrequency" AS ENUM ('HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ScheduledExportRunStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ExportJobTriggerType" AS ENUM ('MANUAL', 'SCHEDULED');

-- CreateTable
CREATE TABLE "Product" (
    "shop" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "mirrorBatchId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "status" TEXT NOT NULL,
    "productType" TEXT,
    "vendor" TEXT,
    "tags" TEXT[],
    "templateSuffix" TEXT,
    "descriptionHtml" TEXT,
    "descriptionText" TEXT,
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
    "lastSourceUpdatedAt" TIMESTAMP(3),
    "lastSourceEventAt" TIMESTAMP(3),
    "lastSourceKind" TEXT,
    "lastReconciledAt" TIMESTAMP(3),

    CONSTRAINT "Product_pkey" PRIMARY KEY ("shop","id","mirrorBatchId")
);

-- CreateTable
CREATE TABLE "Variant" (
    "shop" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mirrorBatchId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
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
    "operationId" TEXT,
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
    "mirrorSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "activeCollectionBatchId" TEXT,
    "isCollectionSyncing" BOOLEAN NOT NULL DEFAULT false,
    "collectionSyncStartedAt" TIMESTAMP(3),
    "collectionSyncLeaseOwner" TEXT,
    "collectionSyncLeaseExpiresAt" TIMESTAMP(3),
    "lastCollectionSyncAt" TIMESTAMP(3),
    "isProductTypeSyncing" BOOLEAN NOT NULL DEFAULT false,
    "lastProductTypeSyncAt" TIMESTAMP(3),
    "isProductInitialySyning" BOOLEAN NOT NULL DEFAULT false,
    "productInitialSyncProgress" INTEGER NOT NULL DEFAULT 0,
    "syncProgressStage" "SyncProgressStage" NOT NULL DEFAULT 'IDLE',
    "syncLeaseOwner" TEXT,
    "syncLeaseExpiresAt" TIMESTAMP(3),
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
    "errorMessage" TEXT,
    "duration" INTEGER DEFAULT 0,
    "recordCount" INTEGER,
    "operationType" "SyncOperationType",
    "isInitialProductSync" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "executionState" TEXT NOT NULL DEFAULT 'planned',
    "executionIdentity" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SyncHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditHistory" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "operationId" TEXT,
    "bulkOperationId" TEXT,
    "executionState" TEXT NOT NULL DEFAULT 'planned',
    "executionIdentity" TEXT,
    "targetSnapshotCount" INTEGER NOT NULL DEFAULT 0,
    "targetMirrorBatchId" TEXT,
    "failureStage" TEXT,
    "title" JSONB,
    "summary" JSONB,
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
    "undoState" TEXT,
    "undoExecutionIdentity" TEXT,
    "undoQueuedAt" TIMESTAMP(3),
    "undoStartedAt" TIMESTAMP(3),
    "undoCompletedAt" TIMESTAMP(3),
    "undoBulkOperationId" TEXT,
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
    "filterVersion" INTEGER,
    "canonicalFilterKey" TEXT,

    CONSTRAINT "EditHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkUndoExecution" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "historyId" TEXT NOT NULL,
    "operationId" TEXT,
    "executionIdentity" TEXT NOT NULL,
    "mirrorBatchId" TEXT,
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
    "filterVersion" INTEGER NOT NULL DEFAULT 1,
    "canonicalFilterKey" TEXT,

    CONSTRAINT "RecurringEdit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringEditRun" (
    "id" TEXT NOT NULL,
    "recurringEditId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "operationId" TEXT,
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
    "scope" JSONB,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "applyMode" TEXT NOT NULL,
    "executionMode" TEXT NOT NULL DEFAULT 'REALTIME',
    "conflictStrategy" TEXT NOT NULL DEFAULT 'PRIORITY_WINS',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "cooldownMinutes" INTEGER,
    "maxExecutionsPerHour" INTEGER,
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
    "filterVersion" INTEGER NOT NULL DEFAULT 1,
    "canonicalFilterKey" TEXT,

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
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "RuleStatus" NOT NULL,
    "mode" "RuleMode" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "scopeType" TEXT NOT NULL,
    "scopeRefId" TEXT,
    "filterDsl" JSONB NOT NULL,
    "actionDsl" JSONB NOT NULL,
    "conflictStrategy" TEXT NOT NULL,
    "allowDestructive" BOOLEAN NOT NULL DEFAULT false,
    "cooldownSeconds" INTEGER NOT NULL DEFAULT 0,
    "maxRunsPerHour" INTEGER,
    "lastRunAt" TIMESTAMP(3),
    "lastRunHash" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentRuleId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleVersion" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "filterDsl" JSONB NOT NULL,
    "actionDsl" JSONB NOT NULL,
    "snapshotNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleRun" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "operationId" TEXT,
    "triggerType" TEXT NOT NULL,
    "triggerEventId" TEXT,
    "status" "RuleRunStatus" NOT NULL,
    "catalogBatchId" TEXT NOT NULL,
    "targetCount" INTEGER,
    "affectedCount" INTEGER,
    "failureCount" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleExecution" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "ruleRunId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" "RuleExecutionStatus" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleFailure" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "ruleRunId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "errorCode" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleFailure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleExecutionStat" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "runCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleExecutionStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleSchedule" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleEventDedup" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleEventDedup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleTargetSnapshot" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "ruleRunId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,

    CONSTRAINT "RuleTargetSnapshot_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "ProductCollectionMembership" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "mirrorBatchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCollectionMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMetafield" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "shopifyId" TEXT,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT,
    "value" TEXT,
    "mirrorBatchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMetafield_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportHistory" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "operationId" TEXT,
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
    "name" TEXT,
    "type" TEXT NOT NULL DEFAULT 'PRODUCT_EXPORT',
    "status" "ScheduledExportStatus" NOT NULL DEFAULT 'ACTIVE',
    "frequency" "ScheduledExportFrequency",
    "scheduleType" "RecurringScheduleType" NOT NULL,
    "timezone" TEXT NOT NULL,
    "scheduleConfig" JSONB NOT NULL,
    "cronExpression" TEXT,
    "intervalMinutes" INTEGER,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "filterParams" JSONB NOT NULL,
    "queryWhere" JSONB,
    "productIds" JSONB,
    "requestedColumns" JSONB NOT NULL DEFAULT '[]',
    "fields" TEXT[],
    "filename" TEXT NOT NULL,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastFailureReason" TEXT,
    "lastExportJobId" TEXT,
    "error" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "filterVersion" INTEGER NOT NULL DEFAULT 1,
    "canonicalFilterKey" TEXT,

    CONSTRAINT "ScheduledExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledExportRun" (
    "id" TEXT NOT NULL,
    "scheduledExportId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "operationId" TEXT,
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
    "mirrorBatchId" TEXT,
    "failureStage" TEXT,
    "filename" TEXT NOT NULL,
    "fileName" TEXT,
    "fields" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "fileKey" TEXT,
    "fileUrl" TEXT,
    "mimeType" TEXT,
    "fileSizeBytes" INTEGER,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL DEFAULT 'Manual export',
    "isScheduled" BOOLEAN NOT NULL DEFAULT false,
    "scheduledExportId" TEXT,
    "scheduledExportRunId" TEXT,
    "triggerType" "ExportJobTriggerType" NOT NULL DEFAULT 'MANUAL',
    "totalItems" INTEGER,
    "durationMs" INTEGER,
    "lastProcessedOrdinal" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "filterVersion" INTEGER,
    "canonicalFilterKey" TEXT,

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeRecord" (
    "id" TEXT NOT NULL,
    "editHistoryId" TEXT NOT NULL,
    "operationId" TEXT,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "field" TEXT,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "beforeHash" TEXT,
    "afterHash" TEXT,
    "appliedAt" TIMESTAMP(3),
    "revertedAt" TIMESTAMP(3),
    "oldValue" JSONB,
    "newValue" JSONB,
    "mutationKey" TEXT,
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
    "ordinal" INTEGER NOT NULL,
    "mirrorBatchId" TEXT,
    "plannerFingerprint" TEXT,
    "plannerVersion" INTEGER,
    "canonicalQueryHash" TEXT,
    "canonicalOrderBy" JSONB,
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

-- CreateTable
CREATE TABLE "StoreOperation" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestedBy" TEXT,
    "source" TEXT NOT NULL,
    "lockKey" TEXT,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "editHistoryId" TEXT,
    "targetHash" TEXT,
    "catalogBatchId" TEXT,
    "productBatchId" TEXT,
    "variantBatchId" TEXT,
    "collectionBatchId" TEXT,
    "mirrorBatchId" TEXT,
    "totalTargets" INTEGER,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationFailure" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationFailure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationMutation" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "batchId" TEXT,
    "shopifyBulkOperationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationMutation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkMutationSubmission" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "editHistoryId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "dispatchJobId" TEXT,
    "dispatchAttempt" INTEGER,
    "stagedUploadPath" TEXT,
    "shopifyBulkOperationId" TEXT,
    "status" TEXT NOT NULL,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkMutationSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantOperation" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "type" "MerchantOperationType" NOT NULL,
    "status" "MerchantOperationStatus" NOT NULL DEFAULT 'PLANNED',
    "title" TEXT,
    "source" TEXT,
    "parentId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "targetHash" TEXT,
    "inputHash" TEXT,
    "resultHash" TEXT,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "processedItems" INTEGER NOT NULL DEFAULT 0,
    "failedItems" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationExecution" (
    "id" TEXT NOT NULL,
    "merchantOperationId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "executionKey" TEXT,
    "status" "MerchantOperationStatus" NOT NULL DEFAULT 'PLANNED',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "workerJobId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationSubmission" (
    "id" TEXT NOT NULL,
    "merchantOperationId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "type" "OperationSubmissionType" NOT NULL DEFAULT 'SHOPIFY_BULK_MUTATION',
    "status" "OperationSubmissionStatus" NOT NULL DEFAULT 'PLANNED',
    "provider" TEXT NOT NULL DEFAULT 'SHOPIFY',
    "dispatchJobId" TEXT,
    "dispatchAttempt" INTEGER,
    "stagedUploadPath" TEXT,
    "stagedUploadUrl" TEXT,
    "bulkOperationId" TEXT,
    "resultUrl" TEXT,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImmutableTargetSnapshotSet" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "mirrorBatchId" TEXT NOT NULL,
    "filterAst" JSONB NOT NULL,
    "filterHash" TEXT NOT NULL,
    "targetHash" TEXT NOT NULL,
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "variantCount" INTEGER NOT NULL DEFAULT 0,
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImmutableTargetSnapshotSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImmutableTargetSnapshotItem" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "snapshotSetId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "beforeHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImmutableTargetSnapshotItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportArtifact" (
    "id" TEXT NOT NULL,
    "merchantOperationId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "format" TEXT,
    "storageKey" TEXT,
    "downloadUrl" TEXT,
    "exportJobId" TEXT,
    "filename" TEXT,
    "fileKey" TEXT,
    "fileUrl" TEXT,
    "mimeType" TEXT,
    "fileSizeBytes" INTEGER,
    "rowCount" INTEGER,
    "checksum" TEXT,
    "status" "ExportArtifactStatus" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TargetSnapshotSet" (
    "id" TEXT NOT NULL,
    "merchantOperationId" TEXT,
    "operationId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "ordinal" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TargetSnapshotSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreOperationalState" (
    "shop" TEXT NOT NULL,
    "mirrorSchemaVersion" INTEGER NOT NULL DEFAULT 1,
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

-- CreateTable
CREATE TABLE "ScheduledEditRun" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "scheduledEditId" TEXT NOT NULL,
    "operationId" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "targetCount" INTEGER,
    "affectedCount" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledEditRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_idx" ON "Product"("shop", "mirrorBatchId");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_id_idx" ON "Product"("shop", "mirrorBatchId", "id");

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
CREATE INDEX "Product_tags_idx" ON "Product" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "Product_shop_mirrorBatchId_descriptionText_idx" ON "Product"("shop", "mirrorBatchId", "descriptionText");

-- CreateIndex
CREATE INDEX "Variant_shop_mirrorBatchId_idx" ON "Variant"("shop", "mirrorBatchId");

-- CreateIndex
CREATE INDEX "Variant_shop_mirrorBatchId_productId_idx" ON "Variant"("shop", "mirrorBatchId", "productId");

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

-- CreateIndex
CREATE INDEX "SpreadsheetFile_shop_idx" ON "SpreadsheetFile"("shop");

-- CreateIndex
CREATE INDEX "SpreadsheetFile_shop_operationId_idx" ON "SpreadsheetFile"("shop", "operationId");

-- CreateIndex
CREATE UNIQUE INDEX "Store_shopUrl_key" ON "Store"("shopUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Store_referralCode_key" ON "Store"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "Store_referralLink_key" ON "Store"("referralLink");

-- CreateIndex
CREATE INDEX "Store_isProductSyncing_idx" ON "Store"("isProductSyncing");

-- CreateIndex
CREATE INDEX "Store_syncProgressStage_syncLeaseExpiresAt_idx" ON "Store"("syncProgressStage", "syncLeaseExpiresAt");

-- CreateIndex
CREATE INDEX "Store_lastProductSyncAt_idx" ON "Store"("lastProductSyncAt");

-- CreateIndex
CREATE INDEX "Store_isCollectionSyncing_idx" ON "Store"("isCollectionSyncing");

-- CreateIndex
CREATE INDEX "Store_collectionSyncLeaseExpiresAt_idx" ON "Store"("collectionSyncLeaseExpiresAt");

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
CREATE UNIQUE INDEX "Subscription_shop_key" ON "Subscription"("shop");

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
CREATE INDEX "SyncHistory_shop_executionState_idx" ON "SyncHistory"("shop", "executionState");

-- CreateIndex
CREATE INDEX "SyncHistory_shop_operationType_status_updatedAt_idx" ON "SyncHistory"("shop", "operationType", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "SyncHistory_shop_operationType_updatedAt_idx" ON "SyncHistory"("shop", "operationType", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EditHistory_operationId_key" ON "EditHistory"("operationId");

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
CREATE INDEX "EditHistory_shop_canonicalFilterKey_idx" ON "EditHistory"("shop", "canonicalFilterKey");

-- CreateIndex
CREATE UNIQUE INDEX "BulkUndoExecution_executionIdentity_key" ON "BulkUndoExecution"("executionIdentity");

-- CreateIndex
CREATE INDEX "BulkUndoExecution_shop_historyId_idx" ON "BulkUndoExecution"("shop", "historyId");

-- CreateIndex
CREATE INDEX "BulkUndoExecution_shop_state_idx" ON "BulkUndoExecution"("shop", "state");

-- CreateIndex
CREATE INDEX "BulkUndoExecution_shop_operationId_idx" ON "BulkUndoExecution"("shop", "operationId");

-- CreateIndex
CREATE INDEX "BulkUndoExecution_shop_mirrorBatchId_state_idx" ON "BulkUndoExecution"("shop", "mirrorBatchId", "state");

-- CreateIndex
CREATE INDEX "BulkUndoTargetSnapshot_shop_executionIdentity_ordinal_idx" ON "BulkUndoTargetSnapshot"("shop", "executionIdentity", "ordinal");

-- CreateIndex
CREATE INDEX "BulkUndoTargetSnapshot_shop_historyId_idx" ON "BulkUndoTargetSnapshot"("shop", "historyId");

-- CreateIndex
CREATE UNIQUE INDEX "BulkUndoTargetSnapshot_shop_executionIdentity_productId_key" ON "BulkUndoTargetSnapshot"("shop", "executionIdentity", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "BulkUndoTargetSnapshot_shop_executionIdentity_ordinal_key" ON "BulkUndoTargetSnapshot"("shop", "executionIdentity", "ordinal");

-- CreateIndex
CREATE INDEX "RecurringEdit_shop_idx" ON "RecurringEdit"("shop");

-- CreateIndex
CREATE INDEX "RecurringEdit_shop_status_idx" ON "RecurringEdit"("shop", "status");

-- CreateIndex
CREATE INDEX "RecurringEdit_shop_nextRunAt_idx" ON "RecurringEdit"("shop", "nextRunAt");

-- CreateIndex
CREATE INDEX "RecurringEdit_nextRunAt_idx" ON "RecurringEdit"("nextRunAt");

-- CreateIndex
CREATE INDEX "RecurringEdit_shop_canonicalFilterKey_idx" ON "RecurringEdit"("shop", "canonicalFilterKey");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringEditRun_executionKey_key" ON "RecurringEditRun"("executionKey");

-- CreateIndex
CREATE INDEX "RecurringEditRun_recurringEditId_idx" ON "RecurringEditRun"("recurringEditId");

-- CreateIndex
CREATE INDEX "RecurringEditRun_shop_status_idx" ON "RecurringEditRun"("shop", "status");

-- CreateIndex
CREATE INDEX "RecurringEditRun_shop_scheduledFor_idx" ON "RecurringEditRun"("shop", "scheduledFor");

-- CreateIndex
CREATE INDEX "RecurringEditRun_shop_operationId_idx" ON "RecurringEditRun"("shop", "operationId");

-- CreateIndex
CREATE INDEX "RecurringEditRun_editHistoryId_idx" ON "RecurringEditRun"("editHistoryId");

-- CreateIndex
CREATE INDEX "AutomaticProductRule_shop_status_idx" ON "AutomaticProductRule"("shop", "status");

-- CreateIndex
CREATE INDEX "AutomaticProductRule_shop_nextRunAt_idx" ON "AutomaticProductRule"("shop", "nextRunAt");

-- CreateIndex
CREATE INDEX "AutomaticProductRule_shop_triggerType_idx" ON "AutomaticProductRule"("shop", "triggerType");

-- CreateIndex
CREATE INDEX "AutomaticProductRule_shop_executionMode_status_idx" ON "AutomaticProductRule"("shop", "executionMode", "status");

-- CreateIndex
CREATE INDEX "AutomaticProductRule_shop_priority_status_idx" ON "AutomaticProductRule"("shop", "priority", "status");

-- CreateIndex
CREATE INDEX "AutomaticProductRule_shop_createdAt_idx" ON "AutomaticProductRule"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "AutomaticProductRule_shop_canonicalFilterKey_idx" ON "AutomaticProductRule"("shop", "canonicalFilterKey");

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
CREATE INDEX "Rule_shopId_status_idx" ON "Rule"("shopId", "status");

-- CreateIndex
CREATE INDEX "Rule_shopId_priority_idx" ON "Rule"("shopId", "priority");

-- CreateIndex
CREATE INDEX "Rule_shopId_id_idx" ON "Rule"("shopId", "id");

-- CreateIndex
CREATE INDEX "RuleVersion_shopId_ruleId_idx" ON "RuleVersion"("shopId", "ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleVersion_ruleId_version_key" ON "RuleVersion"("ruleId", "version");

-- CreateIndex
CREATE INDEX "RuleRun_shopId_ruleId_idx" ON "RuleRun"("shopId", "ruleId");

-- CreateIndex
CREATE INDEX "RuleRun_shopId_status_idx" ON "RuleRun"("shopId", "status");

-- CreateIndex
CREATE INDEX "RuleRun_shopId_status_createdAt_idx" ON "RuleRun"("shopId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RuleRun_shopId_catalogBatchId_idx" ON "RuleRun"("shopId", "catalogBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleRun_shopId_ruleId_triggerEventId_key" ON "RuleRun"("shopId", "ruleId", "triggerEventId");

-- CreateIndex
CREATE INDEX "RuleExecution_shopId_ruleRunId_idx" ON "RuleExecution"("shopId", "ruleRunId");

-- CreateIndex
CREATE INDEX "RuleExecution_ruleRunId_entityId_idx" ON "RuleExecution"("ruleRunId", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleExecution_ruleRunId_entityType_entityId_key" ON "RuleExecution"("ruleRunId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "RuleFailure_shopId_ruleRunId_idx" ON "RuleFailure"("shopId", "ruleRunId");

-- CreateIndex
CREATE INDEX "RuleExecutionStat_shopId_ruleId_idx" ON "RuleExecutionStat"("shopId", "ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleExecutionStat_shopId_ruleId_windowStart_key" ON "RuleExecutionStat"("shopId", "ruleId", "windowStart");

-- CreateIndex
CREATE INDEX "RuleSchedule_shopId_nextRunAt_idx" ON "RuleSchedule"("shopId", "nextRunAt");

-- CreateIndex
CREATE INDEX "RuleSchedule_shopId_ruleId_idx" ON "RuleSchedule"("shopId", "ruleId");

-- CreateIndex
CREATE INDEX "RuleEventDedup_shopId_ruleId_idx" ON "RuleEventDedup"("shopId", "ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleEventDedup_shopId_ruleId_eventId_key" ON "RuleEventDedup"("shopId", "ruleId", "eventId");

-- CreateIndex
CREATE INDEX "RuleTargetSnapshot_shopId_ruleRunId_idx" ON "RuleTargetSnapshot"("shopId", "ruleRunId");

-- CreateIndex
CREATE INDEX "RuleTargetSnapshot_ruleRunId_entityId_idx" ON "RuleTargetSnapshot"("ruleRunId", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleTargetSnapshot_ruleRunId_entityType_entityId_key" ON "RuleTargetSnapshot"("ruleRunId", "entityType", "entityId");

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
CREATE INDEX "Collection_shop_mirrorBatchId_title_idx" ON "Collection"("shop", "mirrorBatchId", "title");

-- CreateIndex
CREATE INDEX "ProductCollectionMembership_shop_mirrorBatchId_idx" ON "ProductCollectionMembership"("shop", "mirrorBatchId");

-- CreateIndex
CREATE INDEX "ProductCollectionMembership_shop_mirrorBatchId_productId_idx" ON "ProductCollectionMembership"("shop", "mirrorBatchId", "productId");

-- CreateIndex
CREATE INDEX "ProductCollectionMembership_shop_mirrorBatchId_collectionId_idx" ON "ProductCollectionMembership"("shop", "mirrorBatchId", "collectionId");

-- CreateIndex
CREATE INDEX "ProductCollectionMembership_shop_collectionId_idx" ON "ProductCollectionMembership"("shop", "collectionId");

-- CreateIndex
CREATE INDEX "ProductCollectionMembership_shop_productId_idx" ON "ProductCollectionMembership"("shop", "productId");

-- CreateIndex
CREATE INDEX "ProductCollectionMembership_shop_collectionId_productId_idx" ON "ProductCollectionMembership"("shop", "collectionId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCollectionMembership_shop_productId_collectionId_mir_key" ON "ProductCollectionMembership"("shop", "productId", "collectionId", "mirrorBatchId");

-- CreateIndex
CREATE INDEX "ProductMetafield_shop_mirrorBatchId_idx" ON "ProductMetafield"("shop", "mirrorBatchId");

-- CreateIndex
CREATE INDEX "ProductMetafield_shop_mirrorBatchId_ownerId_idx" ON "ProductMetafield"("shop", "mirrorBatchId", "ownerId");

-- CreateIndex
CREATE INDEX "ProductMetafield_shop_mirrorBatchId_namespace_key_idx" ON "ProductMetafield"("shop", "mirrorBatchId", "namespace", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMetafield_shop_ownerId_namespace_key_mirrorBatchId_key" ON "ProductMetafield"("shop", "ownerId", "namespace", "key", "mirrorBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "ExportHistory_operationId_key" ON "ExportHistory"("operationId");

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
CREATE UNIQUE INDEX "ExportHistory_scheduledTask_key" ON "ExportHistory"("scheduledTask");

-- CreateIndex
CREATE INDEX "ScheduledExport_shop_idx" ON "ScheduledExport"("shop");

-- CreateIndex
CREATE INDEX "ScheduledExport_shop_status_idx" ON "ScheduledExport"("shop", "status");

-- CreateIndex
CREATE INDEX "ScheduledExport_shop_nextRunAt_idx" ON "ScheduledExport"("shop", "nextRunAt");

-- CreateIndex
CREATE INDEX "ScheduledExport_nextRunAt_idx" ON "ScheduledExport"("nextRunAt");

-- CreateIndex
CREATE INDEX "ScheduledExport_status_nextRunAt_idx" ON "ScheduledExport"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "ScheduledExport_status_lockedAt_idx" ON "ScheduledExport"("status", "lockedAt");

-- CreateIndex
CREATE INDEX "ScheduledExport_shop_canonicalFilterKey_idx" ON "ScheduledExport"("shop", "canonicalFilterKey");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledExportRun_executionKey_key" ON "ScheduledExportRun"("executionKey");

-- CreateIndex
CREATE INDEX "ScheduledExportRun_scheduledExportId_idx" ON "ScheduledExportRun"("scheduledExportId");

-- CreateIndex
CREATE INDEX "ScheduledExportRun_shop_status_idx" ON "ScheduledExportRun"("shop", "status");

-- CreateIndex
CREATE INDEX "ScheduledExportRun_shop_scheduledFor_idx" ON "ScheduledExportRun"("shop", "scheduledFor");

-- CreateIndex
CREATE INDEX "ScheduledExportRun_shop_operationId_idx" ON "ScheduledExportRun"("shop", "operationId");

-- CreateIndex
CREATE INDEX "ScheduledExportRun_exportJobId_idx" ON "ScheduledExportRun"("exportJobId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledExportRun_exportJobId_key" ON "ScheduledExportRun"("exportJobId");

-- CreateIndex
CREATE INDEX "ExportJob_shop_idx" ON "ExportJob"("shop");

-- CreateIndex
CREATE INDEX "ExportJob_shop_createdAt_idx" ON "ExportJob"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "ExportJob_shop_executionState_idx" ON "ExportJob"("shop", "executionState");

-- CreateIndex
CREATE INDEX "ExportJob_status_idx" ON "ExportJob"("status");

-- CreateIndex
CREATE INDEX "ExportJob_shop_status_idx" ON "ExportJob"("shop", "status");

-- CreateIndex
CREATE INDEX "ExportJob_scheduledExportId_idx" ON "ExportJob"("scheduledExportId");

-- CreateIndex
CREATE INDEX "ExportJob_scheduledExportRunId_idx" ON "ExportJob"("scheduledExportRunId");

-- CreateIndex
CREATE INDEX "ExportJob_shop_mirrorBatchId_idx" ON "ExportJob"("shop", "mirrorBatchId");

-- CreateIndex
CREATE INDEX "ExportJob_shop_canonicalFilterKey_idx" ON "ExportJob"("shop", "canonicalFilterKey");

-- CreateIndex
CREATE INDEX "ChangeRecord_editHistoryId_idx" ON "ChangeRecord"("editHistoryId");

-- CreateIndex
CREATE INDEX "ChangeRecord_editHistoryId_shop_batchId_productId_idx" ON "ChangeRecord"("editHistoryId", "shop", "batchId", "productId");

-- CreateIndex
CREATE INDEX "ChangeRecord_shop_operationId_idx" ON "ChangeRecord"("shop", "operationId");

-- CreateIndex
CREATE INDEX "ChangeRecord_productId_idx" ON "ChangeRecord"("productId");

-- CreateIndex
CREATE INDEX "ChangeRecord_shop_productId_idx" ON "ChangeRecord"("shop", "productId");

-- CreateIndex
CREATE INDEX "ChangeRecord_shop_variantId_idx" ON "ChangeRecord"("shop", "variantId");

-- CreateIndex
CREATE INDEX "ChangeRecord_shop_idx" ON "ChangeRecord"("shop");

-- CreateIndex
CREATE INDEX "ChangeRecord_status_idx" ON "ChangeRecord"("status");

-- CreateIndex
CREATE INDEX "ChangeRecord_batchId_idx" ON "ChangeRecord"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeRecord_shop_operationId_productId_variantId_field_key" ON "ChangeRecord"("shop", "operationId", "productId", "variantId", "field");

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
CREATE INDEX "TargetSnapshot_ownerType_ownerId_ordinal_idx" ON "TargetSnapshot"("ownerType", "ownerId", "ordinal");

-- CreateIndex
CREATE INDEX "TargetSnapshot_ownerType_ownerId_shop_ordinal_idx" ON "TargetSnapshot"("ownerType", "ownerId", "shop", "ordinal");

-- CreateIndex
CREATE INDEX "TargetSnapshot_shop_mirrorBatchId_productId_idx" ON "TargetSnapshot"("shop", "mirrorBatchId", "productId");

-- CreateIndex
CREATE INDEX "TargetSnapshot_shop_ownerType_createdAt_idx" ON "TargetSnapshot"("shop", "ownerType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TargetSnapshot_ownerType_ownerId_productId_key" ON "TargetSnapshot"("ownerType", "ownerId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "TargetSnapshot_ownerType_ownerId_shop_productId_key" ON "TargetSnapshot"("ownerType", "ownerId", "shop", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "TargetSnapshot_ownerType_ownerId_ordinal_key" ON "TargetSnapshot"("ownerType", "ownerId", "ordinal");

-- CreateIndex
CREATE INDEX "MirrorAnomaly_shop_createdAt_idx" ON "MirrorAnomaly"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "MirrorAnomaly_shop_severity_createdAt_idx" ON "MirrorAnomaly"("shop", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "MirrorAnomaly_shop_type_createdAt_idx" ON "MirrorAnomaly"("shop", "type", "createdAt");

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
CREATE UNIQUE INDEX "StoreOperation_idempotencyKey_key" ON "StoreOperation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StoreOperation_shop_status_idx" ON "StoreOperation"("shop", "status");

-- CreateIndex
CREATE INDEX "StoreOperation_shop_type_status_idx" ON "StoreOperation"("shop", "type", "status");

-- CreateIndex
CREATE INDEX "StoreOperation_shop_heartbeatAt_idx" ON "StoreOperation"("shop", "heartbeatAt");

-- CreateIndex
CREATE INDEX "StoreOperation_shop_leaseExpiresAt_idx" ON "StoreOperation"("shop", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "StoreOperation_shop_editHistoryId_idx" ON "StoreOperation"("shop", "editHistoryId");

-- CreateIndex
CREATE INDEX "OperationFailure_shop_operationId_idx" ON "OperationFailure"("shop", "operationId");

-- CreateIndex
CREATE INDEX "OperationFailure_operationId_idx" ON "OperationFailure"("operationId");

-- CreateIndex
CREATE INDEX "OperationEvent_shop_operationId_idx" ON "OperationEvent"("shop", "operationId");

-- CreateIndex
CREATE INDEX "OperationEvent_operationId_createdAt_idx" ON "OperationEvent"("operationId", "createdAt");

-- CreateIndex
CREATE INDEX "OperationEvent_type_idx" ON "OperationEvent"("type");

-- CreateIndex
CREATE INDEX "OperationMutation_shop_operationId_idx" ON "OperationMutation"("shop", "operationId");

-- CreateIndex
CREATE INDEX "OperationMutation_shop_entityId_idx" ON "OperationMutation"("shop", "entityId");

-- CreateIndex
CREATE INDEX "OperationMutation_shop_status_idx" ON "OperationMutation"("shop", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OperationMutation_shop_operationId_entityId_field_key" ON "OperationMutation"("shop", "operationId", "entityId", "field");

-- CreateIndex
CREATE INDEX "BulkMutationSubmission_shop_shopifyBulkOperationId_idx" ON "BulkMutationSubmission"("shop", "shopifyBulkOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "BulkMutationSubmission_shop_operationId_batchId_key" ON "BulkMutationSubmission"("shop", "operationId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "BulkMutationSubmission_shop_operationId_batchId_dispatchJob_key" ON "BulkMutationSubmission"("shop", "operationId", "batchId", "dispatchJobId", "dispatchAttempt");

-- CreateIndex
CREATE INDEX "MerchantOperation_shop_type_status_createdAt_idx" ON "MerchantOperation"("shop", "type", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantOperation_shop_parentId_idx" ON "MerchantOperation"("shop", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantOperation_shop_idempotencyKey_key" ON "MerchantOperation"("shop", "idempotencyKey");

-- CreateIndex
CREATE INDEX "OperationExecution_merchantOperationId_createdAt_idx" ON "OperationExecution"("merchantOperationId", "createdAt");

-- CreateIndex
CREATE INDEX "OperationExecution_shop_status_idx" ON "OperationExecution"("shop", "status");

-- CreateIndex
CREATE INDEX "OperationExecution_shop_workerJobId_idx" ON "OperationExecution"("shop", "workerJobId");

-- CreateIndex
CREATE UNIQUE INDEX "OperationExecution_shop_executionKey_key" ON "OperationExecution"("shop", "executionKey");

-- CreateIndex
CREATE INDEX "OperationSubmission_merchantOperationId_createdAt_idx" ON "OperationSubmission"("merchantOperationId", "createdAt");

-- CreateIndex
CREATE INDEX "OperationSubmission_shop_merchantOperationId_status_idx" ON "OperationSubmission"("shop", "merchantOperationId", "status");

-- CreateIndex
CREATE INDEX "OperationSubmission_shop_bulkOperationId_idx" ON "OperationSubmission"("shop", "bulkOperationId");

-- CreateIndex
CREATE INDEX "OperationSubmission_shop_status_idx" ON "OperationSubmission"("shop", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OperationSubmission_shop_merchantOperationId_dispatchJobId__key" ON "OperationSubmission"("shop", "merchantOperationId", "dispatchJobId", "dispatchAttempt");

-- CreateIndex
CREATE UNIQUE INDEX "OperationSubmission_shop_bulkOperationId_key" ON "OperationSubmission"("shop", "bulkOperationId");

-- CreateIndex
CREATE INDEX "ImmutableTargetSnapshotSet_shop_mirrorBatchId_idx" ON "ImmutableTargetSnapshotSet"("shop", "mirrorBatchId");

-- CreateIndex
CREATE INDEX "ImmutableTargetSnapshotSet_shop_targetHash_idx" ON "ImmutableTargetSnapshotSet"("shop", "targetHash");

-- CreateIndex
CREATE UNIQUE INDEX "ImmutableTargetSnapshotSet_shop_operationId_key" ON "ImmutableTargetSnapshotSet"("shop", "operationId");

-- CreateIndex
CREATE INDEX "ImmutableTargetSnapshotItem_shop_productId_idx" ON "ImmutableTargetSnapshotItem"("shop", "productId");

-- CreateIndex
CREATE INDEX "ImmutableTargetSnapshotItem_shop_variantId_idx" ON "ImmutableTargetSnapshotItem"("shop", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "ImmutableTargetSnapshotItem_shop_snapshotSetId_productId_va_key" ON "ImmutableTargetSnapshotItem"("shop", "snapshotSetId", "productId", "variantId");

-- CreateIndex
CREATE INDEX "ExportArtifact_shop_merchantOperationId_idx" ON "ExportArtifact"("shop", "merchantOperationId");

-- CreateIndex
CREATE INDEX "ExportArtifact_shop_status_createdAt_idx" ON "ExportArtifact"("shop", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ExportArtifact_merchantOperationId_createdAt_idx" ON "ExportArtifact"("merchantOperationId", "createdAt");

-- CreateIndex
CREATE INDEX "ExportArtifact_shop_status_idx" ON "ExportArtifact"("shop", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExportArtifact_shop_exportJobId_key" ON "ExportArtifact"("shop", "exportJobId");

-- CreateIndex
CREATE INDEX "TargetSnapshotSet_shop_operationId_idx" ON "TargetSnapshotSet"("shop", "operationId");

-- CreateIndex
CREATE INDEX "TargetSnapshotSet_shop_merchantOperationId_idx" ON "TargetSnapshotSet"("shop", "merchantOperationId");

-- CreateIndex
CREATE INDEX "TargetSnapshotSet_operationId_entityId_idx" ON "TargetSnapshotSet"("operationId", "entityId");

-- CreateIndex
CREATE INDEX "TargetSnapshotSet_operationId_ordinal_idx" ON "TargetSnapshotSet"("operationId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "TargetSnapshotSet_operationId_entityId_key" ON "TargetSnapshotSet"("operationId", "entityId");

-- CreateIndex
CREATE INDEX "ScheduledEditRun_shop_status_idx" ON "ScheduledEditRun"("shop", "status");

-- CreateIndex
CREATE INDEX "ScheduledEditRun_scheduledEditId_idx" ON "ScheduledEditRun"("scheduledEditId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledEditRun_shop_scheduledEditId_scheduledFor_key" ON "ScheduledEditRun"("shop", "scheduledEditId", "scheduledFor");

-- AddForeignKey
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_shop_productId_mirrorBatchId_fkey" FOREIGN KEY ("shop", "productId", "mirrorBatchId") REFERENCES "Product"("shop", "id", "mirrorBatchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpreadsheetFile" ADD CONSTRAINT "SpreadsheetFile_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "MerchantOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditHistory" ADD CONSTRAINT "EditHistory_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "MerchantOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkUndoExecution" ADD CONSTRAINT "BulkUndoExecution_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "MerchantOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringEditRun" ADD CONSTRAINT "RecurringEditRun_recurringEditId_fkey" FOREIGN KEY ("recurringEditId") REFERENCES "RecurringEdit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringEditRun" ADD CONSTRAINT "RecurringEditRun_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "MerchantOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomaticProductRuleRun" ADD CONSTRAINT "AutomaticProductRuleRun_automaticProductRuleId_fkey" FOREIGN KEY ("automaticProductRuleId") REFERENCES "AutomaticProductRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomaticProductRuleProductState" ADD CONSTRAINT "AutomaticProductRuleProductState_automaticProductRuleId_fkey" FOREIGN KEY ("automaticProductRuleId") REFERENCES "AutomaticProductRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleVersion" ADD CONSTRAINT "RuleVersion_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleRun" ADD CONSTRAINT "RuleRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleExecution" ADD CONSTRAINT "RuleExecution_ruleRunId_fkey" FOREIGN KEY ("ruleRunId") REFERENCES "RuleRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleFailure" ADD CONSTRAINT "RuleFailure_ruleRunId_fkey" FOREIGN KEY ("ruleRunId") REFERENCES "RuleRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleExecutionStat" ADD CONSTRAINT "RuleExecutionStat_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleSchedule" ADD CONSTRAINT "RuleSchedule_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleEventDedup" ADD CONSTRAINT "RuleEventDedup_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleTargetSnapshot" ADD CONSTRAINT "RuleTargetSnapshot_ruleRunId_fkey" FOREIGN KEY ("ruleRunId") REFERENCES "RuleRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportHistory" ADD CONSTRAINT "ExportHistory_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "MerchantOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledExport" ADD CONSTRAINT "ScheduledExport_lastExportJobId_fkey" FOREIGN KEY ("lastExportJobId") REFERENCES "ExportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledExportRun" ADD CONSTRAINT "ScheduledExportRun_scheduledExportId_fkey" FOREIGN KEY ("scheduledExportId") REFERENCES "ScheduledExport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledExportRun" ADD CONSTRAINT "ScheduledExportRun_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "MerchantOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRecord" ADD CONSTRAINT "ChangeRecord_editHistoryId_fkey" FOREIGN KEY ("editHistoryId") REFERENCES "EditHistory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRecord" ADD CONSTRAINT "ChangeRecord_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "MerchantOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantOperation" ADD CONSTRAINT "MerchantOperation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MerchantOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationExecution" ADD CONSTRAINT "OperationExecution_merchantOperationId_fkey" FOREIGN KEY ("merchantOperationId") REFERENCES "MerchantOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationSubmission" ADD CONSTRAINT "OperationSubmission_merchantOperationId_fkey" FOREIGN KEY ("merchantOperationId") REFERENCES "MerchantOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImmutableTargetSnapshotSet" ADD CONSTRAINT "ImmutableTargetSnapshotSet_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "MerchantOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImmutableTargetSnapshotItem" ADD CONSTRAINT "ImmutableTargetSnapshotItem_snapshotSetId_fkey" FOREIGN KEY ("snapshotSetId") REFERENCES "ImmutableTargetSnapshotSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportArtifact" ADD CONSTRAINT "ExportArtifact_merchantOperationId_fkey" FOREIGN KEY ("merchantOperationId") REFERENCES "MerchantOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetSnapshotSet" ADD CONSTRAINT "TargetSnapshotSet_merchantOperationId_fkey" FOREIGN KEY ("merchantOperationId") REFERENCES "MerchantOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
