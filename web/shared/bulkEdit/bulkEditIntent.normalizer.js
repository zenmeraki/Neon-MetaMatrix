import { createBulkEditIntent, BulkEditSource } from "./bulkEditIntent.schema.js";

const LEGACY_FIELD_MAP = {
  inventory: "inventoryQuantity",
};

function normalizeField(field) {
  const value = String(field || "").trim();
  return LEGACY_FIELD_MAP[value] || value;
}

function normalizeEditType(editType) {
  const value = String(editType || "").trim();
  const map = {
    "Set text to value": "SET",
    "Set to fixed value": "SET",
    "Set value": "SET",
    "Set status": "SET",
    "Set taxable": "SET",
    "Set inventory policy": "SET",
    "Add text to end": "APPEND",
    "Add text to beginning": "PREPEND",
    "Search/Replace": "SEARCH_REPLACE",
    "Increase by percent": "PERCENT_INCREASE",
    "Decrease by percent": "PERCENT_DECREASE",
    "Changed by fixed amount": "INCREASE",
    "Add tag(s) to product": "ADD",
    "Remove tag(s) from product": "REMOVE",
  };
  return map[value] || value;
}

export function normalizeLegacyBulkEditPayload({
  shop,
  actorId,
  body,
  source = BulkEditSource.MANUAL,
}) {
  const normalizedSource = source || body?.source || BulkEditSource.MANUAL;
  const field = normalizeField(body.editedField || body.field);
  const editType = normalizeEditType(body.editedType || body.editedBy || body.editType);
  const idempotencyKey =
    body.idempotencyKey ||
    body.requestId ||
    body.clientRequestId ||
    null;

  return createBulkEditIntent({
    shop,
    actorId,
    source: normalizedSource,

    targetSnapshotId: body.targetSnapshotId,
    ids: body.ids,
    runtimeRule: body.runtimeRule || null,

    mirrorBatchId: body.mirrorBatchId,
    plannerVersion: body.plannerVersion,
    plannerFingerprint: body.plannerFingerprint,

    field,
    editType,

    value: normalizeLegacyValue(body),
    locationId: body.locationId || body.location || null,
    rounding: body.rounding,

    confirmationToken:
      body.confirmationToken ||
      body.confirm ||
      body.allProductsConfirmation ||
      "LEGACY_COMPAT",
    idempotencyKey: idempotencyKey || `legacy:${shop}:${Date.now()}`,

    metadata: {
      legacyPayload: true,
      searchKey: body.searchKey || null,
      replaceText: body.replaceText || null,
      supportValue: body.supportValue || null,
    },
  });
}

function normalizeLegacyValue(body) {
  if (body.searchKey || body.replaceText) {
    return {
      type: "SEARCH_REPLACE",
      search: body.searchKey || "",
      replace: body.replaceText || "",
      caseSensitive: false,
    };
  }

  if (Array.isArray(body.value)) {
    return {
      type: "ARRAY",
      items: body.value,
    };
  }

  return {
    type: "RAW",
    value: body.value ?? "",
  };
}
