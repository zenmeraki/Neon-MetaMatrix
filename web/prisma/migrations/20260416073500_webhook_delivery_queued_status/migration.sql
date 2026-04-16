ALTER TABLE "WebhookDelivery"
  DROP CONSTRAINT IF EXISTS "WebhookDelivery_status_enum_ck";

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_status_enum_ck"
  CHECK ("status" IN ('RECEIVED', 'QUEUED', 'PROCESSING', 'PROCESSED', 'FAILED', 'SKIPPED'));
