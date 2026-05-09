const SUPPORTED_INPUT_TYPES = new Set([
  "NUMBER",
  "NUMBER_OR_TEXT",
  "ENTITY_IDS",
  "SEARCH_REPLACE",
  "LOCATION",
  "CHOICE",
  "NONE",
]);

function clientError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.isClientError = true;
  return error;
}

function normalizeInputType(inputType) {
  return String(inputType || "").trim().toUpperCase();
}

function validateValueShape(inputType, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw clientError("canonicalPayload.value must be an object");
  }

  switch (inputType) {
    case "ENTITY_IDS":
      if (!Array.isArray(value.ids)) {
        throw clientError("canonicalPayload.value.ids must be an array");
      }
      return;
    case "SEARCH_REPLACE":
      if (typeof value.search !== "string" || typeof value.replace !== "string") {
        throw clientError("canonicalPayload.value.search/replace must be strings");
      }
      return;
    case "LOCATION":
      if (
        value.locationId !== null &&
        value.locationId !== undefined &&
        typeof value.locationId !== "string"
      ) {
        throw clientError("canonicalPayload.value.locationId must be string or null");
      }
      return;
    default:
      return;
  }
}

function inferExpectedInputType(editType) {
  const normalized = String(editType || "").toLowerCase();
  if (normalized.includes("search/replace")) return "SEARCH_REPLACE";
  if (normalized.includes("collection")) return "ENTITY_IDS";
  if (normalized.includes("set category")) return "ENTITY_IDS";
  if (normalized.includes("inventory")) return "LOCATION";
  if (normalized.includes("status")) return "CHOICE";
  if (normalized.includes("taxable")) return "CHOICE";
  if (
    normalized.includes("increase") ||
    normalized.includes("decrease") ||
    normalized.includes("fixed amount") ||
    normalized.includes("fixed value") ||
    normalized.includes("percentage")
  ) {
    return "NUMBER_OR_TEXT";
  }
  return null;
}

export function validateCanonicalPayloadEnvelope(payload = {}) {
  const canonicalPayload = payload?.canonicalPayload;
  if (!canonicalPayload || typeof canonicalPayload !== "object" || Array.isArray(canonicalPayload)) {
    throw clientError("canonicalPayload is required");
  }

  const field = String(canonicalPayload.field || "").trim();
  const editType = String(canonicalPayload.editType || "").trim();
  const inputType = normalizeInputType(canonicalPayload.inputType);

  if (!field || !editType || !inputType) {
    throw clientError("canonicalPayload field, editType and inputType are required");
  }
  if (!SUPPORTED_INPUT_TYPES.has(inputType)) {
    throw clientError("Unsupported canonicalPayload.inputType");
  }
  const expectedInputType = inferExpectedInputType(editType);
  if (expectedInputType && inputType !== expectedInputType) {
    throw clientError(
      `canonicalPayload.inputType must be ${expectedInputType} for editType ${editType}`,
    );
  }

  validateValueShape(inputType, canonicalPayload.value);

  const bodyField = String(payload.editedField || payload.field || "").trim();
  const bodyEditType = String(payload.editedBy || payload.editedType || payload.editType || "").trim();
  if (bodyField && bodyField !== field) {
    throw clientError("canonicalPayload.field mismatch");
  }
  if (bodyEditType && bodyEditType !== editType) {
    throw clientError("canonicalPayload.editType mismatch");
  }

  return {
    field,
    editType,
    inputType,
    value: canonicalPayload.value,
  };
}
