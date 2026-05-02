-- Track the catalog snapshot and execution identity that last wrote state.
ALTER TABLE "AutomaticProductRuleProductState"
ADD COLUMN IF NOT EXISTS "mirrorBatchId" TEXT,
ADD COLUMN IF NOT EXISTS "lastRunId" TEXT,
ADD COLUMN IF NOT EXISTS "lastExecutionKey" TEXT;

CREATE INDEX IF NOT EXISTS "aprs_shop_batch_product_idx"
ON "AutomaticProductRuleProductState" ("shop", "mirrorBatchId", "productId");

CREATE INDEX IF NOT EXISTS "aprs_rule_shop_batch_idx"
ON "AutomaticProductRuleProductState" ("automaticProductRuleId", "shop", "mirrorBatchId");

CREATE INDEX IF NOT EXISTS "aprs_rule_shop_updated_idx"
ON "AutomaticProductRuleProductState" ("automaticProductRuleId", "shop", "updatedAt");
