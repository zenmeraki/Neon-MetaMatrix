CREATE INDEX IF NOT EXISTS "RecurringEdit_shop_status_nextRunAt_createdAt_idx"
ON "RecurringEdit" ("shop", "status", "nextRunAt", "createdAt");
