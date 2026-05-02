import {
  compileAstToClickHouseWhere,
  buildClickHouseCountQuery as buildSafeClickHouseCountQuery,
  buildClickHouseProductIdQuery as buildSafeClickHouseProductIdQuery,
} from "../../filterPlanner/clickhouseCompiler.js";

export function buildClickHouseWhere({ ast, shop, mirrorBatchId }) {
  return compileAstToClickHouseWhere({ ast, shop, mirrorBatchId });
}

export function buildClickHouseProductIdQuery({
  ast,
  shop,
  mirrorBatchId,
  limit,
  offset,
}) {
  return buildSafeClickHouseProductIdQuery({
    ast,
    shop,
    mirrorBatchId,
    limit,
    offset,
  });
}

export function buildClickHouseCountQuery({ ast, shop, mirrorBatchId }) {
  return buildSafeClickHouseCountQuery({
    ast,
    shop,
    mirrorBatchId,
  });
}
