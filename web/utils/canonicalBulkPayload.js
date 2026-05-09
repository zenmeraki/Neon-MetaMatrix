function asString(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

const CANONICAL_INPUT_TYPES = new Set([
  "NUMBER",
  "NUMBER_OR_TEXT",
  "ENTITY_IDS",
  "SEARCH_REPLACE",
  "LOCATION",
  "CHOICE",
  "NONE",
]);

function assertCanonicalPayload(canonicalPayload) {
  if (!canonicalPayload || typeof canonicalPayload !== "object" || Array.isArray(canonicalPayload)) {
    const error = new Error("Invalid canonical payload object");
    error.statusCode = 400;
    error.isClientError = true;
    throw error;
  }

  const field = asString(canonicalPayload.field).trim();
  const editType = asString(canonicalPayload.editType).trim();
  const inputType = asString(canonicalPayload.inputType).trim().toUpperCase();
  if (!field || !editType || !inputType) {
    const error = new Error("canonicalPayload field, editType, and inputType are required");
    error.statusCode = 400;
    error.isClientError = true;
    throw error;
  }
  if (!CANONICAL_INPUT_TYPES.has(inputType)) {
    const error = new Error("Unsupported canonical inputType");
    error.statusCode = 400;
    error.isClientError = true;
    throw error;
  }

  const value = canonicalPayload.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error("canonicalPayload.value must be an object");
    error.statusCode = 400;
    error.isClientError = true;
    throw error;
  }

  if (inputType === "ENTITY_IDS" && !Array.isArray(value.ids)) {
    const error = new Error("canonicalPayload.value.ids must be an array for ENTITY_IDS");
    error.statusCode = 400;
    error.isClientError = true;
    throw error;
  }

  if (inputType === "SEARCH_REPLACE" && typeof value.search !== "string") {
    const error = new Error("canonicalPayload.value.search must be a string for SEARCH_REPLACE");
    error.statusCode = 400;
    error.isClientError = true;
    throw error;
  }

  if (inputType === "LOCATION" && typeof value.locationId !== "string" && value.locationId !== null) {
    const error = new Error("canonicalPayload.value.locationId must be a string or null for LOCATION");
    error.statusCode = 400;
    error.isClientError = true;
    throw error;
  }
}

function normalizeCanonicalValue(inputType, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { normalizedValue: value, searchKey: null, replaceText: null, supportValue: null, locationId: null };
  }

  switch (String(inputType || "").toUpperCase()) {
    case "NUMBER":
      return {
        normalizedValue: asString(value.amount ?? value.value ?? ""),
        searchKey: null,
        replaceText: null,
        supportValue: null,
        locationId: null,
      };
    case "ENTITY_IDS":
      return {
        normalizedValue: Array.isArray(value.ids) ? value.ids.map((item) => asString(item)) : [],
        searchKey: null,
        replaceText: null,
        supportValue: Array.isArray(value.labels) ? value.labels : null,
        locationId: null,
      };
    case "SEARCH_REPLACE":
      return {
        normalizedValue: null,
        searchKey: asString(value.search ?? ""),
        replaceText: asString(value.replace ?? ""),
        supportValue: null,
        locationId: null,
      };
    case "LOCATION":
      return {
        normalizedValue: asString(value.amount ?? value.value ?? ""),
        searchKey: null,
        replaceText: null,
        supportValue: null,
        locationId: value.locationId ? asString(value.locationId) : null,
      };
    default:
      return {
        normalizedValue: asString(value.value ?? value.text ?? ""),
        searchKey: null,
        replaceText: null,
        supportValue: null,
        locationId: null,
      };
  }
}

export function normalizeIncomingBulkPayload(body = {}) {
  const canonicalPayload =
    body && typeof body.canonicalPayload === "object" && !Array.isArray(body.canonicalPayload)
      ? body.canonicalPayload
      : null;

  if (!canonicalPayload) {
    return {
      editedField: body.editedField || body.field || null,
      editedBy: body.editedBy || body.editedType || body.editType || null,
      inputType: body.inputType || null,
      value: body.value ?? body.editValue ?? null,
      searchKey: body.searchKey ?? null,
      replaceText: body.replaceText ?? null,
      supportValue: body.supportValue ?? null,
      locationId: body.locationId ?? body.location ?? null,
      canonicalPayload: null,
    };
  }

  assertCanonicalPayload(canonicalPayload);

  const { normalizedValue, searchKey, replaceText, supportValue, locationId } =
    normalizeCanonicalValue(canonicalPayload.inputType, canonicalPayload.value);

  return {
    editedField: canonicalPayload.field || body.editedField || body.field || null,
    editedBy:
      canonicalPayload.editType || body.editedBy || body.editedType || body.editType || null,
    inputType: canonicalPayload.inputType || body.inputType || null,
    value: normalizedValue,
    searchKey: searchKey ?? body.searchKey ?? null,
    replaceText: replaceText ?? body.replaceText ?? null,
    supportValue: supportValue ?? body.supportValue ?? null,
    locationId: locationId ?? body.locationId ?? body.location ?? null,
    canonicalPayload,
  };
}
