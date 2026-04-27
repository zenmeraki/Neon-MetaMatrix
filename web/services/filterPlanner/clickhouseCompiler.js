import { FILTER_FIELD_REGISTRY } from "./filterRegistry.js";

function requireField(field) {
  const config = FILTER_FIELD_REGISTRY[field];

  if (!config) {
    throw new Error(`Unsupported ClickHouse filter field: ${field}`);
  }

  return config;
}

function createParamContext() {
  return {
    params: {},
    index: 0,
  };
}

function addParam(context, value) {
  const key = `p${context.index++}`;
  context.params[key] = value;
  return `{${key}:String}`;
}

function addNumberParam(context, value) {
  const num = Number(value);

  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ClickHouse numeric value: ${value}`);
  }

  const key = `p${context.index++}`;
  context.params[key] = num;
  return `{${key}:Float64}`;
}

function addDateParam(context, value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error("Invalid ClickHouse date value");
    }

    const key = `p${context.index++}`;
    context.params[key] = value.toISOString();
    return `{${key}:String}`;
  }

  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Invalid ClickHouse date value");
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ClickHouse date value: ${value}`);
  }

  const key = `p${context.index++}`;
  context.params[key] = value.trim();
  return `{${key}:String}`;
}

function normalizePageNumber(value, field, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = Number(value);

  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }

  return normalized;
}

function compileStringPredicate(column, operator, value, context) {
  if (operator === "in") {
    const values = Array.isArray(value)
      ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [];

    if (!values.length) {
      throw new Error(`IN filter requires values for ${column}`);
    }

    const placeholders = values.map((item) => addParam(context, item));
    return `lowerUTF8(${column}) IN (${placeholders.map((item) => `lowerUTF8(${item})`).join(", ")})`;
  }

  const raw = String(value ?? "").trim();

  if (!raw && !["is empty", "is empty/blank", "is not empty"].includes(operator)) {
    throw new Error(`Value required for ${column}`);
  }

  const param = addParam(context, raw);
  const col = `lowerUTF8(${column})`;
  const val = `lowerUTF8(${param})`;

  switch (operator) {
    case "equals":
    case "is":
      return `${col} = ${val}`;

    case "is not":
    case "does not equal":
      return `${col} != ${val}`;

    case "contains":
      return `positionCaseInsensitiveUTF8(${column}, ${param}) > 0`;

    case "does not contain":
      return `positionCaseInsensitiveUTF8(${column}, ${param}) = 0`;

    case "starts with":
      return `startsWith(${col}, ${val})`;

    case "ends with":
      return `endsWith(${col}, ${val})`;

    case "is empty":
    case "is empty/blank":
      return `(${column} IS NULL OR ${column} = '')`;

    case "is not empty":
      return `(${column} IS NOT NULL AND ${column} != '')`;

    default:
      throw new Error(`Unsupported ClickHouse string operator: ${operator}`);
  }
}

function compileNumberPredicate(column, operator, value, context) {
  if (operator === "in") {
    const values = Array.isArray(value)
      ? value
          .map((item) => Number(item))
          .filter((item) => Number.isFinite(item))
      : [];

    if (!values.length) {
      throw new Error(`IN filter requires numeric values for ${column}`);
    }

    const placeholders = values.map((item) => addNumberParam(context, item));
    return `${column} IN (${placeholders.join(", ")})`;
  }

  if (["is empty", "is empty/blank"].includes(operator)) {
    return `${column} IS NULL`;
  }

  if (operator === "is not empty") {
    return `${column} IS NOT NULL`;
  }

  const num = addNumberParam(context, value);

  switch (operator) {
    case "<":
    case "less than":
      return `${column} < ${num}`;
    case "<=":
    case "less than or equal":
      return `${column} <= ${num}`;
    case ">":
    case "greater than":
      return `${column} > ${num}`;
    case ">=":
    case "greater than or equal":
      return `${column} >= ${num}`;
    case "=":
    case "equals":
    case "is":
      return `${column} = ${num}`;
    case "!=":
    case "is not":
    case "does not equal":
      return `${column} != ${num}`;
    default:
      throw new Error(`Unsupported ClickHouse number operator: ${operator}`);
  }
}

function compileDatePredicate(column, operator, value, context) {
  if (operator === "in") {
    const values = Array.isArray(value)
      ? value.filter((item) => item !== undefined && item !== null && item !== "")
      : [];

    if (!values.length) {
      throw new Error(`IN filter requires date values for ${column}`);
    }

    const placeholders = values.map((item) => addDateParam(context, item));
    return `toDate(${column}) IN (${placeholders.map((item) => `toDate(parseDateTimeBestEffort(${item}))`).join(", ")})`;
  }

  if (["is empty", "is empty/blank"].includes(operator)) {
    return `${column} IS NULL`;
  }

  if (operator === "is not empty") {
    return `${column} IS NOT NULL`;
  }

  const date = addDateParam(context, value);

  switch (operator) {
    case "is before":
      return `${column} < parseDateTimeBestEffort(${date})`;

    case "is after":
      return `${column} > parseDateTimeBestEffort(${date})`;

    case "is on":
      return `toDate(${column}) = toDate(parseDateTimeBestEffort(${date}))`;

    default:
      throw new Error(`Unsupported ClickHouse date operator: ${operator}`);
  }
}

