import { FIELD_CONFIGS } from "../helpers/productBulkOperationHelpers/constants.js";

const TEXT_OPERATIONS_REQUIRING_VALUE = new Set([
  "set",
  "add",
  "append",
  "prepend",
  "replace",
  "searchReplace",
  "increase",
  "decrease",
  "percentageIncrease",
  "percentageDecrease",
]);

function hasTarget({ filterParams, queryWhere, productIds, targetSnapshotId }) {
  return Boolean(
    (typeof targetSnapshotId === "string" && targetSnapshotId.trim()) ||
      (Array.isArray(filterParams) && filterParams.length > 0) ||
      (queryWhere && typeof queryWhere === "object" && Object.keys(queryWhere).length > 0) ||
      (Array.isArray(productIds) && productIds.length > 0),
  );
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && String(value).trim() !== "";
}

export function validateBulkEditPayload(payload = {}) {
  const field = payload.editedField || payload.field;
  const editOption = payload.editedBy || payload.editedType || payload.editType;

  if (!field) {
    throw new Error("editedField is required");
  }

  if (!FIELD_CONFIGS[field]) {
    throw new Error("Invalid editedField");
  }

  if (!editOption) {
    throw new Error("Bulk edit operation type is required");
  }

  if (!hasTarget(payload)) {
    throw new Error("Bulk edit target is required");
  }

  if (field === "inventory" && !payload.locationId) {
    throw new Error("Location ID is required for inventory edits");
  }

  if (
    TEXT_OPERATIONS_REQUIRING_VALUE.has(String(editOption)) &&
    !hasValue(payload.value ?? payload.editValue)
  ) {
    throw new Error("Bulk edit value is required");
  }

  return {
    field,
    editOption,
  };
}
