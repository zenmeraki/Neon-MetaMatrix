DO $$
BEGIN
  IF to_regclass('"AutomationRun"') IS NOT NULL THEN
    ALTER TABLE "AutomationRun"
      ADD COLUMN IF NOT EXISTS "executionKey" TEXT,
      ADD COLUMN IF NOT EXISTS "triggerReference" TEXT,
      ADD COLUMN IF NOT EXISTS "workerJobId" TEXT,
      ADD COLUMN IF NOT EXISTS "attempt" INTEGER;

    CREATE UNIQUE INDEX IF NOT EXISTS "AutomationRun_shop_automationRuleId_executionKey_key"
      ON "AutomationRun"("shop", "automationRuleId", "executionKey");
  END IF;

  IF to_regclass('"AutomaticProductRuleRun"') IS NOT NULL THEN
    ALTER TABLE "AutomaticProductRuleRun"
      ADD COLUMN IF NOT EXISTS "executionKey" TEXT,
      ADD COLUMN IF NOT EXISTS "triggerReference" TEXT,
      ADD COLUMN IF NOT EXISTS "workerJobId" TEXT,
      ADD COLUMN IF NOT EXISTS "attempt" INTEGER;

    CREATE UNIQUE INDEX IF NOT EXISTS "AutomaticProductRuleRun_shop_rule_executionKey_key"
      ON "AutomaticProductRuleRun"("shop", "automaticProductRuleId", "executionKey");
  END IF;
END $$;