function compileCollectionPredicate(operator, value, context) {
  if (operator === "in") {
    const values = Array.isArray(value)
      ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [];

    if (!values.length) {
      throw new Error("IN filter requires values for collection");
    }

    const clauses = values.map((item) => {
      const param = addParam(context, item);
      return `has(collection_titles, ${param})`;
    });

    return `(${clauses.join(" OR ")})`;
  }

  const raw = String(value ?? "").trim();

  if (!raw && !["is empty", "is empty/blank", "is not empty"].includes(operator)) {
    throw new Error("Value required for collection");
  }

  const param = addParam(context, raw);

  switch (operator) {
    case "equals":
    case "is":
      return `has(collection_titles, ${param})`;

    case "contains":
      return `arrayExists(x -> positionCaseInsensitiveUTF8(x, ${param}) > 0, collection_titles)`;

    case "is not":
    case "does not equal":
      return `NOT has(collection_titles, ${param})`;

    case "does not contain":
      return `NOT arrayExists(x -> positionCaseInsensitiveUTF8(x, ${param}) > 0, collection_titles)`;

    case "is empty":
    case "is empty/blank":
      return `(collection_titles IS NULL OR empty(collection_titles))`;

    case "is not empty":
      return `(collection_titles IS NOT NULL AND NOT empty(collection_titles))`;

    default:
      throw new Error("Unsupported ClickHouse collection operator");
  }
}

function compilePredicateToClickHouse(node, context) {
  const config = requireField(node.field);
  const column = config.clickhouseColumn;

  if (config.domain === "collection") {
    return compileCollectionPredicate(node.operator, node.value, context);
  }

  if (!column) {
    throw new Error(`ClickHouse column mapping missing for field ${node.field}`);
  }

  if (config.type === "number") {
    return compileNumberPredicate(column, node.operator, node.value, context);
  }

  if (config.type === "date") {
    return compileDatePredicate(column, node.operator, node.value, context);
  }

  return compileStringPredicate(column, node.operator, node.value, context);
}

function compileNode(node, context) {
  if (!node || typeof node !== "object") {
    throw new Error("AST node is required");
  }

  if (node.type === "PREDICATE") {
    return compilePredicateToClickHouse(node, context);
  }

  if (node.type === "AND" || node.type === "OR") {
    if (!Array.isArray(node.children)) {
      throw new Error(`AST ${node.type} node must include children`);
    }

    const compiledChildren = node.children.map((child) => `(${compileNode(child, context)})`);
    const joiner = ` ${node.type} `;

    return compiledChildren.length ? compiledChildren.join(joiner) : "1";
  }

  throw new Error(`Unsupported ClickHouse AST node type: ${node.type}`);
}

export function compileAstToClickHouseWhere({ ast, shop, mirrorBatchId }) {
  if (!shop) throw new Error("shop is required");
  if (!mirrorBatchId) throw new Error("mirrorBatchId is required");

  const context = createParamContext();
  const clauses = [
    `shop = ${addParam(context, shop)}`,
    `mirror_batch_id = ${addParam(context, mirrorBatchId)}`,
  ];

  const compiledAst = compileNode(ast || { type: "AND", children: [] }, context);
  if (compiledAst && compiledAst !== "1") {
    clauses.push(compiledAst);
  }

  return {
    sql: clauses.join(" AND "),
    params: context.params,
  };
}

export function buildClickHouseProductIdQuery({
  ast,
  shop,
  mirrorBatchId,
  limit = 100,
  offset = 0,
}) {
  const safeLimit = normalizePageNumber(limit, "limit", 100);
  const safeOffset = normalizePageNumber(offset, "offset", 0);
  const { sql: where, params } = compileAstToClickHouseWhere({
    ast,
    shop,
    mirrorBatchId,
  });

  return {
    sql: `
      SELECT DISTINCT product_id
      FROM product_variant_flat
      WHERE ${where}
      ORDER BY product_id ASC
      LIMIT ${safeLimit}
      OFFSET ${safeOffset}
    `.trim(),
    params,
  };
}

export function buildClickHouseCountQuery({ ast, shop, mirrorBatchId }) {
  const { sql: where, params } = compileAstToClickHouseWhere({
    ast,
    shop,
    mirrorBatchId,
  });

  return {
    sql: `
      SELECT countDistinct(product_id) AS count
      FROM product_variant_flat
      WHERE ${where}
    `.trim(),
    params,
  };
}

export function buildClickHouseProductIdPageQuery({
  ast,
  shop,
  mirrorBatchId,
  limit = 100,
  offset = 0,
}) {
  const safeLimit = normalizePageNumber(limit, "limit", 100);
  const safeOffset = normalizePageNumber(offset, "offset", 0);
  const { sql: where, params } = compileAstToClickHouseWhere({
    ast,
    shop,
    mirrorBatchId,
  });

  return {
    sql: `
      SELECT
        product_id,
        count() OVER () AS total_count
      FROM (
        SELECT DISTINCT product_id
        FROM product_variant_flat
        WHERE ${where}
      ) AS filtered_products
      ORDER BY product_id ASC
      LIMIT ${safeLimit}
      OFFSET ${safeOffset}
    `.trim(),
    params,
  };
}
