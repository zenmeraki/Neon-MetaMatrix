const INPUT_FIELD_DEFINITIONS = {
  title: {
    type: "string",
    getValues: (product) => [product.title || ""],
  },
  handle: {
    type: "string",
    getValues: (product) => [product.handle || ""],
  },
  vendor: {
    type: "string",
    getValues: (product) => [product.vendor || ""],
  },
  productType: {
    type: "string",
    getValues: (product) => [product.productType || ""],
  },
  status: {
    type: "string",
    getValues: (product) => [product.status || ""],
  },
  description: {
    type: "string",
    getValues: (product) => [product.description || ""],
  },
  tags: {
    type: "string[]",
    getValues: (product) => (Array.isArray(product.tags) ? product.tags : []),
  },
  categoryName: {
    type: "string",
    getValues: (product) => [product.categoryName || ""],
  },
  option1Name: {
    type: "string",
    getValues: (product) => [product.option1Name || ""],
  },
  option2Name: {
    type: "string",
    getValues: (product) => [product.option2Name || ""],
  },
  option3Name: {
    type: "string",
    getValues: (product) => [product.option3Name || ""],
  },
  totalInventory: {
    type: "number",
    getValues: (product) => [Number(product.totalInventory || 0)],
  },
  "variants.price": {
    type: "number[]",
    getValues: (product) => (product.variants || []).map((variant) => Number(variant.price || 0)),
  },
  "variants.compareAtPrice": {
    type: "number[]",
    getValues: (product) => (product.variants || []).map((variant) => Number(variant.compareAtPrice || 0)),
  },
  "variants.sku": {
    type: "string[]",
    getValues: (product) => (product.variants || []).map((variant) => variant.sku || ""),
  },
  "variants.barcode": {
    type: "string[]",
    getValues: (product) => (product.variants || []).map((variant) => variant.barcode || ""),
  },
  "variants.taxable": {
    type: "boolean[]",
    getValues: (product) => (product.variants || []).map((variant) => Boolean(variant.taxable)),
  },
  "variants.inventoryPolicy": {
    type: "string[]",
    getValues: (product) => (product.variants || []).map((variant) => variant.inventoryPolicy || ""),
  },
};

function codedError(code, message = code, meta = undefined) {
  const error = new Error(message);
  error.code = code;
  if (meta !== undefined) error.meta = meta;
  return error;
}

const OUTPUT_FIELD_DEFINITIONS = {
  title: {
    type: "text",
    scope: "product",
  },
  handle: {
    type: "text",
    scope: "product",
  },
  vendor: {
    type: "text",
    scope: "product",
  },
  productType: {
    type: "text",
    scope: "product",
  },
  description: {
    type: "text",
    scope: "product",
  },
  metaTitle: {
    type: "text",
    scope: "product",
  },
  metaDescription: {
    type: "text",
    scope: "product",
  },
  status: {
    type: "enum",
    scope: "product",
    allowedValues: ["ACTIVE", "DRAFT", "ARCHIVED"],
  },
  tags: {
    type: "tags",
    scope: "product",
  },
  price: {
    type: "number",
    scope: "variant",
  },
  compareAtPrice: {
    type: "number",
    scope: "variant",
  },
  sku: {
    type: "text",
    scope: "variant",
  },
  barcode: {
    type: "text",
    scope: "variant",
  },
  taxable: {
    type: "boolean",
    scope: "variant",
  },
  inventoryPolicy: {
    type: "enum",
    scope: "variant",
    allowedValues: ["CONTINUE", "DENY"],
  },
};

export const SUPPORTED_SNIPPET_OPERATORS = [
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
  "in",
  "notIn",
  "exists",
  "isEmpty",
];

function asStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeScalarSet(fieldConfig, value) {
  switch (fieldConfig.type) {
    case "text":
      if (typeof value !== "string") {
        throw codedError("SNIPPET_OUTPUT_EXPECTED_STRING");
      }
      return { set: value };
    case "number": {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw codedError("SNIPPET_OUTPUT_EXPECTED_NUMBER");
      }
      return { set: String(parsed) };
    }
    case "boolean":
      if (typeof value !== "boolean") {
        throw codedError("SNIPPET_OUTPUT_EXPECTED_BOOLEAN");
      }
      return { set: value };
    case "enum": {
      const normalized = String(value).trim().toUpperCase();
      if (!fieldConfig.allowedValues.includes(normalized)) {
        throw codedError("SNIPPET_OUTPUT_EXPECTED_ENUM", "Expected allowed enum value", {
          allowedValues: fieldConfig.allowedValues,
          value: normalized,
        });
      }
      return { set: normalized };
    }
    default:
      throw codedError("SNIPPET_OUTPUT_UNSUPPORTED_FIELD_TYPE");
  }
}

export function getSnippetInputFieldDefinition(field) {
  return INPUT_FIELD_DEFINITIONS[field] || null;
}

export function getSnippetOutputFieldDefinition(field) {
  return OUTPUT_FIELD_DEFINITIONS[field] || null;
}

export function listSnippetInputFields() {
  return Object.keys(INPUT_FIELD_DEFINITIONS);
}

export function listSnippetOutputFields() {
  return Object.keys(OUTPUT_FIELD_DEFINITIONS);
}

export function normalizeSnippetOutput(output = {}) {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw codedError("SNIPPET_OUTPUT_OBJECT_REQUIRED");
  }

  const normalized = {};

  for (const [field, rawValue] of Object.entries(output)) {
    const fieldConfig = getSnippetOutputFieldDefinition(field);
    if (!fieldConfig) {
      throw codedError("SNIPPET_OUTPUT_UNSUPPORTED_FIELD", "Unsupported output field", { field });
    }

    if (fieldConfig.type === "tags") {
      if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
        throw codedError("SNIPPET_OUTPUT_TAGS_OBJECT_REQUIRED");
      }

      const supportedKeys = ["add", "remove", "set"].filter((key) => rawValue[key] !== undefined);
      if (supportedKeys.length !== 1) {
        throw codedError("SNIPPET_OUTPUT_TAGS_OPERATION_REQUIRED");
      }

      normalized[field] = {
        [supportedKeys[0]]: asStringArray(rawValue[supportedKeys[0]]),
      };
      continue;
    }

    if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
      if (!Object.prototype.hasOwnProperty.call(rawValue, "set")) {
        throw codedError(
          "SNIPPET_OUTPUT_SET_OPERATION_REQUIRED",
          `${field} output must contain a set operation`,
          { field },
        );
      }

      normalized[field] = normalizeScalarSet(fieldConfig, rawValue.set);
      continue;
    }

    normalized[field] = normalizeScalarSet(fieldConfig, rawValue);
  }

  return normalized;
}
