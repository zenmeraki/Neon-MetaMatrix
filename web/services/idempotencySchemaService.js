import { prisma } from "../config/database.js";
import { withAdvisoryLock } from "../utils/idempotencyUtils.js";
import {
  FILTER_DEFINITION_VERSION,
  backfillFilterDefinitionMetadata,
} from "./filterDefinitionStorageService.js";

const SUBSCRIPTION_STATUS_PRIORITY = {
  ACTIVE: 4,
  PENDING: 3,
  FREE: 2,
  CANCELLED: 1,
  EXPIRED: 0,
};

function getSubscriptionPriority(row) {
  return (
    (SUBSCRIPTION_STATUS_PRIORITY[row.status] ?? 0) * 100 +
    (row.subscriptionId ? 20 : 0) +
    (row.pendingSubscriptionId ? 10 : 0) +
    (row.planKey && row.planKey !== "FREE" ? 5 : 0) +
    new Date(row.updatedAt || row.createdAt || 0).getTime() / 1_000_000_000_000
  );
}

async function ensureWebhookDeliveryTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "WebhookDelivery" (
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
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "WebhookDelivery_dedupeKey_key"
    ON "WebhookDelivery" ("dedupeKey")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "WebhookDelivery_shop_topic_createdAt_idx"
    ON "WebhookDelivery" ("shop", "topic", "createdAt")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "WebhookDelivery_status_createdAt_idx"
    ON "WebhookDelivery" ("status", "createdAt")
  `);
}

async function ensureOperationFingerprintTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "OperationFingerprint" (
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
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "OperationFingerprint_shop_operationType_fingerprint_key"
    ON "OperationFingerprint" ("shop", "operationType", "fingerprint")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "OperationFingerprint_resource_idx"
    ON "OperationFingerprint" ("resourceType", "resourceId")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "OperationFingerprint_shop_status_createdAt_idx"
    ON "OperationFingerprint" ("shop", "status", "createdAt")
  `);
}

async function normalizeSubscriptions() {
  const duplicateShops = await prisma.$queryRaw`
    SELECT "shop"
    FROM "Subscription"
    GROUP BY "shop"
    HAVING COUNT(*) > 1
  `;

  for (const row of duplicateShops) {
    const shop = row.shop;
    const rows = await prisma.subscription.findMany({
      where: { shop },
      orderBy: [
        { updatedAt: "desc" },
        { createdAt: "desc" },
      ],
    });

    if (rows.length < 2) {
      continue;
    }

    const [canonical] = [...rows].sort(
      (left, right) => getSubscriptionPriority(right) - getSubscriptionPriority(left),
    );
    const duplicateIds = rows
      .filter((entry) => entry.id !== canonical.id)
      .map((entry) => entry.id);

    if (duplicateIds.length > 0) {
      await prisma.subscription.deleteMany({
        where: {
          id: {
            in: duplicateIds,
          },
        },
      });
    }
  }
}

