-- Ensure restored rows are immutable with respect to replay-sensitive fields.
-- This is a DB-level race-path guard in addition to application-level updateMany filters.

ALTER TABLE "UndoTarget"
  ADD CONSTRAINT "UndoTarget_restored_status_consistency_chk"
  CHECK (
    ("restoredAt" IS NULL AND "undoMutationId" IS NULL)
    OR
    ("restoredAt" IS NOT NULL AND "status" = 'RESTORED' AND "undoMutationId" IS NOT NULL)
  ) NOT VALID;

CREATE OR REPLACE FUNCTION enforce_undo_target_restore_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Once restored, protected columns cannot be changed by later updates.
  IF OLD."restoredAt" IS NOT NULL THEN
    IF NEW."restoredAt" IS DISTINCT FROM OLD."restoredAt" THEN
      RAISE EXCEPTION 'UNDO_TARGET_RESTORED_AT_IMMUTABLE';
    END IF;
    IF NEW."undoMutationId" IS DISTINCT FROM OLD."undoMutationId" THEN
      RAISE EXCEPTION 'UNDO_TARGET_UNDO_MUTATION_ID_IMMUTABLE';
    END IF;
    IF NEW."status" IS DISTINCT FROM OLD."status" THEN
      RAISE EXCEPTION 'UNDO_TARGET_RESTORED_STATUS_IMMUTABLE';
    END IF;
  END IF;

  -- First transition to restored must include all replay-proof fields.
  IF OLD."restoredAt" IS NULL AND NEW."restoredAt" IS NOT NULL THEN
    IF NEW."status" <> 'RESTORED' THEN
      RAISE EXCEPTION 'UNDO_TARGET_RESTORED_REQUIRES_STATUS_RESTORED';
    END IF;
    IF NEW."undoMutationId" IS NULL OR btrim(NEW."undoMutationId") = '' THEN
      RAISE EXCEPTION 'UNDO_TARGET_RESTORED_REQUIRES_UNDO_MUTATION_ID';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS undo_target_restore_immutability_trg ON "UndoTarget";
CREATE TRIGGER undo_target_restore_immutability_trg
BEFORE UPDATE ON "UndoTarget"
FOR EACH ROW
EXECUTE FUNCTION enforce_undo_target_restore_immutability();
