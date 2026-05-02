ALTER TABLE "Store"
ADD COLUMN IF NOT EXISTS "mirrorSchemaVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "StoreOperationalState"
ADD COLUMN IF NOT EXISTS "mirrorSchemaVersion" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS "SyncHistory_shop_bulkOperationId_key"
ON "SyncHistory"("shop", "bulkOperationId")
WHERE "bulkOperationId" IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_operation_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'OperationEvent is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS operation_event_prevent_update ON "OperationEvent";
CREATE TRIGGER operation_event_prevent_update
BEFORE UPDATE ON "OperationEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_operation_event_mutation();

DROP TRIGGER IF EXISTS operation_event_prevent_delete ON "OperationEvent";
CREATE TRIGGER operation_event_prevent_delete
BEFORE DELETE ON "OperationEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_operation_event_mutation();
