import { FIELD_CAPABILITIES } from "./fieldCapabilities.js";

export function validateBulkEditIntent(intent, context = {}) {
  const errors = [];

  if (!intent?.shop) {
    errors.push({ code: "SHOP_REQUIRED", message: "Shop is required." });
  }

  if (!intent?.source) {
    errors.push({ code: "SOURCE_REQUIRED", message: "Execution source is required." });
  }

  if (!intent?.safety?.idempotencyKey) {
    errors.push({ code: "IDEMPOTENCY_KEY_REQUIRED", message: "Idempotency key is required." });
  }

  const field = FIELD_CAPABILITIES[intent?.operation?.field];

  if (!field) {
    errors.push({ code: "UNKNOWN_FIELD", message: "Unknown editable field." });
    return { valid: false, errors };
  }

  if (!field.allowedEditTypes.includes(intent.operation.editType)) {
    errors.push({
      code: "EDIT_TYPE_NOT_ALLOWED",
      message: "This edit type is not allowed for the selected field.",
    });
  }

  if (field.requiresLocation && !intent.operation.locationId) {
    errors.push({
      code: "LOCATION_REQUIRED",
      message: "This operation requires a location.",
    });
  }

  if (field.destructive && !intent.safety.confirmationToken) {
    errors.push({
      code: "CONFIRMATION_REQUIRED",
      message: "This operation requires confirmation.",
    });
  }

  if (
    intent.target.mode !== "RUNTIME_RULE" &&
    !intent.target.targetSnapshotId &&
    (!Array.isArray(intent.target.ids) || intent.target.ids.length === 0)
  ) {
    errors.push({
      code: "TARGET_REQUIRED",
      message: "A target snapshot or explicit IDs are required.",
    });
  }

  if (context.requireHealthyMirror && context.mirrorHealthState !== "HEALTHY") {
    errors.push({
      code: "MIRROR_NOT_HEALTHY",
      message: "Catalog mirror is not healthy.",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

