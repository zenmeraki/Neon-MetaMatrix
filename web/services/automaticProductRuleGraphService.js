import crypto from "crypto";
import {
  getProductPrismaWhereFromAst,
  getRuleFieldConfig,
} from "./productService/productFilterCompiler.js";

export const RULE_EXECUTION_MODES = new Set([
  "REALTIME",
  "SCHEDULED",
  "MANUAL",
  "DRY_RUN",
]);

export const RULE_CONFLICT_STRATEGIES = new Set([
  "LAST_WRITE_WINS",
  "PRIORITY_WINS",
  "MERGE",
  "SKIP_ON_CONFLICT",
]);

export const RULE_SCOPE_TYPES = new Set([
  "ENTIRE_CATALOG",
  "SAVED_VIEW",
  "COLLECTION",
  "SEGMENT",
]);

export const RULE_ACTION_OPERATIONS = new Set([
  "SET",
  "INCREMENT",
  "MULTIPLY",
  "APPEND",
  "REMOVE",
]);

const MAX_RULE_AST_DEPTH = 10;

const OPERATORS_BY_TYPE = {
  number: new Set(["EQ", "NEQ", "GT", "GTE", "LT", "LTE", "IN", "NOT_IN", "BETWEEN", "IS_NULL", "NOT_NULL"]),
  string: new Set(["EQ", "NEQ", "IN", "NOT_IN", "CONTAINS", "NOT_CONTAINS", "STARTS_WITH", "ENDS_WITH", "IS_NULL", "NOT_NULL"]),
  string_array: new Set(["ARRAY_CONTAINS", "ARRAY_OVERLAP", "CONTAINS", "NOT_CONTAINS", "IS_NULL", "NOT_NULL"]),
};

const ACTION_OPERATION_TO_BULK_EDIT = {
  SET: {
    number: "Set to fixed value",
    string: "Set text to value",
    string_array: "Set text to value",
  },
  INCREMENT: {
    number: "Changed by fixed amount",
  },
  MULTIPLY: {
    number: "Increase by percent",
  },
  APPEND: {
    string: "Add text to end",
    string_array: "Add tag(s) to product",
  },
  REMOVE: {
    string_array: "Remove tag(s) from product",
  },
};

function normalizeLogic(value, fallback = "AND") {
  const logic = String(value || fallback).trim().toUpperCase();
  if (!["AND", "OR", "NOT"].includes(logic)) {
    throw new Error(`Unsupported rule condition logic: ${value}`);
  }
  return logic;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function assertValueMatchesField({ field, operator, value }) {
  const config = getRuleFieldConfig(field);
  if (!config) {
    throw new Error(`Unsupported rule field: ${field}`);
  }

  const allowed = OPERATORS_BY_TYPE[config.type];
  if (!allowed?.has(operator)) {
    throw new Error(`Operator ${operator} is not valid for ${field}`);
  }

  if (["IS_NULL", "NOT_NULL"].includes(operator)) {
    return config;
  }

  if (operator === "BETWEEN") {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new Error(`BETWEEN requires a two-item value array for ${field}`);
    }
    if (!value.every((item) => Number.isFinite(Number(item)))) {
      throw new Error(`BETWEEN values must be numeric for ${field}`);
    }
    return config;
  }

  if (["IN", "NOT_IN", "ARRAY_OVERLAP"].includes(operator)) {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(`${operator} requires a non-empty value array for ${field}`);
    }
    return config;
  }

  if (config.type === "number" && !Number.isFinite(Number(value))) {
    throw new Error(`Value for ${field} must be numeric`);
  }

  if (config.type === "string" && (value === null || value === undefined)) {
    throw new Error(`Value for ${field} is required`);
  }

  if (config.type === "string_array" && ["ARRAY_CONTAINS", "CONTAINS", "NOT_CONTAINS"].includes(operator)) {
    if (Array.isArray(value) ? value.length === 0 : !String(value ?? "").trim()) {
      throw new Error(`Value for ${field} is required`);
    }
  }

  return config;
}

