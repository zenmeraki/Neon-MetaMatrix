-- Backfill-safe guard: enforce immutable undo lineage/value requirements
-- only for rows that carry operation lineage (operationId IS NOT NULL).
-- Existing legacy rows remain valid due to NOT VALID.

ALTER TABLE "ChangeRecord"
ADD CONSTRAINT "change_record_undo_lineage_required_ck"
CHECK (
  "operationId" IS NULL OR (
    "shop" IS NOT NULL AND
    "operationId" IS NOT NULL AND
    "productId" IS NOT NULL AND
    "field" IS NOT NULL AND
    char_length(trim("field")) > 0
  )
) NOT VALID;

ALTER TABLE "ChangeRecord"
ADD CONSTRAINT "change_record_undo_before_after_required_ck"
CHECK (
  "operationId" IS NULL OR (
    "beforeValue" IS NOT NULL AND
    "afterValue" IS NOT NULL AND
    "beforeHash" IS NOT NULL AND
    "afterHash" IS NOT NULL AND
    "appliedAt" IS NOT NULL
  )
) NOT VALID;