async function ensureSubscriptionShopUniqueIndex() {
  await normalizeSubscriptions();

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_shop_key"
    ON "Subscription" ("shop")
  `);
}

async function ensureProductQueryIndexes() {
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_vendor_idx"
    ON "Product" ("shop", "mirrorBatchId", "vendor")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_productType_idx"
    ON "Product" ("shop", "mirrorBatchId", "productType")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_categoryName_idx"
    ON "Product" ("shop", "mirrorBatchId", "categoryName")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_option1Name_idx"
    ON "Product" ("shop", "mirrorBatchId", "option1Name")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_option2Name_idx"
    ON "Product" ("shop", "mirrorBatchId", "option2Name")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_option3Name_idx"
    ON "Product" ("shop", "mirrorBatchId", "option3Name")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_googleShoppingCategory_idx"
    ON "Product" ("shop", "mirrorBatchId", "googleShoppingCategory")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_googleShoppingColor_idx"
    ON "Product" ("shop", "mirrorBatchId", "googleShoppingColor")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_googleShoppingCustomLabel0_idx"
    ON "Product" ("shop", "mirrorBatchId", "googleShoppingCustomLabel0")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_googleShoppingCustomLabel1_idx"
    ON "Product" ("shop", "mirrorBatchId", "googleShoppingCustomLabel1")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_googleShoppingCustomLabel2_idx"
    ON "Product" ("shop", "mirrorBatchId", "googleShoppingCustomLabel2")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_googleShoppingCustomLabel3_idx"
    ON "Product" ("shop", "mirrorBatchId", "googleShoppingCustomLabel3")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_googleShoppingCustomLabel4_idx"
    ON "Product" ("shop", "mirrorBatchId", "googleShoppingCustomLabel4")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_googleShoppingMpn_idx"
    ON "Product" ("shop", "mirrorBatchId", "googleShoppingMpn")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_googleShoppingMaterial_idx"
    ON "Product" ("shop", "mirrorBatchId", "googleShoppingMaterial")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_googleShoppingSize_idx"
    ON "Product" ("shop", "mirrorBatchId", "googleShoppingSize")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_categoryAgeGroup_idx"
    ON "Product" ("shop", "mirrorBatchId", "categoryAgeGroup")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_categoryColor_idx"
    ON "Product" ("shop", "mirrorBatchId", "categoryColor")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_categoryFabric_idx"
    ON "Product" ("shop", "mirrorBatchId", "categoryFabric")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_categoryFit_idx"
    ON "Product" ("shop", "mirrorBatchId", "categoryFit")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_categorySize_idx"
    ON "Product" ("shop", "mirrorBatchId", "categorySize")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_categoryTargetGender_idx"
    ON "Product" ("shop", "mirrorBatchId", "categoryTargetGender")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_mirrorBatchId_categoryWaistRise_idx"
    ON "Product" ("shop", "mirrorBatchId", "categoryWaistRise")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Variant_shop_mirrorBatchId_option1Value_idx"
    ON "Variant" ("shop", "mirrorBatchId", "option1Value")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Variant_shop_mirrorBatchId_option2Value_idx"
    ON "Variant" ("shop", "mirrorBatchId", "option2Value")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Variant_shop_mirrorBatchId_option3Value_idx"
    ON "Variant" ("shop", "mirrorBatchId", "option3Value")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Variant_shop_mirrorBatchId_countryOfOrigin_idx"
    ON "Variant" ("shop", "mirrorBatchId", "countryOfOrigin")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Variant_shop_mirrorBatchId_inventoryPolicy_idx"
    ON "Variant" ("shop", "mirrorBatchId", "inventoryPolicy")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Variant_shop_mirrorBatchId_weightUnit_idx"
    ON "Variant" ("shop", "mirrorBatchId", "weightUnit")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Collection_shop_mirrorBatchId_title_idx"
    ON "Collection" ("shop", "mirrorBatchId", "title")
  `);
}

async function ensureMirrorFreshnessColumns() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Product"
    ADD COLUMN IF NOT EXISTS "lastSourceUpdatedAt" TIMESTAMP(3)
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Product"
    ADD COLUMN IF NOT EXISTS "lastSourceEventAt" TIMESTAMP(3)
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Product"
    ADD COLUMN IF NOT EXISTS "lastSourceKind" TEXT
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Product"
    ADD COLUMN IF NOT EXISTS "lastReconciledAt" TIMESTAMP(3)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_lastSourceUpdatedAt_idx"
    ON "Product" ("shop", "lastSourceUpdatedAt")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_lastSourceEventAt_idx"
    ON "Product" ("shop", "lastSourceEventAt")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_lastSourceKind_idx"
    ON "Product" ("shop", "lastSourceKind")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Product_shop_lastReconciledAt_idx"
    ON "Product" ("shop", "lastReconciledAt")
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE "Product"
    SET
      "lastSourceUpdatedAt" = COALESCE("lastSourceUpdatedAt", "updatedAt"),
      "lastSourceEventAt" = COALESCE("lastSourceEventAt", "updatedAt"),
      "lastSourceKind" = COALESCE("lastSourceKind", 'legacy_backfill'),
      "lastReconciledAt" = COALESCE("lastReconciledAt", CURRENT_TIMESTAMP)
    WHERE "lastSourceUpdatedAt" IS NULL
       OR "lastSourceEventAt" IS NULL
       OR "lastSourceKind" IS NULL
       OR "lastReconciledAt" IS NULL
  `);
}

async function ensureMirrorReconcileTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ProductTombstone" (
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
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "ProductTombstone_shop_productId_key"
    ON "ProductTombstone" ("shop", "productId")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ProductTombstone_shop_updatedAt_idx"
    ON "ProductTombstone" ("shop", "updatedAt")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ProductTombstone_shop_deletedAt_idx"
    ON "ProductTombstone" ("shop", "deletedAt")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ProductTombstone_shop_purgeAfter_idx"
    ON "ProductTombstone" ("shop", "purgeAfter")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "MirrorReconcileSignal" (
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
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "MirrorReconcileSignal_shop_entityType_entityId_key"
    ON "MirrorReconcileSignal" ("shop", "entityType", "entityId")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "MirrorReconcileSignal_status_updatedAt_idx"
    ON "MirrorReconcileSignal" ("status", "updatedAt")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "MirrorReconcileSignal_shop_status_updatedAt_idx"
    ON "MirrorReconcileSignal" ("shop", "status", "updatedAt")
  `);
}

