-- Durable per-shop work leases for long-running horizontally scaled workers.
CREATE TABLE IF NOT EXISTS "ShopWorkLease" (
    "shop" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "worker" TEXT,
    "queue" TEXT,
    "jobId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "executionId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShopWorkLease_pkey" PRIMARY KEY ("shop")
);

CREATE INDEX IF NOT EXISTS "ShopWorkLease_expiresAt_idx"
ON "ShopWorkLease"("expiresAt");

CREATE INDEX IF NOT EXISTS "ShopWorkLease_activity_expiresAt_idx"
ON "ShopWorkLease"("activity", "expiresAt");

-- Enforce one active SyncRun per shop/runType/domain scope.
-- COALESCE is used because Postgres unique indexes treat NULL values as distinct.
CREATE UNIQUE INDEX IF NOT EXISTS "SyncRun_one_active_per_scope_idx"
ON "SyncRun"("shop", "runType", COALESCE("domain", ''))
WHERE "status" IN ('PENDING', 'RUNNING');

CREATE UNIQUE INDEX IF NOT EXISTS "SyncRun_one_active_shop_query_idx"
ON "SyncRun"("shop")
WHERE "status" IN ('PENDING', 'RUNNING')
  AND "runType" IN ('FULL_BASELINE', 'DOMAIN_REPAIR');

CREATE UNIQUE INDEX IF NOT EXISTS "CatalogSnapshot_one_active_per_shop_idx"
ON "CatalogSnapshot"("shop")
WHERE "status" = 'ACTIVE';
