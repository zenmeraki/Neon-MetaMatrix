const MAX_AST_DEPTH = 10;
const MAX_GROUP_CHILDREN = 100;

export class AstCompileError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AstCompileError";
    this.code = code;
    this.details = details;
  }
}

export const FIELD_REGISTRY = {
  status: {
    entity: "PRODUCT",
    type: "enum",
    column: 'p.status',
    indexedExact: true,
    allowedOperators: ["EQ", "NEQ", "IN", "NOT_IN", "IS_NULL", "NOT_NULL"],
  },
  title: {
    entity: "PRODUCT",
    type: "text",
    column: 'p.title',
    indexedExact: true,
    allowedOperators: [
      "EQ",
      "NEQ",
      "CONTAINS",
      "NOT_CONTAINS",
      "STARTS_WITH",
      "ENDS_WITH",
      "IS_NULL",
      "NOT_NULL",
    ],
  },
  vendor: {
    entity: "PRODUCT",
    type: "text",
    column: 'p.vendor',
    indexedExact: true,
    allowedOperators: [
      "EQ",
      "NEQ",
      "CONTAINS",
      "IN",
      "NOT_IN",
      "IS_NULL",
      "NOT_NULL",
    ],
  },
  tags: {
    entity: "PRODUCT",
    type: "text_array",
    column: 'p.tags',
    indexedArray: true,
    allowedOperators: [
      "ARRAY_CONTAINS",
      "ARRAY_OVERLAP",
      "NOT_ARRAY_CONTAINS",
      "IS_NULL",
      "NOT_NULL",
    ],
  },
  tag: {
    entity: "PRODUCT",
    type: "text_array",
    column: 'p.tags',
    indexedArray: true,
    allowedOperators: [
      "ARRAY_CONTAINS",
      "ARRAY_OVERLAP",
      "NOT_ARRAY_CONTAINS",
      "CONTAINS",
      "NOT_CONTAINS",
      "IS_NULL",
      "NOT_NULL",
    ],
  },
  productType: {
    entity: "PRODUCT",
    type: "text",
    column: 'p."productType"',
    indexedExact: true,
    allowedOperators: [
      "EQ",
      "NEQ",
      "CONTAINS",
      "IN",
      "NOT_IN",
      "IS_NULL",
      "NOT_NULL",
    ],
  },
  product_type: {
    entity: "PRODUCT",
    type: "text",
    column: 'p."productType"',
    indexedExact: true,
    allowedOperators: [
      "EQ",
      "NEQ",
      "CONTAINS",
      "IN",
      "NOT_IN",
      "IS_NULL",
      "NOT_NULL",
    ],
  },
  totalInventory: {
    entity: "PRODUCT",
    type: "number",
    column: 'p."totalInventory"',
    indexedExact: true,
    allowedOperators: [
      "EQ",
      "NEQ",
      "GT",
      "GTE",
      "LT",
      "LTE",
      "BETWEEN",
      "IS_NULL",
      "NOT_NULL",
    ],
  },
  total_inventory: {
    entity: "PRODUCT",
    type: "number",
    column: 'p."totalInventory"',
    indexedExact: true,
    allowedOperators: [
      "EQ",
      "NEQ",
      "GT",
      "GTE",
      "LT",
      "LTE",
      "BETWEEN",
      "IS_NULL",
      "NOT_NULL",
    ],
  },
  collection: {
    entity: "PRODUCT",
    type: "text",
    column: 'p."collectionsJson"::text',
    allowedOperators: ["EQ", "NEQ", "CONTAINS", "NOT_CONTAINS", "IN", "NOT_IN"],
  },
  inventory: {
    entity: "VARIANT",
    type: "number",
    relation: "VARIANT_EXISTS",
    column: 'v."inventoryQuantity"',
    allowedOperators: [
      "EQ",
      "NEQ",
      "GT",
      "GTE",
      "LT",
      "LTE",
      "BETWEEN",
      "IS_NULL",
      "NOT_NULL",
    ],
  },
  variantPrice: {
    entity: "VARIANT",
    type: "decimal",
    relation: "VARIANT_EXISTS",
    column: "v.price",
    allowedOperators: [
      "EQ",
      "NEQ",
      "GT",
      "GTE",
      "LT",
      "LTE",
      "BETWEEN",
      "IS_NULL",
      "NOT_NULL",
    ],
  },
  price: {
    entity: "VARIANT",
    type: "decimal",
    relation: "VARIANT_EXISTS",
    column: "v.price",
    allowedOperators: [
      "EQ",
      "NEQ",
      "GT",
      "GTE",
      "LT",
      "LTE",
      "BETWEEN",
      "IS_NULL",
      "NOT_NULL",
    ],
  },
  variantSku: {
    entity: "VARIANT",
    type: "text",
    relation: "VARIANT_EXISTS",
    column: "v.sku",
    allowedOperators: [
      "EQ",
      "NEQ",
      "CONTAINS",
      "STARTS_WITH",
      "IN",
      "IS_NULL",
      "NOT_NULL",
    ],
  },
  sku: {
    entity: "VARIANT",
    type: "text",
    relation: "VARIANT_EXISTS",
    column: "v.sku",
    allowedOperators: [
      "EQ",
      "NEQ",
      "CONTAINS",
      "STARTS_WITH",
      "IN",
      "IS_NULL",
      "NOT_NULL",
    ],
  },
  barcode: {
    entity: "VARIANT",
    type: "text",
    relation: "VARIANT_EXISTS",
    column: "v.barcode",
    allowedOperators: [
      "EQ",
      "NEQ",
      "CONTAINS",
      "STARTS_WITH",
      "IN",
      "IS_NULL",
      "NOT_NULL",
    ],
  },
};

