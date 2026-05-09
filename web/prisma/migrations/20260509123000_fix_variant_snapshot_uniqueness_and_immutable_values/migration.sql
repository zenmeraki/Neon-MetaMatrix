-- TargetSnapshot uniqueness must include variant identity for variant-level operations.
DROP INDEX IF EXISTS "TargetSnapshot_ownerType_ownerId_productId_key";
DROP INDEX IF EXISTS "TargetSnapshot_ownerType_ownerId_shop_productId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "TargetSnapshot_ownerType_ownerId_productId_variantId_key"
ON "TargetSnapshot"("ownerType", "ownerId", "productId", "variantId");

CREATE UNIQUE INDEX IF NOT EXISTS "TargetSnapshot_ownerType_ownerId_shop_productId_variantId_key"
ON "TargetSnapshot"("ownerType", "ownerId", "shop", "productId", "variantId");

-- Immutable snapshot items now store explicit before/after values and deterministic fingerprint.
ALTER TABLE "ImmutableTargetSnapshotItem"
  ADD COLUMN IF NOT EXISTS "beforeValues" JSONB,
  ADD COLUMN IF NOT EXISTS "afterValues" JSONB,
  ADD COLUMN IF NOT EXISTS "beforeFingerprint" TEXT NOT NULL DEFAULT '';
