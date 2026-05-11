import {
  CANONICAL_RULE_FIELDS,
  CANONICAL_RULE_OPERATORS,
  NUMERIC_FIELDS,
  RULE_FIELD_OPERATOR_MATRIX,
} from "./canonicalRuleAst.constants.js";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectEntities(node, entities = new Set()) {
  if (!node || typeof node !== "object") return entities;
  if (node.type === "condition") {
    const prefix = String(node.field || "").split(".")[0];
    if (prefix === "product" || prefix === "variant" || prefix === "collection" || prefix === "metafield") {
      entities.add(prefix);
    }
    return entities;
  }
  for (const child of Array.isArray(node.children) ? node.children : []) {
    collectEntities(child, entities);
  }
  return entities;
}

function validateValue(field, operator, value, errors) {
  if (operator === "between") {
    if (!isObject(value) || !("from" in value) || !("to" in value)) {
      errors.push({ code: "INVALID_BETWEEN_VALUE", message: "between requires {from,to}" });
      return;
    }
  }

  if (operator === "in" || operator === "not_in") {
    if (!Array.isArray(value) || value.length === 0) {
      errors.push({ code: "INVALID_LIST_VALUE", message: "in/not_in requires non-empty array" });
      return;
    }
  }

  if (NUMERIC_FIELDS.has(field) && ["gt", "gte", "lt", "lte", "eq", "neq"].includes(operator)) {
    if (!Number.isFinite(Number(value))) {
      errors.push({ code: "INVALID_NUMERIC_VALUE", message: "numeric value required" });
    }
  }
}

function visit(node, errors) {
  if (!isObject(node)) {
    errors.push({ code: "INVALID_NODE", message: "AST node must be object" });
    return;
  }

  if (node.type === "group") {
    if (!["AND", "OR"].includes(node.op)) {
      errors.push({ code: "INVALID_GROUP_OP", message: "group op must be AND/OR" });
    }
    if (!Array.isArray(node.children) || node.children.length === 0) {
      errors.push({ code: "INVALID_GROUP_CHILDREN", message: "group requires children" });
      return;
    }
    node.children.forEach((child) => visit(child, errors));
    return;
  }

  if (node.type !== "condition") {
    errors.push({ code: "INVALID_NODE_TYPE", message: "node type must be group or condition" });
    return;
  }

  if (!CANONICAL_RULE_FIELDS.includes(node.field)) {
    errors.push({ code: "UNKNOWN_FIELD", message: `Unknown field: ${node.field}` });
    return;
  }

  if (!CANONICAL_RULE_OPERATORS.includes(node.operator)) {
    errors.push({ code: "UNKNOWN_OPERATOR", message: `Unknown operator: ${node.operator}` });
    return;
  }

  const allowed = RULE_FIELD_OPERATOR_MATRIX[node.field] || [];
  if (!allowed.includes(node.operator)) {
    errors.push({
      code: "INVALID_FIELD_OPERATOR_PAIR",
      message: `Operator ${node.operator} not allowed for ${node.field}`,
    });
    return;
  }

  validateValue(node.field, node.operator, node.value, errors);
}

export function validateCanonicalRuleAst(ast, options = {}) {
  const errors = [];
  visit(ast, errors);

  const entities = collectEntities(ast);
  if (options.resourceScope === "PRODUCT" && entities.has("variant")) {
    errors.push({
      code: "RESOURCE_SCOPE_MISMATCH",
      message: "Variant fields are not allowed in PRODUCT scope",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