async function ensureSyncExecutionColumns() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "SyncHistory"
    ADD COLUMN IF NOT EXISTS "executionState" TEXT NOT NULL DEFAULT 'planned'
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "SyncHistory"
    ADD COLUMN IF NOT EXISTS "executionIdentity" TEXT
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "SyncHistory"
    ADD COLUMN IF NOT EXISTS "lastHeartbeatAt" TIMESTAMP(3)
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "SyncHistory"
    ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "SyncHistory_shop_executionState_idx"
    ON "SyncHistory" ("shop", "executionState")
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE "SyncHistory"
    SET
      "executionState" = CASE
        WHEN "status" = 'completed' THEN 'completed'
        WHEN "status" = 'failed' THEN 'failed'
        WHEN "stage" = 'FINALIZING' THEN 'finalizing'
        WHEN "status" = 'processing' THEN 'shopify_bulk_running'
        ELSE COALESCE("executionState", 'planned')
      END,
      "completedAt" = CASE
        WHEN "status" IN ('completed', 'failed') AND "completedAt" IS NULL THEN "updatedAt"
        ELSE "completedAt"
      END,
      "lastHeartbeatAt" = COALESCE("lastHeartbeatAt", "updatedAt")
  `);
}

async function ensureFilterDefinitionColumns() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "RecurringEdit"
    ADD COLUMN IF NOT EXISTS "filterVersion" INTEGER NOT NULL DEFAULT ${FILTER_DEFINITION_VERSION}
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "RecurringEdit"
    ADD COLUMN IF NOT EXISTS "canonicalFilterKey" TEXT
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "RecurringEdit_shop_canonicalFilterKey_idx"
    ON "RecurringEdit" ("shop", "canonicalFilterKey")
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ScheduledExport"
    ADD COLUMN IF NOT EXISTS "filterVersion" INTEGER NOT NULL DEFAULT ${FILTER_DEFINITION_VERSION}
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ScheduledExport"
    ADD COLUMN IF NOT EXISTS "canonicalFilterKey" TEXT
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ScheduledExport_shop_canonicalFilterKey_idx"
    ON "ScheduledExport" ("shop", "canonicalFilterKey")
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "AutomaticProductRule"
    ADD COLUMN IF NOT EXISTS "filterVersion" INTEGER NOT NULL DEFAULT ${FILTER_DEFINITION_VERSION}
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "AutomaticProductRule"
    ADD COLUMN IF NOT EXISTS "canonicalFilterKey" TEXT
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "AutomaticProductRule_shop_canonicalFilterKey_idx"
    ON "AutomaticProductRule" ("shop", "canonicalFilterKey")
  `);

  await backfillFilterDefinitionMetadata("RecurringEdit");
  await backfillFilterDefinitionMetadata("ScheduledExport");
  await backfillFilterDefinitionMetadata("AutomaticProductRule");
}

async function ensureHistoryTargetingColumns() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "EditHistory"
    ADD COLUMN IF NOT EXISTS "filterVersion" INTEGER
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "EditHistory"
    ADD COLUMN IF NOT EXISTS "canonicalFilterKey" TEXT
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "EditHistory_shop_canonicalFilterKey_idx"
    ON "EditHistory" ("shop", "canonicalFilterKey")
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ExportJob"
    ADD COLUMN IF NOT EXISTS "filterVersion" INTEGER
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ExportJob"
    ADD COLUMN IF NOT EXISTS "canonicalFilterKey" TEXT
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ExportJob_shop_canonicalFilterKey_idx"
    ON "ExportJob" ("shop", "canonicalFilterKey")
  `);
}

export async function ensureIdempotencySchema() {
  const { locked } = await withAdvisoryLock("idempotency-schema-bootstrap", async () => {
    await ensureWebhookDeliveryTable();
    await ensureOperationFingerprintTable();
    await ensureSubscriptionShopUniqueIndex();
    await ensureMirrorFreshnessColumns();
    await ensureMirrorReconcileTables();
    await ensureSyncExecutionColumns();
    await ensureFilterDefinitionColumns();
    await ensureHistoryTargetingColumns();
    await ensureProductQueryIndexes();
  });

  return locked;
}