export function createSqlCompilerContext({ shop, catalogBatchId }) {
  const params = [shop, catalogBatchId];

  return {
    params,
    nextParam(value) {
      params.push(value);
      return `$${params.length}`;
    },
  };
}

function getFieldConfig(field) {
  const config = FIELD_REGISTRY[field];
  if (!config) {
    throw new AstCompileError("UNKNOWN_FIELD", "Unknown AST field", { field });
  }
  return config;
}

function assertOperatorAllowed(config, field, operator) {
  if (!config.allowedOperators.includes(operator)) {
    throw new AstCompileError(
      "INVALID_OPERATOR_FOR_FIELD",
      "Invalid operator",
      { field, operator },
    );
  }
}

function normalizeNodeType(type) {
  return String(type || "").trim().toLowerCase();
}

function assertScalarValue(field, value) {
  if (
    value === undefined ||
    value === null ||
    Array.isArray(value) ||
    typeof value === "object"
  ) {
    throw new AstCompileError("INVALID_SCALAR_VALUE", "Scalar value required", {
      field,
    });
  }
}

function assertArrayValue(field, value) {
  if (!Array.isArray(value)) {
    throw new AstCompileError("INVALID_ARRAY_VALUE", "Array value required", {
      field,
    });
  }
}

function assertTextField(fieldKey, field) {
  if (field.type !== "text" && field.type !== "enum") {
    throw new AstCompileError("FIELD_NOT_TEXT", "Text operator on non-text field", {
      field: fieldKey,
      type: field.type,
    });
  }
}

function assertArrayField(fieldKey, field) {
  if (!field.type.endsWith("_array")) {
    throw new AstCompileError(
      "FIELD_NOT_ARRAY",
      "Array operator on non-array field",
      {
        field: fieldKey,
        type: field.type,
      },
    );
  }
}

function assertComparableField(fieldKey, field) {
  if (!["number", "decimal", "date"].includes(field.type)) {
    throw new AstCompileError(
      "FIELD_NOT_COMPARABLE",
      "Comparable operator on non-comparable field",
      {
        field: fieldKey,
        type: field.type,
      },
    );
  }
}

