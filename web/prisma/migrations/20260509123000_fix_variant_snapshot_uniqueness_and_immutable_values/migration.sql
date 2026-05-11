-- TargetSnapshot uniqueness must include variant identity for variant-level operations.
DROP INDEX IF EXISTS "TargetSnapshot_ownerType_ownerId_productId_key";
DROP INDEX IF EXISTS "TargetSnapshot_ownerType_ownerId_shop_productId_key";
DROP INDEX IF EXISTS "TargetSnapshot_ownerType_ownerId_productId_variantId_key";
DROP INDEX IF EXISTS "TargetSnapshot_ownerType_ownerId_shop_productId_variantId_key";

ALTER TABLE "TargetSnapshot"
  ADD COLUMN IF NOT EXISTS "variantId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relname = 'TargetSnapshot_ownerType_ownerId_productId_variantId_key'
  ) THEN
    CREATE UNIQUE INDEX "TargetSnapshot_ownerType_ownerId_productId_variantId_key"
    ON "TargetSnapshot"(
      "ownerType",
      "ownerId",
      "productId",
      COALESCE("variantId", '')
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relname = 'TargetSnapshot_ownerType_ownerId_shop_productId_variantId_key'
  ) THEN
    CREATE UNIQUE INDEX "TargetSnapshot_ownerType_ownerId_shop_productId_variantId_key"
    ON "TargetSnapshot"(
      "ownerType",
      "ownerId",
      "shop",
      "productId",
      COALESCE("variantId", '')
    );
  END IF;
END $$;

-- Immutable snapshot items now store explicit before/after values and deterministic fingerprint.
ALTER TABLE "ImmutableTargetSnapshotItem"
  ADD COLUMN IF NOT EXISTS "beforeValues" JSONB,
  ADD COLUMN IF NOT EXISTS "afterValues" JSONB,
  ADD COLUMN IF NOT EXISTS "beforeFingerprint" TEXT NOT NULL DEFAULT '';