function normalizeConditionNode(node, depth = 0) {
  if (depth > MAX_RULE_AST_DEPTH) {
    throw new Error(`Rule condition AST exceeds max depth ${MAX_RULE_AST_DEPTH}`);
  }

  if (!node || typeof node !== "object") {
    throw new Error("Rule condition node must be an object");
  }

  if (node.type === "not") {
    if (!node.child) {
      throw new Error("Rule NOT condition requires child");
    }
    return {
      type: "not",
      child: normalizeConditionNode(node.child, depth + 1),
    };
  }

  if (node.type === "predicate" || node.field) {
    if (!node.field) throw new Error("Rule condition field is required");
    if (!node.operator) throw new Error("Rule condition operator is required");
    const operator = String(node.operator).trim().toUpperCase();
    assertValueMatchesField({
      field: node.field,
      operator,
      value: node.value,
    });
    return {
      type: "predicate",
      field: node.field,
      operator,
      value: node.value,
    };
  }

  const logic = normalizeLogic(node.operator || node.logic || node.type, "AND");
  const children = Array.isArray(node.children)
    ? node.children
    : Array.isArray(node.conditions)
      ? node.conditions
      : [];

  if (!children.length) {
    throw new Error("Rule condition group requires at least one child");
  }

  const normalizedChildren = children
    .map((child) => normalizeConditionNode(child, depth + 1))
    .flatMap((child) =>
      child.type === "group" && child.operator === logic && logic !== "NOT"
        ? child.children
        : [child],
    );

  if (!normalizedChildren.length) {
    throw new Error("Rule condition group requires at least one child");
  }

  const sortedChildren = [...normalizedChildren].sort((left, right) =>
    stableStringify(left).localeCompare(stableStringify(right)),
  );

  return {
    type: "group",
    operator: logic,
    children: sortedChildren,
  };
}

export function normalizeRuleConditionAst(input) {
  if (Array.isArray(input)) {
    return {
      type: "group",
      operator: "AND",
      children: input.map(normalizeConditionNode),
    };
  }

  if (!input) {
    return {
      type: "group",
      operator: "AND",
      children: [],
    };
  }

  return normalizeConditionNode(input);
}

export function compileRuleConditionAst(input, shop) {
  return getProductPrismaWhereFromAst(normalizeRuleConditionAst(input), shop);
}

function normalizeActionValue(operation, fieldConfig, value) {
  if (["APPEND", "REMOVE"].includes(operation) && fieldConfig.type === "string_array") {
    const values = Array.isArray(value) ? value : [value];
    const normalized = values.map((item) => String(item || "").trim()).filter(Boolean);
    if (!normalized.length) {
      throw new Error(`${operation} requires at least one value for array field`);
    }
    return normalized;
  }

  if (["INCREMENT", "MULTIPLY"].includes(operation)) {
    if (fieldConfig.type !== "number") {
      throw new Error(`${operation} is only valid for numeric fields`);
    }
    if (!Number.isFinite(Number(value))) {
      throw new Error(`${operation} requires a numeric value`);
    }
    return Number(value);
  }

  if (operation === "SET" && fieldConfig.type === "number") {
    if (!Number.isFinite(Number(value))) {
      throw new Error("SET requires a numeric value for numeric fields");
    }
    return Number(value);
  }

  return value;
}

export function normalizeRuleActionDsl(actions = [], depth = 0) {
  if (depth > MAX_RULE_AST_DEPTH) {
    throw new Error(`Rule action AST exceeds max depth ${MAX_RULE_AST_DEPTH}`);
  }

  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error("Rule AST actions are required");
  }

  return actions.map((action) => {
    if (!action || typeof action !== "object" || Array.isArray(action)) {
      throw new Error("Rule action must be an object");
    }

    if (action.type === "conditional") {
      return {
        type: "conditional",
        condition: normalizeConditionNode(action.condition, depth + 1),
        then: normalizeRuleActionDsl(action.then, depth + 1),
      };
    }

    if (action.type !== "update") {
      throw new Error(`Unsupported rule action type: ${action.type}`);
    }

    const fieldConfig = getRuleFieldConfig(action.field);
    if (!fieldConfig) {
      throw new Error(`Unsupported action field: ${action.field}`);
    }

    const operation = String(action.operation || action.editOption || "").trim().toUpperCase();
    if (!RULE_ACTION_OPERATIONS.has(operation)) {
      throw new Error(`Unsupported action operation: ${action.operation}`);
    }

    if (!ACTION_OPERATION_TO_BULK_EDIT[operation]?.[fieldConfig.type]) {
      throw new Error(`${operation} is not valid for ${action.field}`);
    }

    return {
      type: "update",
      field: action.field,
      operation,
      value: normalizeActionValue(operation, fieldConfig, action.value),
    };
  });
}