function coerceValue(field, value) {
  switch (field.type) {
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw new AstCompileError("INVALID_NUMBER", "Invalid number value");
      }
      return n;
    }

    case "decimal": {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw new AstCompileError("INVALID_DECIMAL", "Invalid decimal value");
      }
      return n;
    }

    case "date": {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        throw new AstCompileError("INVALID_DATE", "Invalid date value");
      }
      return date;
    }

    case "enum":
    case "text":
      return String(value);

    default:
      return value;
  }
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function compileOperator({ field, fieldKey, operator, value, ctx }) {
  switch (operator) {
    case "EQ": {
      assertScalarValue(fieldKey, value);
      const p = ctx.nextParam(coerceValue(field, value));
      return `${field.column} = ${p}`;
    }

    case "NEQ": {
      assertScalarValue(fieldKey, value);
      const p = ctx.nextParam(coerceValue(field, value));
      return `${field.column} IS DISTINCT FROM ${p}`;
    }

    case "GT":
    case "GTE":
    case "LT":
    case "LTE": {
      assertScalarValue(fieldKey, value);
      assertComparableField(fieldKey, field);

      const p = ctx.nextParam(coerceValue(field, value));
      const op = {
        GT: ">",
        GTE: ">=",
        LT: "<",
        LTE: "<=",
      }[operator];

      return `${field.column} ${op} ${p}`;
    }

    case "IN":
    case "NOT_IN": {
      assertArrayValue(fieldKey, value);
      if (!value.length) {
        throw new AstCompileError("EMPTY_IN_VALUE", "IN requires values", {
          field: fieldKey,
        });
      }

      const p = ctx.nextParam(value.map((item) => coerceValue(field, item)));
      const sql = `${field.column} = ANY(${p})`;

      return operator === "NOT_IN" ? `NOT (${sql})` : sql;
    }

    case "CONTAINS": {
      if (field.type.endsWith("_array")) {
        assertArrayField(fieldKey, field);
        assertScalarValue(fieldKey, value);
        const p = ctx.nextParam([String(value)]);
        return `${field.column} @> ${p}::text[]`;
      }

      assertTextField(fieldKey, field);
      assertScalarValue(fieldKey, value);

      const p = ctx.nextParam(`%${escapeLike(String(value))}%`);
      return `${field.column} ILIKE ${p} ESCAPE '\\'`;
    }

    case "NOT_CONTAINS": {
      if (field.type.endsWith("_array")) {
        assertArrayField(fieldKey, field);
        assertScalarValue(fieldKey, value);
        const p = ctx.nextParam([String(value)]);
        return `NOT (${field.column} @> ${p}::text[])`;
      }

      assertTextField(fieldKey, field);
      assertScalarValue(fieldKey, value);

      const p = ctx.nextParam(`%${escapeLike(String(value))}%`);
      return `NOT (${field.column} ILIKE ${p} ESCAPE '\\')`;
    }

    case "STARTS_WITH": {
      assertTextField(fieldKey, field);
      assertScalarValue(fieldKey, value);

      const p = ctx.nextParam(`${escapeLike(String(value))}%`);
      return `${field.column} ILIKE ${p} ESCAPE '\\'`;
    }

    case "ENDS_WITH": {
      assertTextField(fieldKey, field);
      assertScalarValue(fieldKey, value);

      const p = ctx.nextParam(`%${escapeLike(String(value))}`);
      return `${field.column} ILIKE ${p} ESCAPE '\\'`;
    }

    case "ARRAY_CONTAINS": {
      assertArrayField(fieldKey, field);
      const values = Array.isArray(value) ? value : [value];

      if (!values.length) {
        throw new AstCompileError("EMPTY_ARRAY_CONTAINS", "Array value required");
      }

      const p = ctx.nextParam(values.map(String));
      return `${field.column} @> ${p}::text[]`;
    }

    case "NOT_ARRAY_CONTAINS": {
      assertArrayField(fieldKey, field);
      const values = Array.isArray(value) ? value : [value];

      if (!values.length) {
        throw new AstCompileError("EMPTY_ARRAY_CONTAINS", "Array value required");
      }

      const p = ctx.nextParam(values.map(String));
      return `NOT (${field.column} @> ${p}::text[])`;
    }

    case "ARRAY_OVERLAP": {
      assertArrayField(fieldKey, field);
      assertArrayValue(fieldKey, value);

      const p = ctx.nextParam(value.map(String));
      return `${field.column} && ${p}::text[]`;
    }

    case "BETWEEN": {
      assertComparableField(fieldKey, field);

      if (!Array.isArray(value) || value.length !== 2) {
        throw new AstCompileError(
          "INVALID_BETWEEN_VALUE",
          "BETWEEN requires two values",
          { field: fieldKey },
        );
      }

      const p1 = ctx.nextParam(coerceValue(field, value[0]));
      const p2 = ctx.nextParam(coerceValue(field, value[1]));

      return `${field.column} BETWEEN ${p1} AND ${p2}`;
    }

    case "IS_NULL":
      return `${field.column} IS NULL`;

    case "NOT_NULL":
      return `${field.column} IS NOT NULL`;

    default:
      throw new AstCompileError("UNSUPPORTED_OPERATOR", "Unsupported operator", {
        operator,
      });
  }
}

