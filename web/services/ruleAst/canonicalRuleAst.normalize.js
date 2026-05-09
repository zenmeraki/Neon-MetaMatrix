import { CANONICAL_RULE_FIELDS, FIELD_ALIASES, NUMERIC_FIELDS } from "./canonicalRuleAst.constants.js";

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeField(field) {
  const raw = String(field || "").trim();
  const lower = raw.toLowerCase();
  const aliased = FIELD_ALIASES[lower] || raw;
  const normalized = aliased.replace(/\s+/g, "");
  return CANONICAL_RULE_FIELDS.includes(normalized) ? normalized : normalized;
}

function normalizeOperator(operator) {
  return String(operator || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function normalizeScalar(value, numeric = false) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (numeric) {
      const num = Number(trimmed);
      if (Number.isFinite(num)) return num;
    }
    return trimmed;
  }
  return value;
}

function normalizeValue(field, operator, value) {
  if (operator === "between" && value && typeof value === "object" && !Array.isArray(value)) {
    const numeric = NUMERIC_FIELDS.has(field);
    return {
      from: normalizeScalar(value.from, numeric),
      to: normalizeScalar(value.to, numeric),
    };
  }

  if (Array.isArray(value)) {
    const numeric = NUMERIC_FIELDS.has(field);
    return value.map((item) => normalizeScalar(item, numeric));
  }

  return normalizeScalar(value, NUMERIC_FIELDS.has(field));
}

function normalizeNode(node) {
  if (!node || typeof node !== "object") return node;
  if (String(node.type).toLowerCase() === "group") {
    const op = String(node.op || "AND").toUpperCase();
    const children = Array.isArray(node.children) ? node.children.map(normalizeNode) : [];
    const sortedChildren = children.sort((a, b) =>
      stableStringify(a).localeCompare(stableStringify(b)),
    );

    return {
      type: "group",
      op,
      children: sortedChildren,
    };
  }

  const field = normalizeField(node.field);
  const operator = normalizeOperator(node.operator);

  return {
    type: "condition",
    field,
    operator,
    value: normalizeValue(field, operator, node.value),
  };
}

export function normalizeCanonicalRuleAst(ast) {
  return normalizeNode(ast);
}

export function toStableCanonicalJson(ast) {
  return stableStringify(ast);
}
