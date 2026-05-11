ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "sourceEventId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceOccurredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "mirrorVersion" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "Variant"
  ADD COLUMN IF NOT EXISTS "sourceEventId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceOccurredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "mirrorVersion" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "WebhookDelivery"
  ADD COLUMN IF NOT EXISTS "payload" JSONB,
  ADD COLUMN IF NOT EXISTS "sourceSequence" BIGINT,
  ADD COLUMN IF NOT EXISTS "sourceOccurredAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Product_shop_sourceEventId_idx"
  ON "Product"("shop", "sourceEventId");
CREATE INDEX IF NOT EXISTS "Product_shop_sourceOccurredAt_idx"
  ON "Product"("shop", "sourceOccurredAt");

CREATE INDEX IF NOT EXISTS "Variant_shop_sourceEventId_idx"
  ON "Variant"("shop", "sourceEventId");
CREATE INDEX IF NOT EXISTS "Variant_shop_sourceOccurredAt_idx"
  ON "Variant"("shop", "sourceOccurredAt");

CREATE INDEX IF NOT EXISTS "WebhookDelivery_shop_sourceSequence_idx"
  ON "WebhookDelivery"("shop", "sourceSequence");