function compileVariantExists(innerPredicateSql) {
  return `EXISTS (
    SELECT 1
    FROM "Variant" v
    WHERE v.shop = p.shop
      AND v."mirrorBatchId" = p."mirrorBatchId"
      AND v."productId" = p.id
      AND ${innerPredicateSql}
  )`;
}

function compilePredicateNode(node, ctx) {
  const field = node.field;
  const operator = String(node.operator || "").trim().toUpperCase();
  const config = getFieldConfig(field);

  assertOperatorAllowed(config, field, operator);
  const baseSql = compileOperator({
    field: config,
    fieldKey: field,
    operator,
    value: node.value,
    ctx,
  });

  if (config.relation === "VARIANT_EXISTS") {
    return compileVariantExists(baseSql);
  }

  return baseSql;
}

function compileGroupNode(node, ctx, depth) {
  const operator = String(node.operator || "").trim().toUpperCase();
  if (!["AND", "OR"].includes(operator)) {
    throw new AstCompileError("INVALID_GROUP_OPERATOR", "Invalid group operator", {
      operator: node.operator,
    });
  }

  const children = Array.isArray(node.children) ? node.children : [];
  if (!children.length) {
    throw new AstCompileError("EMPTY_GROUP", "Group must contain children");
  }
  if (children.length > MAX_GROUP_CHILDREN) {
    throw new AstCompileError(
      "TOO_MANY_GROUP_CHILDREN",
      "Group has too many children",
    );
  }

  const childSql = children
    .map((child) => compileNode(child, ctx, depth + 1))
    .filter(Boolean);

  if (!childSql.length) {
    throw new AstCompileError("EMPTY_GROUP_SQL", "Group compiled to empty SQL");
  }

  return childSql.map((sql) => `(${sql})`).join(` ${operator} `);
}

function compileNotNode(node, ctx, depth) {
  if (!node.child) {
    throw new AstCompileError("NOT_CHILD_MISSING", "NOT node requires child");
  }

  return `NOT (${compileNode(node.child, ctx, depth + 1)})`;
}

function compileNode(node, ctx, depth) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new AstCompileError("INVALID_NODE", "AST node must be an object");
  }

  if (depth > MAX_AST_DEPTH) {
    throw new AstCompileError("AST_TOO_DEEP", "AST exceeds maximum depth", {
      max: MAX_AST_DEPTH,
    });
  }

  switch (normalizeNodeType(node.type)) {
    case "group":
      return compileGroupNode(node, ctx, depth);
    case "not":
      return compileNotNode(node, ctx, depth);
    case "predicate":
      return compilePredicateNode(node, ctx);
    default:
      throw new AstCompileError("UNKNOWN_NODE_TYPE", "Unknown AST node type", {
        type: node.type,
      });
  }
}

function predicateCost(node) {
  if (!node || node.type !== "predicate") return 100;

  const field = FIELD_REGISTRY[node.field];
  if (!field) return 1000;

  if (field.indexedExact) return 1;
  if (field.indexedArray) return 2;
  if (field.relation === "VARIANT_EXISTS") return 5;
  if (node.operator === "CONTAINS") return 20;

  return 10;
}

function comparePredicatePriority(a, b) {
  return predicateCost(a) - predicateCost(b);
}

export function optimizeAst(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return node;

  if (node.version && node.filter) {
    return {
      ...node,
      filter: optimizeAst(node.filter),
    };
  }

  if (normalizeNodeType(node.type) === "group") {
    const operator = String(node.operator || "").trim().toUpperCase();
    const children = Array.isArray(node.children) ? node.children : [];

    return {
      ...node,
      operator,
      children: children
        .map(optimizeAst)
        .flatMap((child) => {
          if (
            child &&
            normalizeNodeType(child.type) === "group" &&
            String(child.operator || "").trim().toUpperCase() === operator
          ) {
            return Array.isArray(child.children) ? child.children : [];
          }

          return [child];
        })
        .sort(comparePredicatePriority),
    };
  }

  return node;
}

