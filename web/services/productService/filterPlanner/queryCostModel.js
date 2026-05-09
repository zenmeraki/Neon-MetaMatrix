export const CLICKHOUSE_THRESHOLD = Number(
  process.env.FILTER_PLANNER_CLICKHOUSE_THRESHOLD || 25_000,
);
export const EXPORT_THRESHOLD = Number(
  process.env.FILTER_PLANNER_EXPORT_THRESHOLD || 5_000,
);

function normalizeEstimatedTotalRows(estimatedTotalRows) {
  const normalized = Number(estimatedTotalRows);

  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error("estimatedTotalRows must be a non-negative finite number");
  }

  return normalized;
}

function computeOrSelectivity(children = []) {
  const nonMatchProbability = children.reduce(
    (acc, child) => acc * (1 - computeSelectivity(child)),
    1,
  );

  return 1 - nonMatchProbability;
}

export function computeSelectivity(ast) {
  if (!ast) return 1;

  if (ast.type === "condition" || ast.type === "PREDICATE") {
    return ast.meta?.selectivity ?? 0.5;
  }

  if ((ast.type === "group" || ast.type === "AND" || ast.type === "OR") && Array.isArray(ast.children)) {
    if (!ast.children.length) return 1;

    const combinator = String(ast.combinator || ast.type || "AND").toUpperCase();

    if (combinator === "AND") {
      return ast.children.reduce(
        (acc, child) => acc * computeSelectivity(child),
        1,
      );
    }

    if (combinator === "OR") {
      return computeOrSelectivity(ast.children);
    }
  }

  return 1;
}

export function chooseExecutionEngine({
  ast,
  estimatedTotalRows,
  operation,
}) {
  const safeEstimatedTotalRows = normalizeEstimatedTotalRows(estimatedTotalRows);
  const selectivity = computeSelectivity(ast);
  const estimatedRows = Math.ceil(safeEstimatedTotalRows * selectivity);

  if (operation === "export" && estimatedRows > EXPORT_THRESHOLD) {
    return {
      engine: "clickhouse",
      reason: "large_export",
      estimatedRows,
      selectivity,
    };
  }

  if (estimatedRows > CLICKHOUSE_THRESHOLD) {
    return {
      engine: "clickhouse",
      reason: "large_query",
      estimatedRows,
      selectivity,
    };
  }

  return {
    engine: "postgres",
    reason: "small_query",
    estimatedRows,
    selectivity,
  };
}
