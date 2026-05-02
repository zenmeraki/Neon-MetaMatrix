import crypto from "crypto";
import { Prisma } from "../../generated/prisma/index.js";
import { normalizeFilterAst } from "./filterAstNormalizer.js";
import { FILTER_FIELD_REGISTRY } from "./filterRegistry.js";

const PRODUCT_COLUMNS = {
  title: "title",
  vendor: "vendor",
  status: "status",
  productType: "productType",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
};

const VARIANT_COLUMNS = {
  price: "price",
  sku: "sku",
};

const SORT_COLUMNS = {
  ID: "id",
  CREATED_AT: "createdAt",
  UPDATED_AT: "updatedAt",
  TITLE: "title",
  VENDOR: "vendor",
  PRODUCT_TYPE: "productType",
  INVENTORY_TOTAL: "totalInventory",
  PUBLISHED_AT: "publishedAt",
};

function quoteIdentifier(identifier) {
  return Prisma.raw(`"${identifier.replace(/"/g, '""')}"`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function normalizeStringValue(field, value, allowEmpty = false) {
  const normalized = String(value ?? "").trim();
  if (!normalized && !allowEmpty) {
    throw new Error(`Value required for ${field}`);
  }
  return normalized;
}

function normalizeNumberValue(field, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid number for ${field}`);
  }
  return number;
}

function normalizeDateValue(field, value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date for ${field}`);
  }
  return date;
}

function buildStringPredicate(alias, column, operator, value) {
  const fieldRef = Prisma.sql`${Prisma.raw(alias)}.${quoteIdentifier(column)}`;
  const op = String(operator || "").toLowerCase();

  if (op === "in") {
    const values = Array.isArray(value)
      ? value.map((item) => normalizeStringValue(column, item)).filter(Boolean)
      : [];

    if (!values.length) throw new Error(`IN filter requires values for ${column}`);

    return Prisma.sql`LOWER(${fieldRef}) IN (${Prisma.join(values.map((item) => item.toLowerCase()))})`;
  }

  if (op === "is empty" || op === "is empty/blank") {
    return Prisma.sql`(${fieldRef} IS NULL OR ${fieldRef} = '')`;
  }

  if (op === "is not empty") {
    return Prisma.sql`(${fieldRef} IS NOT NULL AND ${fieldRef} <> '')`;
  }

  const stringValue = normalizeStringValue(column, value);
  const lowered = stringValue.toLowerCase();

  switch (op) {
    case "equals":
    case "is":
    case "=":
      return Prisma.sql`LOWER(${fieldRef}) = ${lowered}`;
    case "is not":
    case "does not equal":
    case "!=":
      return Prisma.sql`(${fieldRef} IS NULL OR LOWER(${fieldRef}) <> ${lowered})`;
    case "contains":
      return Prisma.sql`LOWER(${fieldRef}) LIKE ${`%${lowered}%`}`;
    case "does not contain":
      return Prisma.sql`(${fieldRef} IS NULL OR LOWER(${fieldRef}) NOT LIKE ${`%${lowered}%`})`;
    case "starts with":
      return Prisma.sql`LOWER(${fieldRef}) LIKE ${`${lowered}%`}`;
    case "ends with":
      return Prisma.sql`LOWER(${fieldRef}) LIKE ${`%${lowered}`}`;
    default:
      throw new Error(`Unsupported string operator for ${column}: ${operator}`);
  }
}

function buildNumberPredicate(alias, column, operator, value) {
  const fieldRef = Prisma.sql`${Prisma.raw(alias)}.${quoteIdentifier(column)}`;
  const op = String(operator || "").toLowerCase();

  if (op === "is empty" || op === "is empty/blank") return Prisma.sql`${fieldRef} IS NULL`;
  if (op === "is not empty") return Prisma.sql`${fieldRef} IS NOT NULL`;

  if (op === "in") {
    const values = Array.isArray(value)
      ? value.map((item) => Number(item)).filter((item) => Number.isFinite(item))
      : [];
    if (!values.length) throw new Error(`IN filter requires values for ${column}`);
    return Prisma.sql`${fieldRef} IN (${Prisma.join(values)})`;
  }

  const number = normalizeNumberValue(column, value);

  switch (op) {
    case "<":
    case "less than":
      return Prisma.sql`${fieldRef} < ${number}`;
    case "<=":
    case "less than or equal":
      return Prisma.sql`${fieldRef} <= ${number}`;
    case ">":
    case "greater than":
      return Prisma.sql`${fieldRef} > ${number}`;
    case ">=":
    case "greater than or equal":
      return Prisma.sql`${fieldRef} >= ${number}`;
    case "=":
    case "equals":
    case "is":
      return Prisma.sql`${fieldRef} = ${number}`;
    case "!=":
    case "is not":
    case "does not equal":
      return Prisma.sql`(${fieldRef} IS NULL OR ${fieldRef} <> ${number})`;
    default:
      throw new Error(`Unsupported number operator for ${column}: ${operator}`);
  }
}

