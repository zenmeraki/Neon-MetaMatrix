import {
  FIELD_CONFIGS,
  TEXT_OPERATIONS,
  NUMERIC_OPERATIONS,
  TAG_OPERATIONS,
  COLLECTION_OPERATIONS,
} from "../helpers/productBulkOperationHelpers/constants.js";

const TEXT_OPERATIONS_REQUIRING_VALUE = new Set([
  "Set text to value",
  "Add text to end",
  "Remove text from end",
  "Add text to beginning",
  "Remove text from beginning",
  "Limit length of text",
  "Remove text from a word to the end",
  "Remove text up to and including a word",
  "Search/Replace",
  "Increase by percent",
  "Decrease by percent",
  "Changed by fixed amount",
  "Set to fixed value",
  "Set to percentage of compare-at-price",
]);

function hasTarget({ filterParams, targetSnapshotId }) {
  return Boolean(
    (typeof targetSnapshotId === "string" && targetSnapshotId.trim()) ||
      (Array.isArray(filterParams) && filterParams.length > 0),
  );
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function createClientValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.isClientError = true;
  return error;
}

function normalizeField(field) {
  return typeof field === "string" ? field.trim() : "";
}

function normalizeEditOption(editOption) {
  return typeof editOption === "string" ? editOption.trim() : "";
}

function getAllowedEditOptions(field, config) {
  if (!config) return new Set();

  if (config.requiresExplicitConfirmation || config.isDanger) {
    return new Set(["DELETE_PRODUCTS", "Delete products", "deleteProducts"]);
  }

  if (config.customOnly) {
    if (field === "status") return new Set(["Set status"]);
    if (field === "taxable") return new Set(["Set taxable"]);
    if (field === "inventoryPolicy") {
      return new Set(["SET_INVENTORY_POLICY", "Set inventory policy"]);
    }
    if (field === "category") return new Set(["Set value"]);
  }

  if (config.fieldName === "collections") {
    return new Set(Object.keys(COLLECTION_OPERATIONS));
  }

  if (config.isArray) {
    return new Set(Object.keys(TAG_OPERATIONS));
  }

  if (config.isNumeric) {
    return new Set(Object.keys(NUMERIC_OPERATIONS));
  }

  return new Set(Object.keys(TEXT_OPERATIONS));
}

function validateValueShape({ editOption, value, payload }) {
  const arrayOnlyOperations = new Set([
    "Add product(s) to collections",
    "Remove product(s) from collections",
    "Set category",
  ]);

  if (Array.isArray(value) && !arrayOnlyOperations.has(String(editOption))) {
    throw createClientValidationError(
      "Invalid value shape for selected edit type",
    );
  }

  if (editOption === "Search/Replace") {
    if (!hasValue(payload.searchKey)) {
      throw createClientValidationError(
        "searchKey is required for Search/Replace edits",
      );
    }
    return;
  }

  if (
    editOption === "Rename tag" ||
    editOption === "Search/replace within tag name"
  ) {
    if (!hasValue(payload.searchKey)) {
      throw createClientValidationError(
        "searchKey is required for tag search/replace edits",
      );
    }
    return;
  }

  if (TEXT_OPERATIONS_REQUIRING_VALUE.has(String(editOption)) && !hasValue(value)) {
    throw createClientValidationError("Bulk edit value is required");
  }
}

export function validateBulkEditPayload(payload = {}, options = {}) {
  const mode = options.mode === "execute" ? "execute" : "preview";

  if ("queryWhere" in payload || "productIds" in payload) {
    throw createClientValidationError(
      "Client-controlled target selectors are not allowed",
    );
  }

  const field = normalizeField(payload.editedField || payload.field);
  const editOption = normalizeEditOption(
    payload.editedBy || payload.editedType || payload.editType,
  );

  if (!field) {
    throw createClientValidationError("editedField is required");
  }

  if (!FIELD_CONFIGS[field]) {
    throw createClientValidationError("Invalid editedField");
  }

  if (!editOption) {
    throw createClientValidationError("Bulk edit operation type is required");
  }

  const fieldConfig = FIELD_CONFIGS[field];
  const allowedEditOptions = getAllowedEditOptions(field, fieldConfig);
  if (!allowedEditOptions.has(editOption)) {
    throw createClientValidationError("Invalid editType for editedField");
  }

  if (!hasTarget(payload)) {
    throw createClientValidationError("Bulk edit target is required");
  }

  if (field === "inventory" && !payload.locationId) {
    throw createClientValidationError("Location ID is required for inventory edits");
  }

  const value = payload.value ?? payload.editValue;
  validateValueShape({ editOption, value, payload });

  if (
    mode === "execute" &&
    fieldConfig?.requiresExplicitConfirmation &&
    String(payload.confirm || "").trim() !== "DELETE"
  ) {
    throw createClientValidationError("DELETE_CONFIRMATION_REQUIRED");
  }

  return {
    field,
    editOption,
  };
}
