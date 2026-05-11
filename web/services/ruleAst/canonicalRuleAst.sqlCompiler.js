import { normalizeCanonicalRuleAst } from "./canonicalRuleAst.normalize.js";
import { validateCanonicalRuleAst } from "./canonicalRuleAst.validate.js";

function makeCtx(shop, catalogBatchId) {
  return {
    params: [shop, catalogBatchId],
    push(value) {
      this.params.push(value);
      return `$${this.params.length}`;
    },
  };
}

function likeValue(raw, mode) {
  const value = String(raw ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
  if (mode === "starts_with") return `${value}%`;
  if (mode === "ends_with") return `%${value}`;
  return `%${value}%`;
}

function fieldSql(field) {
  const map = {
    "product.id": 'p.id',
    "product.title": 'p.title',
    "product.handle": 'p.handle',
    "product.vendor": 'p.vendor',
    "product.productType": 'p."productType"',
    "product.status": 'p.status',
    "product.tags": 'p.tags',
    "product.seoTitle": 'p."seoTitle"',
    "product.createdAt": 'p."createdAt"',
    "product.updatedAt": 'p."updatedAt"',
    "product.publishedAt": 'p."publishedAt"',
    "product.totalInventory": 'p."totalInventory"',
    "variant.id": 'v.id',
    "variant.title": 'v.title',
    "variant.sku": 'v.sku',
    "variant.barcode": 'v.barcode',
    "variant.price": 'v.price',
    "variant.compareAtPrice": 'v."compareAtPrice"',
    "variant.inventoryQuantity": 'v."inventoryQuantity"',
    "variant.inventoryPolicy": 'v."inventoryPolicy"',
    "collection.id": 'c.id',
    "collection.handle": 'c.handle',
    "collection.title": 'c.title',
    "metafield.value": 'pm.value',
  };
  return map[field] || null;
}

function operatorSql(column, operator, value, ctx) {
  switch (operator) {
    case "eq":
      return `${column} = ${ctx.push(value)}`;
    case "neq":
      return `${column} <> ${ctx.push(value)}`;
    case "contains":
      return `${column} ILIKE ${ctx.push(likeValue(value, "contains"))} ESCAPE '\\'`;
    case "not_contains":
      return `${column} NOT ILIKE ${ctx.push(likeValue(value, "contains"))} ESCAPE '\\'`;
    case "starts_with":
      return `${column} ILIKE ${ctx.push(likeValue(value, "starts_with"))} ESCAPE '\\'`;
    case "ends_with":
      return `${column} ILIKE ${ctx.push(likeValue(value, "ends_with"))} ESCAPE '\\'`;
    case "is_empty":
      return `(${column} IS NULL OR ${column} = '')`;
    case "is_not_empty":
      return `(${column} IS NOT NULL AND ${column} <> '')`;
    case "gt":
      return `${column} > ${ctx.push(value)}`;
    case "gte":
      return `${column} >= ${ctx.push(value)}`;
    case "lt":
      return `${column} < ${ctx.push(value)}`;
    case "lte":
      return `${column} <= ${ctx.push(value)}`;
    case "between":
      return `(${column} >= ${ctx.push(value.from)} AND ${column} <= ${ctx.push(value.to)})`;
    case "in":
      return `${column} = ANY(${ctx.push(Array.isArray(value) ? value : [value])})`;
    case "not_in":
      return `NOT (${column} = ANY(${ctx.push(Array.isArray(value) ? value : [value])}))`;
    case "exists":
      return `${column} IS NOT NULL`;
    case "not_exists":
      return `${column} IS NULL`;
    default: {
      const error = new Error(`Unsupported operator: ${operator}`);
      error.code = "CANONICAL_SQL_OPERATOR_UNSUPPORTED";
      throw error;
    }
  }
}

function buildVariantExists(node, ctx) {
  const column = fieldSql(node.field);
  if (!column) {
    const error = new Error(`Unsupported field: ${node.field}`);
    error.code = "CANONICAL_SQL_FIELD_UNSUPPORTED";
    throw error;
  }
  const predicate = operatorSql(column, node.operator, node.value, ctx);
  return `EXISTS (
    SELECT 1
    FROM "Variant" v
    WHERE v.shop = p.shop
      AND v."mirrorBatchId" = p."mirrorBatchId"
      AND v."productId" = p.id
      AND ${predicate}
  )`;
}

function buildCollectionExists(node, ctx) {
  const column = fieldSql(node.field);
  const hasValuePredicate =
    node.operator === "exists" || node.operator === "not_exists"
      ? null
      : operatorSql(column, node.operator, node.value, ctx);

  const valuePredicate = hasValuePredicate ? `AND ${hasValuePredicate}` : "";
  const existsSql = `EXISTS (
    SELECT 1
    FROM "ProductCollectionMembership" pcm
    JOIN "Collection" c
      ON c.shop = pcm.shop
     AND c.id = pcm."collectionId"
     AND c."mirrorBatchId" = pcm."mirrorBatchId"
    WHERE pcm.shop = p.shop
      AND pcm."mirrorBatchId" = p."mirrorBatchId"
      AND pcm."productId" = p.id
      ${valuePredicate}
  )`;

  return node.operator === "not_exists" ? `NOT (${existsSql})` : existsSql;
}

function buildMetafieldExists(node, ctx) {
  const meta = node.value && typeof node.value === "object" && !Array.isArray(node.value)
    ? node.value
    : {};
  const ns = typeof meta.namespace === "string" ? meta.namespace.trim() : "";
  const key = typeof meta.key === "string" ? meta.key.trim() : "";
  if (!ns || !key) {
    const error = new Error("metafield.value requires namespace and key");
    error.code = "CANONICAL_SQL_METAFIELD_SCOPE_REQUIRED";
    throw error;
  }

  const nsParam = ctx.push(ns);
  const keyParam = ctx.push(key);
  const column = fieldSql(node.field);
  const valuePredicate =
    node.operator === "exists" || node.operator === "not_exists"
      ? ""
      : `AND ${operatorSql(column, node.operator, meta.value, ctx)}`;

  const existsSql = `EXISTS (
    SELECT 1
    FROM "ProductMetafield" pm
    WHERE pm.shop = p.shop
      AND pm."mirrorBatchId" = p."mirrorBatchId"
      AND pm."ownerId" = p.id
      AND pm.namespace = ${nsParam}
      AND pm.key = ${keyParam}
      ${valuePredicate}
  )`;
  return node.operator === "not_exists" ? `NOT (${existsSql})` : existsSql;
}

function buildProductPredicate(node, ctx) {
  const column = fieldSql(node.field);
  if (!column) {
    const error = new Error(`Unsupported field: ${node.field}`);
    error.code = "CANONICAL_SQL_FIELD_UNSUPPORTED";
    throw error;
  }
  return operatorSql(column, node.operator, node.value, ctx);
}

function compileNode(node, ctx) {
  if (node.type === "group") {
    const joiner = node.op === "OR" ? " OR " : " AND ";
    return `(${node.children.map((child) => compileNode(child, ctx)).join(joiner)})`;
  }

  if (node.field.startsWith("variant.")) return buildVariantExists(node, ctx);
  if (node.field.startsWith("collection.")) return buildCollectionExists(node, ctx);
  if (node.field === "metafield.value") return buildMetafieldExists(node, ctx);
  return buildProductPredicate(node, ctx);
}

export function compileCanonicalRuleAstToSql({
  ast,
  shop,
  catalogBatchId,
  resourceScope = "MIXED",
}) {
  const normalized = normalizeCanonicalRuleAst(ast);
  const validation = validateCanonicalRuleAst(normalized, { resourceScope });
  if (!validation.valid) {
    const error = new Error("CANONICAL_RULE_AST_INVALID");
    error.code = "CANONICAL_RULE_AST_INVALID";
    error.details = validation.errors;
    throw error;
  }

  const ctx = makeCtx(shop, catalogBatchId);
  const predicateSql = compileNode(normalized, ctx);
  const whereSql = `p.shop = $1 AND p."mirrorBatchId" = $2 AND ${predicateSql}`;

  return {
    whereSql,
    params: ctx.params,
    sql: `SELECT p.id AS product_id
FROM "Product" p
WHERE ${whereSql}
ORDER BY p.id ASC`,
  };
}
