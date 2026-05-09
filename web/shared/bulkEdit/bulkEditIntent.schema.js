export const BULK_EDIT_INTENT_VERSION = "2026-05-07";

export const BulkEditSource = Object.freeze({
  MANUAL: "MANUAL",
  INLINE: "INLINE",
  CSV_IMPORT: "CSV_IMPORT",
  SCHEDULED: "SCHEDULED",
  RECURRING_RULE_RUN: "RECURRING_RULE_RUN",
  REPLAY: "REPLAY",
});

export const TargetMode = Object.freeze({
  SNAPSHOT: "SNAPSHOT",
  RUNTIME_RULE: "RUNTIME_RULE",
  IDS: "IDS",
});

export const RoundingMode = Object.freeze({
  NONE: "NONE",
  WHOLE: "WHOLE",
  DECIMAL_2: "DECIMAL_2",
});

export function createBulkEditIntent(input) {
  return {
    schemaVersion: BULK_EDIT_INTENT_VERSION,

    shop: input.shop,
    actorId: input.actorId || null,
    source: input.source,

    target: {
      mode: input.targetSnapshotId
        ? TargetMode.SNAPSHOT
        : input.runtimeRule
          ? TargetMode.RUNTIME_RULE
          : TargetMode.IDS,

      targetSnapshotId: input.targetSnapshotId || null,
      runtimeRule: input.runtimeRule || null,
      ids: Array.isArray(input.ids) ? input.ids : [],

      mirrorBatchId: input.mirrorBatchId || null,
      plannerVersion: input.plannerVersion || null,
      plannerFingerprint: input.plannerFingerprint || null,
    },

    operation: {
      field: input.field,
      editType: input.editType,
      value: input.value,
      locationId: input.locationId || null,
      rounding: input.rounding || RoundingMode.NONE,
    },

    safety: {
      confirmationToken: input.confirmationToken || null,
      idempotencyKey: input.idempotencyKey,
    },

    metadata: input.metadata || {},
  };
}

