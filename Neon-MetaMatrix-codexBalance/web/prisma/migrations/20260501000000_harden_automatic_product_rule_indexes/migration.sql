-- Align automatic rule scheduler lookups with shop-scoped, bounded queries.
CREATE INDEX IF NOT EXISTS "AutomaticProductRule_shop_status_triggerType_nextRunAt_priority_createdAt_idx"
ON "AutomaticProductRule" ("shop", "status", "triggerType", "nextRunAt", "priority", "createdAt");

-- Align event/hybrid rule lookups with shop-scoped, bounded runnable-window queries.
CREATE INDEX IF NOT EXISTS "AutomaticProductRule_shop_status_triggerType_startAt_endAt_priority_createdAt_idx"
ON "AutomaticProductRule" ("shop", "status", "triggerType", "startAt", "endAt", "priority", "createdAt");
