import crypto from "crypto";
import { stableCanonicalStringify } from "../../utils/stableCanonicalStringify.js";
import { FILTER_FIELD_REGISTRY } from "./filterRegistry.js";
import { compileAstToPostgresWhere } from "./postgresCompiler.js";
import { compileAstToClickHouseWhere } from "./clickhouseCompiler.js";

const COMPILED_FILTER_VERSION = 1;
const DEFAULT_MAX_ENTRIES = Math.max(Number(process.env.COMPILED_FILTER_CACHE_MAX || 1000), 1);
const DEFAULT_TTL_MS = Math.max(Number(process.env.COMPILED_FILTER_CACHE_TTL_MS || 300_000), 1000);
const RELATIVE_DATE_OPERATORS = new Set([
  "is before x days ago",
  "is after x days ago",
]);

const compiledFilterCache = new Map();

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeSortForKey(sort) {
  return {
    key: sort?.key || "ID",
    order: sort?.order || "asc",
    prismaField: sort?.prismaField || "id",
    clickhouseColumn: sort?.clickhouseColumn || "product_id",
  };
}

function walkPredicates(node, visit) {
  if (!node || typeof node !== "object") return;
  if (node.type === "PREDICATE") {
    visit(node);
    return;
  }
  if ((node.type === "AND" || node.type === "OR") && Array.isArray(node.children)) {
    for (const child of node.children) {
      walkPredicates(child, visit);
    }
  }
}

function buildJoinPlan(ast) {
  const domains = new Set();
  walkPredicates(ast, (node) => {
    const config = FILTER_FIELD_REGISTRY[node.field];
    if (config?.domain) domains.add(config.domain);
  });

  return {
    requiresVariantJoin: domains.has("variant"),
    requiresCollectionJoin: domains.has("collection"),
    domains: Array.from(domains).sort(),
  };
}

function buildRequiredIndexes(ast, engine) {
  const indexes = new Set();
  walkPredicates(ast, (node) => {
    const config = FILTER_FIELD_REGISTRY[node.field];
    if (!config) return;
    if (engine === "clickhouse") {
      indexes.add(`product_variant_flat(${config.clickhouseColumn || node.field})`);
      return;
    }
    if (config.domain === "variant") {
      indexes.add(`VariantMirror(shop, mirrorBatchId, ${config.prismaField || config.postgresColumn})`);
      indexes.add("ProductMirror(shop, mirrorBatchId, id)");
      return;
    }
    if (config.domain === "collection") {
      indexes.add("ProductCollectionMirror(shop, productId)");
      indexes.add("CollectionMirror(shop, title)");
      return;
    }
    indexes.add(`ProductMirror(shop, mirrorBatchId, ${config.prismaField || config.postgresColumn})`);
  });
  indexes.add("ProductMirror(shop, mirrorBatchId, id)");
  return Array.from(indexes).sort();
}

function buildSelectPlan({ engine, sort }) {
  if (engine === "clickhouse") {
    return {
      source: "product_variant_flat",
      productIdColumn: "product_id",
      sortColumn: sort?.clickhouseColumn || "product_id",
      projectedColumns: ["product_id"],
    };
  }

  return {
    model: "product",
    select: { id: true },
    orderBy: [
      { [sort?.prismaField || "id"]: sort?.order || "asc" },
      ...(sort?.prismaField && sort.prismaField !== "id" ? [{ id: "asc" }] : []),
    ],
  };
}

function hasRelativeDateOperator(ast) {
  let hasRelative = false;
  walkPredicates(ast, (node) => {
    if (RELATIVE_DATE_OPERATORS.has(node.operator)) {
      hasRelative = true;
    }
  });
  return hasRelative;
}

