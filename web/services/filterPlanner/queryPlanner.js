import { normalizeFilterAst } from "./filterAstNormalizer.js";
import { FILTER_FIELD_REGISTRY } from "./filterRegistry.js";
import { chooseExecutionEngine } from "./queryCostModel.js";
import { compileAstToPostgresWhere } from "./postgresCompiler.js";
import {
  buildClickHouseCountQuery,
  buildClickHouseProductIdPageQuery,
  buildClickHouseProductIdQuery,
} from "./clickhouseCompiler.js";

function normalizePagination(page = 1, limit = 50) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.max(Number(limit) || 50, 1);

  return {
    page: safePage,
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
  };
}

function normalizeEstimatedTotalRows(estimatedTotalRows) {
  const normalized = Number(estimatedTotalRows);

  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error("estimatedTotalRows must be a non-negative finite number");
  }

  return normalized;
}

function attachNodeMetadata(node, path = "root") {
  if (!node || typeof node !== "object") {
    throw new Error(`Invalid AST node at ${path}`);
  }

  if (node.type === "AND" || node.type === "OR") {
    return {
      ...node,
      children: Array.isArray(node.children)
        ? node.children.map((child, index) =>
            attachNodeMetadata(child, `${path}.children[${index}]`),
          )
        : [],
    };
  }

  const config = FILTER_FIELD_REGISTRY[node.field];

  if (!config) {
    throw new Error(`Unsupported filter field at ${path}: ${node.field}`);
  }

  return {
    ...node,
    meta: {
      domain: config.domain,
      type: config.type,
      selectivity: config.selectivity,
      isVariantLevel: Boolean(config.isVariantLevel),
      allowedOperators: config.allowedOperators ?? [],
    },
  };
}

function attachFieldMetadata(ast) {
  return attachNodeMetadata(ast);
}

export function buildQueryPlan({
  filterParams,
  shop,
  mirrorBatchId,
  estimatedTotalRows,
  operation = "preview",
  requiresTransactionalFreshness = false,
  page = 1,
  limit = 50,
}) {
  const pagination = normalizePagination(page, limit);
  const safeEstimatedTotalRows = normalizeEstimatedTotalRows(estimatedTotalRows);
  const ast = attachFieldMetadata(normalizeFilterAst(filterParams));

  const decision = chooseExecutionEngine({
    ast,
    estimatedTotalRows: safeEstimatedTotalRows,
    operation,
    requiresTransactionalFreshness,
  });

  if (decision.engine === "clickhouse") {
    return {
      engine: "clickhouse",
      reason: decision.reason,
      ast,
      pagination,
      estimatedTotalRows: safeEstimatedTotalRows,
      countQuery: buildClickHouseCountQuery({
        ast,
        shop,
        mirrorBatchId,
      }),
      productIdQuery: buildClickHouseProductIdQuery({
        ast,
        shop,
        mirrorBatchId,
        limit: pagination.limit,
        offset: pagination.offset,
      }),
      productIdPageQuery: buildClickHouseProductIdPageQuery({
        ast,
        shop,
        mirrorBatchId,
        limit: pagination.limit,
        offset: pagination.offset,
      }),
      replan: (nextEstimatedTotalRows) =>
        buildQueryPlan({
          filterParams,
          shop,
          mirrorBatchId,
          estimatedTotalRows: nextEstimatedTotalRows,
          operation,
          requiresTransactionalFreshness,
          page: pagination.page,
          limit: pagination.limit,
        }),
    };
  }

  return {
    engine: "postgres",
    reason: decision.reason,
    ast,
    pagination,
    estimatedTotalRows: safeEstimatedTotalRows,
    where: compileAstToPostgresWhere({
      ast,
      shop,
      mirrorBatchId,
    }),
    replan: (nextEstimatedTotalRows) =>
      buildQueryPlan({
        filterParams,
        shop,
        mirrorBatchId,
        estimatedTotalRows: nextEstimatedTotalRows,
        operation,
        requiresTransactionalFreshness,
        page: pagination.page,
        limit: pagination.limit,
      }),
  };
}