export function normalizeRuleAstForStorage(input = {}) {
  const root = normalizeRuleAstRoot(input);
  return {
    ...root,
    filter: normalizeRuleConditionAst(root.filter),
    actions: normalizeRuleActionDsl(root.actions),
  };
}

export function hashNormalizedRuleAst(ast) {
  return crypto.createHash("sha256").update(stableStringify(ast)).digest("hex");
}

export function toBulkEditActions(actions = []) {
  return normalizeRuleActionDsl(actions).map((action) => {
    if (action.type === "conditional") {
      throw new Error("Conditional actions require the Rule execution pipeline");
    }

    const fieldConfig = getRuleFieldConfig(action.field);
    const editOption = ACTION_OPERATION_TO_BULK_EDIT[action.operation]?.[fieldConfig.type];
    const value =
      action.operation === "MULTIPLY"
        ? Number(((Number(action.value) - 1) * 100).toFixed(6))
        : Array.isArray(action.value)
          ? action.value.join(",")
          : action.value;

    return {
      field: fieldConfig.filterField === "tag" ? "tags" : action.field,
      value,
      editOption,
      searchKey: null,
      replaceText: null,
      supportValue: null,
      locationId: null,
    };
  });
}

export function compileRuleAstToPinnedWhere(ruleAst, { shop, catalogBatchId }) {
  if (!catalogBatchId) {
    throw new Error("catalogBatchId is required for rule compilation");
  }

  const normalized = normalizeRuleAstForStorage(ruleAst);
  const where = compileRuleConditionAst(normalized.filter, shop);
  return {
    ...where,
    AND: [
      ...(Array.isArray(where.AND) ? where.AND : []),
      { mirrorBatchId: catalogBatchId },
    ],
  };
}

function sqlParam(params, value, offset) {
  params.push(value);
  return `$${params.length + offset - 1}`;
}

function compilePredicateToSql(node, params, offset) {
  const fieldConfig = getRuleFieldConfig(node.field);
  if (!fieldConfig) {
    throw new Error(`Unsupported rule field: ${node.field}`);
  }

  const column = fieldConfig.column;
  const operator = String(node.operator || "").trim().toUpperCase();

  switch (operator) {
    case "EQ":
      return `${column} = ${sqlParam(params, node.value, offset)}`;
    case "NEQ":
      return `${column} != ${sqlParam(params, node.value, offset)}`;
    case "GT":
      return `${column} > ${sqlParam(params, node.value, offset)}`;
    case "GTE":
      return `${column} >= ${sqlParam(params, node.value, offset)}`;
    case "LT":
      return `${column} < ${sqlParam(params, node.value, offset)}`;
    case "LTE":
      return `${column} <= ${sqlParam(params, node.value, offset)}`;
    case "IN":
      return `${column} = ANY(${sqlParam(params, node.value, offset)})`;
    case "NOT_IN":
      return `NOT (${column} = ANY(${sqlParam(params, node.value, offset)}))`;
    case "CONTAINS":
      return `${column} ILIKE ${sqlParam(params, `%${node.value}%`, offset)}`;
    case "NOT_CONTAINS":
      return `${column} NOT ILIKE ${sqlParam(params, `%${node.value}%`, offset)}`;
    case "STARTS_WITH":
      return `${column} ILIKE ${sqlParam(params, `${node.value}%`, offset)}`;
    case "ENDS_WITH":
      return `${column} ILIKE ${sqlParam(params, `%${node.value}`, offset)}`;
    case "IS_NULL":
      return `${column} IS NULL`;
    case "NOT_NULL":
      return `${column} IS NOT NULL`;
    case "ARRAY_CONTAINS":
      return `${column} @> ${sqlParam(params, Array.isArray(node.value) ? node.value : [node.value], offset)}`;
    case "ARRAY_OVERLAP":
      return `${column} && ${sqlParam(params, node.value, offset)}`;
    case "BETWEEN":
      return `(${column} >= ${sqlParam(params, node.value[0], offset)} AND ${column} <= ${sqlParam(params, node.value[1], offset)})`;
    default:
      throw new Error(`Unsupported SQL operator: ${operator}`);
  }
}

function compileConditionToSql(node, params, offset) {
  if (node.type === "predicate") {
    return compilePredicateToSql(node, params, offset);
  }

  if (node.type === "not") {
    return `NOT (${compileConditionToSql(node.child, params, offset)})`;
  }

  const children = node.children.map((child) =>
    compileConditionToSql(child, params, offset),
  );
  return `(${children.join(` ${node.operator} `)})`;
}

