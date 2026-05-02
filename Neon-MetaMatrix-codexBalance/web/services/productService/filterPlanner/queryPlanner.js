import { normalizeFilterAst } from "../../filterPlanner/filterAstNormalizer.js";
import { optimizeFilterAst } from "./astOptimizer.js";
import { chooseExecutionEngine } from "./queryCostModel.js";
import { compileAstToPostgresWhere } from "../../filterPlanner/postgresCompiler.js";
import {
  buildClickHouseProductIdQuery,
  buildClickHouseCountQuery,
} from "../../filterPlanner/clickhouseCompiler.js";

function normalizePagination(page = 1, limit = 50) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.max(Number(limit) || 50, 1);

  return {
    page: safePage,
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
  };
}

function convertToCompilerAst(node) {
  if (!node) return null;

  if (node.type === "condition") {
    return {
      ...node,
      type: "PREDICATE",
    };
  }

  if (node.type === "group") {
    return {
      ...node,
      type: String(node.combinator || "AND").toUpperCase(),
      children: (node.children || []).map((child) => convertToCompilerAst(child)),
    };
  }

  return node;
}

export function buildQueryPlan({
  filterParams,
  context,
  estimatedTotalRows,
  operation = "preview",
  page = 1,
  limit = 50,
  debug = false,
}) {
  const pagination = normalizePagination(page, limit);
  let optimizedAst;
  let optimizerTrace = [];

  try {
    const normalizedAst = normalizeFilterAst(filterParams);
    const optimized = optimizeFilterAst(normalizedAst, {
      trace: debug,
    });

    optimizedAst = debug ? optimized.ast : optimized;
    optimizerTrace = debug ? optimized.trace : [];
  } catch (error) {
    const enriched = new Error(
      `Failed to build filter query plan for shop ${context?.shop || "<unknown>"} during ${operation}: ${error.message}`,
    );
    enriched.cause = error;
    throw enriched;
  }

  if (optimizedAst?.type === "impossible") {
    return {
      engine: "none",
      reason: optimizedAst.reason,
      ast: optimizedAst,
      optimizerTrace,
      pagination,
      totalCount: 0,
      productIds: [],
    };
  }

  const compilerAst = convertToCompilerAst(optimizedAst);

  const decision = chooseExecutionEngine({
    ast: optimizedAst,
    estimatedTotalRows,
    operation,
  });

  if (decision.engine === "clickhouse") {
    return {
      engine: "clickhouse",
      reason: decision.reason,
      ast: optimizedAst,
      optimizerTrace,
      pagination,
      countQuery: buildClickHouseCountQuery({
        ast: compilerAst,
        shop: context.shop,
        mirrorBatchId: context.mirrorBatchId,
      }),
      productIdQuery: buildClickHouseProductIdQuery({
        ast: compilerAst,
        shop: context.shop,
        mirrorBatchId: context.mirrorBatchId,
        limit: pagination.limit,
        offset: pagination.offset,
      }),
    };
  }

  return {
    engine: "postgres",
    reason: decision.reason,
    ast: optimizedAst,
    optimizerTrace,
    pagination,
    where: compileAstToPostgresWhere({
      ast: compilerAst,
      shop: context.shop,
      mirrorBatchId: context.mirrorBatchId,
    }),
  };
}