function buildClickHouseQueryFactory({ whereClause, sort }) {
  const direction =
    String(sort?.order || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
  const column =
    typeof sort?.clickhouseColumn === "string" && sort.clickhouseColumn.trim()
      ? sort.clickhouseColumn.trim()
      : "product_id";
  const isProductId = column === "product_id";
  const filteredSubquery = isProductId
    ? `
        SELECT DISTINCT product_id
        FROM product_variant_flat
        WHERE ${whereClause.sql}
      `.trim()
    : `
        SELECT
          product_id,
          any(${column}) AS sort_value
        FROM product_variant_flat
        WHERE ${whereClause.sql}
        GROUP BY product_id
      `.trim();
  const orderBy = isProductId
    ? `product_id ${direction}`
    : `sort_value ${direction}, product_id ASC`;

  return {
    countQuery: () => ({
      sql: `
        SELECT countDistinct(product_id) AS count
        FROM product_variant_flat
        WHERE ${whereClause.sql}
      `.trim(),
      params: whereClause.params,
    }),
    productIdQuery: ({ limit, offset }) => ({
      sql: `
        SELECT product_id
        FROM (${filteredSubquery}) AS filtered_products
        ORDER BY ${orderBy}
        LIMIT ${Math.max(Number(limit) || 100, 1)}
        OFFSET ${Math.max(Number(offset) || 0, 0)}
      `.trim(),
      params: whereClause.params,
    }),
    productIdPageQuery: ({ limit, offset }) => ({
      sql: `
        SELECT
          product_id,
          count() OVER () AS total_count
        FROM (${filteredSubquery}) AS filtered_products
        ORDER BY ${orderBy}
        LIMIT ${Math.max(Number(limit) || 100, 1)}
        OFFSET ${Math.max(Number(offset) || 0, 0)}
      `.trim(),
      params: whereClause.params,
    }),
  };
}

function buildCacheKey({ ast, shop, mirrorBatchId, engine, sort }) {
  return sha256(
    stableCanonicalStringify({
      version: COMPILED_FILTER_VERSION,
      ast,
      shop,
      mirrorBatchId,
      engine,
      sort: normalizeSortForKey(sort),
    }),
  );
}

function pruneExpired(now = Date.now()) {
  for (const [key, entry] of compiledFilterCache.entries()) {
    if (entry.expiresAt <= now) {
      compiledFilterCache.delete(key);
    }
  }
}

function remember(key, compiled, ttlMs) {
  compiledFilterCache.set(key, {
    compiled,
    expiresAt: Date.now() + ttlMs,
  });

  while (compiledFilterCache.size > DEFAULT_MAX_ENTRIES) {
    const oldestKey = compiledFilterCache.keys().next().value;
    compiledFilterCache.delete(oldestKey);
  }
}

function compileFresh({ ast, shop, mirrorBatchId, engine, sort }) {
  const whereClause =
    engine === "clickhouse"
      ? compileAstToClickHouseWhere({ ast, shop, mirrorBatchId })
      : compileAstToPostgresWhere({ ast, shop, mirrorBatchId });
  const joinPlan = buildJoinPlan(ast);
  const requiredIndexes = buildRequiredIndexes(ast, engine);
  const selectPlan = buildSelectPlan({ engine, sort });
  const compiledFilter = {
    version: COMPILED_FILTER_VERSION,
    engine,
    shop,
    mirrorBatchId,
    ast,
    astHash: sha256(stableCanonicalStringify(ast)),
    whereClause,
    joinPlan,
    requiredIndexes,
    selectPlan,
    cacheable: !hasRelativeDateOperator(ast),
    compiledAt: new Date().toISOString(),
  };

  if (engine === "clickhouse") {
    compiledFilter.clickhouse = buildClickHouseQueryFactory({ whereClause, sort });
  }

  compiledFilter.compiledFilterHash = sha256(
    stableCanonicalStringify({
      version: compiledFilter.version,
      engine,
      shop,
      mirrorBatchId,
      ast: compiledFilter.astHash,
      whereClause,
      joinPlan,
      requiredIndexes,
      selectPlan,
    }),
  );

  return compiledFilter;
}

export function compileFilterExecutor({
  ast,
  shop,
  mirrorBatchId,
  engine = "postgres",
  sort = null,
  ttlMs = DEFAULT_TTL_MS,
} = {}) {
  if (!shop) throw new Error("shop is required");
  if (!mirrorBatchId) throw new Error("mirrorBatchId is required");
  if (!ast) throw new Error("Canonical AST is required");

  const normalizedEngine = engine === "clickhouse" ? "clickhouse" : "postgres";
  const key = buildCacheKey({
    ast,
    shop,
    mirrorBatchId,
    engine: normalizedEngine,
    sort,
  });
  const now = Date.now();
  pruneExpired(now);

  const cached = compiledFilterCache.get(key);
  if (cached?.expiresAt > now) {
    compiledFilterCache.delete(key);
    compiledFilterCache.set(key, cached);
    return {
      ...cached.compiled,
      cacheKey: key,
      cacheStatus: "hit",
    };
  }

  const compiled = compileFresh({
    ast,
    shop,
    mirrorBatchId,
    engine: normalizedEngine,
    sort,
  });

  if (compiled.cacheable) {
    remember(key, compiled, ttlMs);
  }

  return {
    ...compiled,
    cacheKey: key,
    cacheStatus: compiled.cacheable ? "miss" : "uncacheable",
  };
}

export function getCompiledFilterCacheStats() {
  pruneExpired();
  return {
    size: compiledFilterCache.size,
    maxEntries: DEFAULT_MAX_ENTRIES,
    ttlMs: DEFAULT_TTL_MS,
  };
}

export function clearCompiledFilterCache() {
  compiledFilterCache.clear();
}