export function compileRuleAstToSqlWhere(
  ruleAst,
  { catalogBatchId, shopId = null, paramOffset = 1 } = {},
) {
  if (!catalogBatchId) {
    throw new Error("catalogBatchId is required for SQL rule compilation");
  }

  const normalized = normalizeRuleAstForStorage(ruleAst);
  const params = [];
  const clauses = [compileConditionToSql(normalized.filter, params, paramOffset)];

  clauses.push(`catalog_batch_id = ${sqlParam(params, catalogBatchId, paramOffset)}`);
  if (shopId) {
    clauses.push(`shop_id = ${sqlParam(params, shopId, paramOffset)}`);
  }

  return {
    sql: `WHERE ${clauses.join(" AND ")}`,
    params,
    hash: hashNormalizedRuleAst(normalized),
    normalized,
  };
}

export function normalizeRuleAstRoot(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Rule AST root must be an object");
  }

  const version = Number(input.version || 1);
  if (version !== 1) {
    throw new Error(`Unsupported rule AST version: ${input.version}`);
  }

  const filter = normalizeRuleConditionAst(
    input.filter || input.conditionAst || input.conditions,
  );
  const actions = normalizeRuleActionDsl(Array.isArray(input.actions) ? input.actions : []);

  const meta =
    input.meta && typeof input.meta === "object" && !Array.isArray(input.meta)
      ? input.meta
      : {};

  return {
    version,
    filter,
    actions,
    meta: {
      matchMode: String(meta.matchMode || "ALL").trim().toUpperCase(),
      entity: String(meta.entity || "PRODUCT").trim().toUpperCase(),
    },
  };
}

export function normalizeRuleExecutionMode(value, fallback = "REALTIME") {
  const mode = String(value || fallback).trim().toUpperCase();
  if (!RULE_EXECUTION_MODES.has(mode)) {
    throw new Error("Unsupported automatic rule executionMode");
  }
  return mode;
}

export function normalizeRuleConflictStrategy(value, fallback = "PRIORITY_WINS") {
  const strategy = String(value || fallback).trim().toUpperCase();
  if (!RULE_CONFLICT_STRATEGIES.has(strategy)) {
    throw new Error("Unsupported automatic rule conflictStrategy");
  }
  return strategy;
}

export function normalizeRuleScope(scope) {
  const normalized =
    scope && typeof scope === "object" && !Array.isArray(scope)
      ? scope
      : { type: "ENTIRE_CATALOG" };
  const type = String(normalized.type || "ENTIRE_CATALOG").trim().toUpperCase();

  if (!RULE_SCOPE_TYPES.has(type)) {
    throw new Error("Unsupported automatic rule scope.type");
  }

  if (type !== "ENTIRE_CATALOG" && !normalized.referenceId) {
    throw new Error("rule.scope.referenceId is required for scoped rules");
  }

  return {
    type,
    referenceId: normalized.referenceId || null,
    filterParams: Array.isArray(normalized.filterParams)
      ? normalized.filterParams
      : undefined,
  };
}

export function buildScopeWhere(scope, shop) {
  const normalized = normalizeRuleScope(scope);

  switch (normalized.type) {
    case "ENTIRE_CATALOG":
      return { shop };
    case "COLLECTION":
      return compileRuleConditionAst(
        {
          type: "condition",
          field: "collection",
          operator: "equals",
          value: normalized.referenceId,
        },
        shop,
      );
    case "SAVED_VIEW":
    case "SEGMENT":
      if (!Array.isArray(normalized.filterParams)) {
        throw new Error(`${normalized.type} scope requires filterParams until saved scopes are persisted server-side`);
      }
      return compileRuleConditionAst(normalized.filterParams, shop);
    default:
      return { shop };
  }
}

export function mergeWhereClauses(...clauses) {
  const filtered = clauses.filter(Boolean);
  const shop = filtered.find((clause) => clause.shop)?.shop;
  const AND = [];

  for (const clause of filtered) {
    const { shop: _shop, ...rest } = clause;
    if (Object.keys(rest).length) {
      AND.push(rest);
    }
  }

  return {
    ...(shop ? { shop } : {}),
    ...(AND.length ? { AND } : {}),
  };
}
