-- Store is installation/account/settings authority only.
-- Runtime sync truth belongs to:
--   SyncRun = durable run lifecycle authority
--   CatalogSnapshot = durable catalog-build authority
--   ActiveCatalogSnapshot = read-plane activation authority
--   DomainFreshness = domain health/freshness authority
-- The Store runtime columns below remain as temporary compatibility cache only.

COMMENT ON TABLE "Store" IS
  'Installation/account/settings authority. Sync runtime columns are legacy compatibility cache only; use SyncRun, CatalogSnapshot, ActiveCatalogSnapshot, and DomainFreshness as operational truth.';

COMMENT ON COLUMN "Store"."activeMirrorBatchId" IS
  'DEPRECATED runtime cache. Use ActiveCatalogSnapshot.catalogBatchId for read-plane activation authority.';
COMMENT ON COLUMN "Store"."activeCollectionBatchId" IS
  'DEPRECATED runtime cache. Use DomainFreshness and catalog batch scoped collection tables.';
COMMENT ON COLUMN "Store"."isCollectionSyncing" IS
  'DEPRECATED runtime cache. Use active SyncRun rows for lifecycle state.';
COMMENT ON COLUMN "Store"."isProductTypeSyncing" IS
  'DEPRECATED runtime cache. Use active SyncRun rows for lifecycle state.';
COMMENT ON COLUMN "Store"."isProductInitialySyning" IS
  'DEPRECATED runtime cache. Use SyncRun.isInitialSync plus SyncRun.status.';
COMMENT ON COLUMN "Store"."productInitialSyncProgress" IS
  'DEPRECATED runtime cache. Use SyncRun.rowCount and CatalogSnapshot counts.';
COMMENT ON COLUMN "Store"."syncProgressStage" IS
  'DEPRECATED runtime cache. Use SyncRun.stage.';
COMMENT ON COLUMN "Store"."shopifyBulkJobCompleted" IS
  'DEPRECATED runtime cache. Use SyncRun.stage/status and artifacts.';
COMMENT ON COLUMN "Store"."isProductSyncing" IS
  'DEPRECATED runtime cache. Use active SyncRun rows for lifecycle state.';
COMMENT ON COLUMN "Store"."lastProductSyncAt" IS
  'DEPRECATED runtime cache. Use DomainFreshness.lastFreshAt and CatalogSnapshot.activatedAt.';

DROP INDEX CONCURRENTLY IF EXISTS "Store_isProductSyncing_idx";
DROP INDEX CONCURRENTLY IF EXISTS "Store_lastProductSyncAt_idx";
DROP INDEX CONCURRENTLY IF EXISTS "Store_isCollectionSyncing_idx";
DROP INDEX CONCURRENTLY IF EXISTS "Store_lastCollectionSyncAt_idx";
DROP INDEX CONCURRENTLY IF EXISTS "Store_lastProductTypeSyncAt_idx";