export function compileFilterAst({
  ast,
  shop,
  catalogBatchId,
  entity = "PRODUCT",
}) {
  if (!shop) {
    throw new AstCompileError("SHOP_REQUIRED", "shop is required");
  }
  if (!catalogBatchId) {
    throw new AstCompileError(
      "CATALOG_BATCH_REQUIRED",
      "catalogBatchId is required",
    );
  }

  const ctx = createSqlCompilerContext({ shop, catalogBatchId });
  const optimizedAst = optimizeAst(ast);
  const filterAst = optimizedAst?.version && optimizedAst?.filter
    ? optimizedAst.filter
    : optimizedAst;
  const predicateSql = filterAst ? compileNode(filterAst, ctx, 0) : "";
  const whereSql = [
    "p.shop = $1",
    'p."mirrorBatchId" = $2',
    predicateSql ? `(${predicateSql})` : null,
  ]
    .filter(Boolean)
    .join(" AND ");

  return {
    whereSql,
    params: ctx.params,
    joins: [],
    entity,
  };
}

export function buildProductIdQuery({
  ast,
  shop,
  catalogBatchId,
  limitParam = null,
}) {
  const compiled = compileFilterAst({ ast, shop, catalogBatchId });
  const params = [...compiled.params];
  const limitSql = limitParam === null ? "" : `\nLIMIT $${params.push(limitParam)}`;

  return {
    ...compiled,
    sql: `SELECT p.id
FROM "Product" p
WHERE ${compiled.whereSql}
ORDER BY p.id ASC${limitSql}`,
    params,
  };
}

export function buildProductSearchQuery({
  ast,
  shop,
  catalogBatchId,
  limit = 50,
  cursorId = null,
}) {
  const compiled = compileFilterAst({ ast, shop, catalogBatchId });
  const params = [...compiled.params];
  let cursorSql = "";

  if (cursorId) {
    params.push(cursorId);
    cursorSql = `\n  AND p.id > $${params.length}`;
  }

  params.push(limit);
  const limitParam = `$${params.length}`;

  return {
    ...compiled,
    sql: `SELECT
  p.id,
  p.title,
  p.handle,
  p.status,
  p.vendor,
  p."productType",
  p."totalInventory",
  p."featuredImageUrl"
FROM "Product" p
WHERE ${compiled.whereSql}${cursorSql}
ORDER BY p.id ASC
LIMIT ${limitParam}`,
    params,
  };
}

export function buildProductCountQuery({ ast, shop, catalogBatchId }) {
  const compiled = compileFilterAst({ ast, shop, catalogBatchId });

  return {
    ...compiled,
    sql: `SELECT COUNT(*)::int AS count
FROM "Product" p
WHERE ${compiled.whereSql}`,
    params: compiled.params,
  };
}

export function buildTargetSnapshotInsertQuery({
  ast,
  shop,
  catalogBatchId,
  operationId,
}) {
  if (!operationId) {
    throw new AstCompileError("OPERATION_REQUIRED", "operationId is required");
  }

  const compiled = compileFilterAst({ ast, shop, catalogBatchId });
  const params = [shop, operationId, ...compiled.params];
  const shiftedWhereSql = compiled.whereSql.replace(/\$(\d+)/g, (_match, index) =>
    `$${Number(index) + 2}`,
  );

  return {
    sql: `INSERT INTO "TargetSnapshotSet" ("shop", "operationId", "entityId")
SELECT $1, $2, p.id
FROM "Product" p
WHERE ${shiftedWhereSql}
ON CONFLICT DO NOTHING`,
    params,
    whereSql: shiftedWhereSql,
    joins: compiled.joins,
    entity: compiled.entity,
  };
}

export function buildFreezeTargetSetQuery({
  ast,
  shop,
  operationId,
  catalogBatchId,
}) {
  if (!operationId) {
    throw new AstCompileError("OPERATION_REQUIRED", "operationId is required");
  }

  const compiled = compileFilterAst({ ast, shop, catalogBatchId });
  const params = [...compiled.params, operationId];
  const operationParam = `$${params.length}`;

  return {
    ...compiled,
    sql: `INSERT INTO "TargetSnapshotSet" (
  "shop",
  "operationId",
  "entityId",
  "createdAt"
)
SELECT
  p.shop,
  ${operationParam},
  p.id,
  now()
FROM "Product" p
WHERE ${compiled.whereSql}
ON CONFLICT ("operationId", "entityId")
DO NOTHING`,
    params,
  };
}