function buildDatePredicate(alias, column, operator, value) {
  const fieldRef = Prisma.sql`${Prisma.raw(alias)}.${quoteIdentifier(column)}`;
  const op = String(operator || "").toLowerCase();

  if (op === "is empty" || op === "is empty/blank") return Prisma.sql`${fieldRef} IS NULL`;
  if (op === "is not empty") return Prisma.sql`${fieldRef} IS NOT NULL`;

  const date = normalizeDateValue(column, value);

  switch (op) {
    case "is before":
      return Prisma.sql`${fieldRef} < ${date}`;
    case "is after":
      return Prisma.sql`${fieldRef} > ${date}`;
    case "is on": {
      const start = new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);
      const end = new Date(`${date.toISOString().slice(0, 10)}T23:59:59.999Z`);
      return Prisma.sql`(${fieldRef} >= ${start} AND ${fieldRef} <= ${end})`;
    }
    default:
      throw new Error(`Unsupported date operator for ${column}: ${operator}`);
  }
}

function buildScalarPredicate(alias, column, type, node) {
  if (type === "number") {
    return buildNumberPredicate(alias, column, node.operator, node.value);
  }
  if (type === "date") {
    return buildDatePredicate(alias, column, node.operator, node.value);
  }
  return buildStringPredicate(alias, column, node.operator, node.value);
}

function buildCollectionPredicate(node) {
  const op = String(node.operator || "").toLowerCase();

  if (op === "is empty" || op === "is empty/blank") {
    return Prisma.sql`(p."collectionsJson" IS NULL OR p."collectionsJson" = '[]'::jsonb)`;
  }

  if (op === "is not empty") {
    return Prisma.sql`(p."collectionsJson" IS NOT NULL AND p."collectionsJson" <> '[]'::jsonb)`;
  }

  const value = normalizeStringValue("collection", node.value).toLowerCase();
  const collectionText = Prisma.sql`LOWER(p."collectionsJson"::text)`;

  switch (op) {
    case "equals":
    case "is":
    case "contains":
      return Prisma.sql`${collectionText} LIKE ${`%${value}%`}`;
    case "does not equal":
    case "is not":
    case "does not contain":
      return Prisma.sql`(p."collectionsJson" IS NULL OR ${collectionText} NOT LIKE ${`%${value}%`})`;
    default:
      throw new Error(`Unsupported collection operator: ${node.operator}`);
  }
}

function compilePredicate(node) {
  const config = FILTER_FIELD_REGISTRY[node.field];
  if (!config) throw new Error(`Unsupported filter field: ${node.field}`);

  if (config.domain === "variant") {
    const column = VARIANT_COLUMNS[node.field] || config.prismaField || config.postgresColumn;
    const predicate = buildScalarPredicate("v", column, config.type, node);

    return Prisma.sql`EXISTS (
      SELECT 1
      FROM "Variant" v
      WHERE v.shop = p.shop
        AND v."productId" = p.id
        AND v."mirrorBatchId" = p."mirrorBatchId"
        AND ${predicate}
    )`;
  }

  if (config.domain === "collection") {
    return buildCollectionPredicate(node);
  }

  const column = PRODUCT_COLUMNS[node.field] || config.prismaField || config.postgresColumn;
  return buildScalarPredicate("p", column, config.type, node);
}

function compileNode(node) {
  if (!node || typeof node !== "object") {
    throw new Error("Filter AST node is required");
  }

  if (node.type === "PREDICATE") return compilePredicate(node);

  if (node.type === "AND" || node.type === "OR") {
    const children = Array.isArray(node.children) ? node.children : [];
    const compiled = children.map(compileNode);

    if (!compiled.length) return Prisma.sql`TRUE`;

    return Prisma.sql`(${Prisma.join(
      compiled,
      node.type === "AND" ? " AND " : " OR ",
    )})`;
  }

  throw new Error(`Unsupported filter AST node type: ${node.type}`);
}

export function getCanonicalFilterKey(ast) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(ast || { type: "AND", children: [] })))
    .digest("hex");
}

export function normalizeFilterInput(filterParams = []) {
  return normalizeFilterAst(filterParams);
}

export function compileFilterSql({ ast, shop, mirrorBatchId }) {
  if (!shop) throw new Error("shop is required");
  if (!mirrorBatchId) throw new Error("mirrorBatchId is required");

  const normalizedAst = ast || { type: "AND", children: [] };
  const predicate = compileNode(normalizedAst);

  return {
    ast: normalizedAst,
    canonicalFilterKey: getCanonicalFilterKey(normalizedAst),
    whereSql: Prisma.sql`p.shop = ${shop} AND p."mirrorBatchId" = ${mirrorBatchId} AND ${predicate}`,
  };
}

export function buildProductOrderSql(sortKey = "ID", sortOrder = "asc") {
  const column = SORT_COLUMNS[sortKey] || "id";
  const direction = String(sortOrder).toLowerCase() === "desc" ? "DESC" : "ASC";

  return Prisma.sql`p.${quoteIdentifier(column)} ${Prisma.raw(direction)}, p."id" ${Prisma.raw(direction)}`;
}
