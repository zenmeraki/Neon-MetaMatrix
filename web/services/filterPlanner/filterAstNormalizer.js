export const FIELD_ALIASES = {
  created_at: "createdAt",
  updated_at: "updatedAt",
  product_type: "productType",
  compare_at_price: "compareAtPrice",
};

export const SUPPORTED_FILTER_OPERATORS = new Set([
  "in",
  "equals",
  "is",
  "is not",
  "contains",
  "does not contain",
  "starts with",
  "ends with",
  "is empty",
  "is empty/blank",
  "is not empty",
  "<",
  "<=",
  ">",
  ">=",
  "=",
  "!=",
  "does not equal",
  "less than",
  "less than or equal",
  "greater than",
  "greater than or equal",
  "is before",
  "is after",
  "is on",
  "is before x days ago",
  "is after x days ago",
]);

const EMPTY_VALUE_OPERATORS = new Set([
  "is empty",
  "is empty/blank",
  "is not empty",
]);

const LOGICAL_NODE_TYPES = new Set(["AND", "OR"]);

export function normalizeField(field) {
  const raw = String(field || "").trim();

  if (!raw) {
    throw new Error("Filter field is required");
  }

  return FIELD_ALIASES[raw] || raw;
}

export function normalizeOperator(operator) {
  const normalized = String(operator || "").trim().toLowerCase();

  if (!normalized) {
    throw new Error("Filter operator is required");
  }

  if (!SUPPORTED_FILTER_OPERATORS.has(normalized)) {
    throw new Error(`Unsupported filter operator: ${normalized}`);
  }

  return normalized;
}

function normalizeValue(value, operator) {
  if (EMPTY_VALUE_OPERATORS.has(operator)) {
    return null;
  }

  if (value === undefined) {
    throw new Error(`Filter value is required for operator ${operator}`);
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item === undefined) {
        throw new Error(`Array filter value contains undefined for operator ${operator}`);
      }

      return item;
    });
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    throw new Error(`Object filter value is not supported for operator ${operator}`);
  }

  return value;
}

function normalizePredicateNode(node) {
  const field = normalizeField(node?.field);
  const operator = normalizeOperator(node?.operator);

  return {
    type: "PREDICATE",
    field,
    operator,
    value: normalizeValue(node?.value, operator),
  };
}

function normalizeGroupNode(node) {
  const type = String(node?.type || "").trim().toUpperCase();

  if (!LOGICAL_NODE_TYPES.has(type)) {
    throw new Error(`Unsupported filter group type: ${type || "<empty>"}`);
  }

  if (!Array.isArray(node?.children)) {
    throw new Error(`Filter group children must be an array for type ${type}`);
  }

  return {
    type,
    children: node.children.map((child) => normalizeFilterNode(child)),
  };
}

function normalizeFilterNode(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new Error("Each filter node must be an object");
  }

  const rawType = String(node.type || "").trim().toUpperCase();

  if (LOGICAL_NODE_TYPES.has(rawType)) {
    return normalizeGroupNode(node);
  }

  return normalizePredicateNode(node);
}

export function normalizeFilterAst(filterParams = []) {
  if (!Array.isArray(filterParams)) {
    throw new Error("filterParams must be an array");
  }

  return {
    type: "AND",
    children: filterParams.map((filter) => normalizeFilterNode(filter)),
  };
}
